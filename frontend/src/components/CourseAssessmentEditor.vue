<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { kindLabels, type Course, type Kind } from '@eks/contracts';
import { courseIssues, type CourseIssue } from '../course-editor';
import CompactTabs from './CompactTabs.vue';
import ObjectiveChoices from './ObjectiveChoices.vue';
import AppDialog from './AppDialog.vue';
const props = defineProps<{ course: Course; disabled: boolean; showErrors: boolean }>();
const root = ref<HTMLElement>();
const uid = useId();
const activeKind = ref<Kind | ''>('');
const selected = ref<Record<Kind, string>>({ objective: '', subjective: '', practical: '' });
const typeTabs = ref<InstanceType<typeof CompactTabs>>();
const itemTabs = ref<InstanceType<typeof CompactTabs>>();
const pendingDelete = ref<{ kind: Kind; id: string; title: string } | null>(null);
let restoreAfterDelete = false;
async function restoreQuestionFocus() {
  if (!restoreAfterDelete) return;
  restoreAfterDelete = false;
  await nextTick();
  root.value
    ?.querySelector<HTMLElement>('.question-tabs [aria-selected="true"], [data-field="add"]')
    ?.focus();
}
const kinds = computed(() =>
  (['objective', 'subjective', 'practical'] as Kind[]).filter((k) =>
    props.course.assessmentKinds.includes(k),
  ),
);
const list = (kind: Kind) =>
  kind === 'objective'
    ? props.course.questions
    : kind === 'subjective'
      ? props.course.subjectiveQuestions
      : props.course.practicalItems;
const typeOptions = computed(() =>
  kinds.value.map((k) => ({ id: k, label: kindLabels[k] + ' ' + list(k).length })),
);
const allIssues = computed(() => courseIssues(props.course));
const items = computed(() => (activeKind.value ? list(activeKind.value) : []));
const selectedId = computed({
  get: () => (activeKind.value ? selected.value[activeKind.value] : ''),
  set: (id: string) => {
    if (activeKind.value) selected.value[activeKind.value] = id;
  },
});
const current = computed(() => items.value.find((i) => i.id === selectedId.value));
const position = computed(() => items.value.findIndex((i) => i.id === selectedId.value) + 1);
const errors = computed(() =>
  Object.fromEntries(
    (props.showErrors ? allIssues.value : [])
      .filter((i) => i.kind === activeKind.value && i.itemId === selectedId.value)
      .map((i) => [i.field, i.message]),
  ),
);
const typeErrors = computed(() =>
  Object.fromEntries(
    (props.showErrors ? allIssues.value : [])
      .filter((i) => i.kind === activeKind.value && !i.itemId)
      .map((i) => [i.field, i.message]),
  ),
);
const itemOptions = computed(() =>
  items.value.map((q, n) => ({
    id: q.id,
    label: `${n + 1}. ${('prompt' in q ? q.prompt : q.title).trim() || '새 항목'}`,
    invalid: allIssues.value.some((i) => i.kind === activeKind.value && i.itemId === q.id),
  })),
);
watch(
  () => props.course.id,
  () => {
    activeKind.value = '';
    selected.value = { objective: '', subjective: '', practical: '' };
  },
);
watch(
  () => [
    ...kinds.value,
    ...props.course.questions.map((q) => q.id),
    ...props.course.subjectiveQuestions.map((q) => q.id),
    ...props.course.practicalItems.map((q) => q.id),
  ],
  () => {
    if (!kinds.value.includes(activeKind.value as Kind)) activeKind.value = kinds.value[0] || '';
    for (const k of ['objective', 'subjective', 'practical'] as Kind[])
      if (!list(k).some((q) => q.id === selected.value[k]))
        selected.value[k] = list(k)[0]?.id || '';
  },
  { immediate: true },
);
async function focusField(field: string) {
  await nextTick();
  const el = root.value?.querySelector<HTMLElement>(`[data-field="${field}"]`);
  el?.focus({ preventScroll: true });
  el?.scrollIntoView({ block: 'center', behavior: 'instant' });
}
async function focusIssue(issue: CourseIssue) {
  if (!kinds.value.includes(issue.kind as Kind)) return;
  activeKind.value = issue.kind as Kind;
  if (issue.itemId) selected.value[activeKind.value] = issue.itemId;
  await focusField(issue.field);
}
async function add() {
  if (props.disabled || !activeKind.value) return;
  const id = crypto.randomUUID(),
    kind = activeKind.value;
  if (kind === 'objective')
    props.course.questions.push({
      id,
      prompt: '',
      choices: ['', ''],
      correct: null,
      points: 1,
      category: 'written',
    });
  else if (kind === 'subjective')
    props.course.subjectiveQuestions.push({
      id,
      prompt: '',
      points: 1,
      rubric: '',
      modelAnswer: '',
    });
  else props.course.practicalItems.push({ id, title: '', criterion: '', mandatory: true });
  selected.value[kind] = id;
  await focusField(kind === 'practical' ? 'title' : 'prompt');
}
function askDelete() {
  const q = current.value,
    k = activeKind.value;
  if (props.disabled || !q || !k) return;
  const hasContent =
    'prompt' in q
      ? !!q.prompt.trim() ||
        ('choices' in q
          ? q.choices.some((v) => v.trim())
          : !!q.rubric?.trim() || !!q.modelAnswer?.trim())
      : !!q.title.trim() || !!q.criterion.trim();
  pendingDelete.value = { kind: k, id: q.id, title: `${kindLabels[k]} ${position.value}번` };
  if (!hasContent) remove();
}
async function remove() {
  const target = pendingDelete.value;
  if (!target || props.disabled) return;
  const values = list(target.kind),
    index = values.findIndex((q) => q.id === target.id);
  if (index >= 0) {
    const neighbor = values[index + 1] || values[index - 1];
    values.splice(index, 1);
    selected.value[target.kind] = neighbor?.id || '';
  }
  const modalOpen = !!root.value?.querySelector('dialog[open]');
  restoreAfterDelete = true;
  pendingDelete.value = null;
  if (!modalOpen) await restoreQuestionFocus();
}
defineExpose({ focusIssue });
</script>
<template>
  <section ref="root" class="assessment-editor panel" aria-label="평가 기준">
    <header class="assessment-heading">
      <h2>평가 기준</h2>
      <p class="muted">
        평가 유형을 선택한 뒤 문항을 편집하세요. 정답·채점 기준은 관리자와 지정 평가자에게만
        공개됩니다.
      </p>
    </header>
    <CompactTabs
      ref="typeTabs"
      class="assessment-type-tabs"
      v-model="activeKind"
      :items="typeOptions"
      label="평가 유형"
      :panel-id="`${uid}-type-panel`"
    />
    <div
      v-if="activeKind"
      :id="`${uid}-type-panel`"
      role="tabpanel"
      :aria-labelledby="typeTabs?.tabId(activeKind)"
      class="assessment-type-panel"
    >
      <div class="assessment-settings">
        <label v-if="activeKind === 'objective'" class="field"
          ><span>객관식 합격 기준 (%)</span
          ><input
            aria-label="객관식 합격 기준 (%)"
            v-model.number="course.passScore"
            :disabled="disabled"
            data-field="passScore"
            type="number"
            min="1"
            max="100"
            placeholder="미정"
            :aria-invalid="!!typeErrors.passScore"
          /><span v-if="typeErrors.passScore" class="field-error">{{
            typeErrors.passScore
          }}</span></label
        >
        <label v-else-if="activeKind === 'subjective'" class="field"
          ><span>주관식 합격 기준 (%)</span
          ><input
            aria-label="주관식 합격 기준 (%)"
            v-model.number="course.subjectivePassScore"
            :disabled="disabled"
            data-field="passScore"
            type="number"
            min="1"
            max="100"
            placeholder="미정"
            :aria-invalid="!!typeErrors.passScore"
          /><span v-if="typeErrors.passScore" class="field-error">{{
            typeErrors.passScore
          }}</span></label
        >
        <label v-else class="field full-width"
          ><span>수행 조건</span
          ><textarea v-model="course.instruction" :disabled="disabled" rows="2" />
        </label>
      </div>
      <div class="question-navigation">
        <CompactTabs
          ref="itemTabs"
          class="question-tabs"
          v-model="selectedId"
          :items="itemOptions"
          :label="`${kindLabels[activeKind]} 문항`"
          :panel-id="`${uid}-item-panel`"
        />
        <button
          v-if="!disabled"
          class="button secondary"
          type="button"
          data-field="add"
          @click="add"
        >
          {{ activeKind === 'practical' ? '항목 추가' : '문항 추가' }}
        </button>
      </div>
      <p v-if="typeErrors.add" class="field-error">{{ typeErrors.add }}</p>
      <div
        v-if="current"
        :id="`${uid}-item-panel`"
        role="tabpanel"
        :aria-labelledby="itemTabs?.tabId(current.id)"
        class="assessment-item-panel"
        :key="current.id"
      >
        <div class="question-toolbar">
          <h3>{{ kindLabels[activeKind] }} {{ position }}번</h3>
          <label v-if="'category' in current" class="field"
            ><span>문항 분류</span
            ><select v-model="current.category" :disabled="disabled">
              <option value="written">필기</option>
              <option value="case">Case</option>
            </select></label
          >
          <label v-if="'points' in current" class="field"
            ><span>배점</span
            ><input
              v-model.number="current.points"
              :disabled="disabled"
              data-field="points"
              aria-label="배점"
              :aria-describedby="errors.points ? uid + '-points-error' : undefined"
              type="number"
              min="1"
              :aria-invalid="!!errors.points"
            /><span v-if="errors.points" :id="uid + '-points-error'" class="field-error">{{
              errors.points
            }}</span></label
          >
          <label v-if="'mandatory' in current" class="checkbox-label"
            ><input
              v-model="current.mandatory"
              :disabled="disabled"
              data-field="mandatory"
              type="checkbox"
            />필수 실기 항목</label
          >
          <button
            v-if="!disabled"
            class="text-link question-delete"
            type="button"
            @click="askDelete"
          >
            {{ activeKind === 'practical' ? '항목 삭제' : '문항 삭제' }}
          </button>
        </div>
        <p v-if="errors.mandatory" class="field-error">{{ errors.mandatory }}</p>
        <label v-if="'prompt' in current" class="field"
          ><span>문항</span
          ><textarea
            v-model="current.prompt"
            :disabled="disabled"
            data-field="prompt"
            aria-label="문항"
            :aria-describedby="errors.prompt ? uid + '-prompt-error' : undefined"
            rows="3"
            :aria-invalid="!!errors.prompt"
          /><span v-if="errors.prompt" :id="uid + '-prompt-error'" class="field-error">{{
            errors.prompt
          }}</span></label
        >
        <ObjectiveChoices
          v-if="'choices' in current"
          v-model:choices="current.choices"
          v-model:correct="current.correct"
          :disabled="disabled"
          :errors="errors"
        />
        <div v-else-if="'rubric' in current" class="subjective-fields">
          <label class="field"
            ><span>모범답안 · 선택</span
            ><textarea
              v-model="current.modelAnswer"
              :disabled="disabled"
              data-field="modelAnswer"
              rows="5"
            />
          </label>
          <label class="field"
            ><span>채점 기준</span
            ><textarea
              v-model="current.rubric"
              :disabled="disabled"
              data-field="rubric"
              aria-label="채점 기준"
              :aria-describedby="errors.rubric ? uid + '-rubric-error' : undefined"
              rows="5"
              :aria-invalid="!!errors.rubric"
            /><span v-if="errors.rubric" :id="uid + '-rubric-error'" class="field-error">{{
              errors.rubric
            }}</span></label
          >
        </div>
        <template v-else-if="'criterion' in current">
          <label class="field"
            ><span>항목명</span
            ><input
              v-model="current.title"
              :disabled="disabled"
              data-field="title"
              aria-label="항목명"
              :aria-describedby="errors.title ? uid + '-title-error' : undefined"
              :aria-invalid="!!errors.title"
            /><span v-if="errors.title" :id="uid + '-title-error'" class="field-error">{{
              errors.title
            }}</span></label
          >
          <label class="field"
            ><span>관찰·판정 기준</span
            ><textarea
              v-model="current.criterion"
              :disabled="disabled"
              data-field="criterion"
              aria-label="관찰·판정 기준"
              :aria-describedby="errors.criterion ? uid + '-criterion-error' : undefined"
              rows="4"
              :aria-invalid="!!errors.criterion"
            /><span v-if="errors.criterion" :id="uid + '-criterion-error'" class="field-error">{{
              errors.criterion
            }}</span></label
          >
        </template>
      </div>
      <p v-else class="empty-state">
        등록된 {{ activeKind === 'practical' ? '실기 항목' : '문항' }}이 없습니다.{{
          disabled ? '' : ' 추가 버튼으로 작성을 시작하세요.'
        }}
      </p>
    </div>
    <p v-else class="empty-state">
      필수 평가 유형을 선택하면 해당 평가 기준을 편집할 수 있습니다. 작성한 문항은 유형을 해제해도
      유지됩니다.
    </p>
    <AppDialog
      :open="!!pendingDelete"
      title="문항 삭제"
      @update:open="pendingDelete = null"
      @closed="restoreQuestionFocus"
      ><p>
        {{ pendingDelete?.title }}의 작성 내용을 삭제할까요? 초안 저장 전까지 서버의 기준에는
        반영되지 않습니다.
      </p>
      <template #footer
        ><button class="button secondary" @click="pendingDelete = null">취소</button
        ><button class="button primary" @click="remove">삭제</button></template
      ></AppDialog
    >
  </section>
</template>
