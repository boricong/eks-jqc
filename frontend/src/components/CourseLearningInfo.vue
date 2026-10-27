<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { learningTypeLabels, materialTypeLabels, type CourseContent } from '@eks/contracts';
import { randomUUID } from '../uuid';
import { confirmAction } from '../composables/useConfirmation';
import { materialUrlIssue, type CourseIssue } from '../course-editor';
import CompactTabs from './CompactTabs.vue';

const props = defineProps<{
  course: CourseContent;
  disabled?: boolean;
  readonly?: boolean;
  issues?: CourseIssue[];
}>();
const uid = useId();
const root = ref<HTMLElement>();
const tabs = ref<InstanceType<typeof CompactTabs>>();
const activeKey = ref('');
const blockedUrlId = ref('');
let initialMaterials = new Map<string, string>();
const rows = computed(() => [
  ...props.course.learningItems.map((item, index) => ({
    id: `education-${item.id}`,
    itemId: item.id,
    kind: 'learning' as const,
    index,
    label: `교육 ${index + 1}`,
    title: item.title,
    invalid: !item.title.trim(),
  })),
  ...props.course.materials.map((item, index) => ({
    id: `material-${item.id}`,
    itemId: item.id,
    kind: 'materials' as const,
    index,
    label: `자료 ${index + 1}`,
    title: item.title,
    invalid:
      !item.title.trim() ||
      (item.type === 'text' ? !item.content.trim() : !item.url || !!materialUrlIssue(item)),
  })),
]);
const options = computed(() =>
  rows.value.map((row) => ({
    id: row.id,
    label: row.label,
    ariaLabel: `${row.label} · ${row.title.trim() || '이름 없음'}`,
    invalid: !props.readonly && row.invalid,
  })),
);
const active = computed(() => rows.value.find((row) => row.id === activeKey.value));
const education = computed(() =>
  active.value?.kind === 'learning' ? props.course.learningItems[active.value.index] : undefined,
);
const material = computed(() =>
  active.value?.kind === 'materials' ? props.course.materials[active.value.index] : undefined,
);
const groupLength = computed(() =>
  active.value?.kind === 'learning'
    ? props.course.learningItems.length
    : props.course.materials.length,
);
const editable = computed(() => !props.disabled && !props.readonly);
const activeIssues = computed(() => {
  const issues = (props.issues || []).filter(
    (issue) =>
      issue.kind === active.value?.kind && (!issue.itemId || issue.itemId === active.value.itemId),
  );
  const blocked = material.value?.id === blockedUrlId.value && materialUrlIssue(material.value);
  return blocked && !issues.some((issue) => issue.field === 'url') ? [...issues, blocked] : issues;
});
watch(
  () => [props.course, ...rows.value.map((row) => row.id)],
  (value, previous) => {
    if (value[0] !== previous?.[0]) {
      blockedUrlId.value = '';
      initialMaterials = new Map(
        props.course.materials.map((item) => [item.id, JSON.stringify(item)]),
      );
    }
    if (value[0] !== previous?.[0] || !rows.value.some((row) => row.id === activeKey.value))
      activeKey.value = rows.value[0]?.id || '';
  },
  { immediate: true },
);

async function focusField(field: string) {
  await nextTick();
  const element =
    root.value?.querySelector<HTMLElement>(`[data-info-field="${field}"]`) ||
    root.value?.querySelector<HTMLElement>('.education-add');
  element?.focus({ preventScroll: true });
  element?.scrollIntoView({ block: 'nearest' });
}
function add(kind: 'learning' | 'materials') {
  if (!editable.value) return;
  const id = randomUUID();
  if (kind === 'learning')
    props.course.learningItems.push({ id, type: 'mtc', title: '', required: true });
  else
    props.course.materials.push({
      id,
      type: 'text',
      title: '',
      content: '',
      url: '',
      description: '',
    });
  activeKey.value = `${kind === 'learning' ? 'education' : 'material'}-${id}`;
  void focusField('title');
}
function move(delta: number) {
  const row = active.value;
  if (!editable.value || !row || row.index + delta < 0 || row.index + delta >= groupLength.value)
    return;
  const list = row.kind === 'learning' ? props.course.learningItems : props.course.materials;
  const [item] = list.splice(row.index, 1);
  // Both arrays keep their original item type; an item never moves across groups.
  (list as unknown[]).splice(row.index + delta, 0, item!);
}
async function remove() {
  const row = active.value,
    course = props.course;
  if (!editable.value || !row) return;
  if (
    !(await confirmAction(
      `이 ${row.kind === 'learning' ? '교육을' : '자료를'} 삭제할까요?`,
      '학습 정보 삭제',
    ))
  )
    return;
  if (!editable.value || course !== props.course || activeKey.value !== row.id) return;
  const position = rows.value.findIndex((value) => value.id === row.id);
  const next = rows.value[position + 1] || rows.value[position - 1];
  if (row.kind === 'learning') props.course.learningItems.splice(row.index, 1);
  else props.course.materials.splice(row.index, 1);
  activeKey.value = next?.id || '';
  await nextTick();
  (
    root.value?.querySelector<HTMLElement>('[aria-selected="true"]') ||
    root.value?.querySelector<HTMLElement>('.education-add')
  )?.focus();
}
async function focusIssue(issue: CourseIssue) {
  const row = rows.value.find(
    (row) => row.kind === issue.kind && (!issue.itemId || row.itemId === issue.itemId),
  );
  if (row) activeKey.value = row.id;
  await focusField(issue.field);
}
function commit(): CourseIssue | undefined {
  const issue = props.course.materials.map(materialUrlIssue).find(Boolean);
  if (issue) {
    blockedUrlId.value = issue.itemId || '';
    return issue;
  }
  if (editable.value)
    for (const item of props.course.materials) {
      if (initialMaterials.get(item.id) === JSON.stringify(item)) continue;
      if (item.type === 'text') item.url = '';
      else item.content = '';
    }
  blockedUrlId.value = '';
}
defineExpose({ focusIssue, commit });
</script>

<template>
  <section ref="root" class="panel editor-panel learning-info" aria-label="학습 정보">
    <div class="section-heading">
      <h2>
        학습 정보
        <span class="editor-count"
          >교육 {{ course.learningItems.length }}개 · 자료 {{ course.materials.length }}개</span
        >
      </h2>
      <div v-if="!readonly" class="actions info-add-actions">
        <button
          class="button secondary education-add"
          type="button"
          :disabled="disabled || course.learningItems.length >= 100"
          @click="add('learning')"
        >
          교육 추가
        </button>
        <button
          class="button secondary"
          type="button"
          :disabled="disabled || course.materials.length >= 100"
          @click="add('materials')"
        >
          자료 추가
        </button>
      </div>
    </div>
    <div class="number-editor" :class="{ 'is-empty': !active }">
      <div v-if="rows.length" class="question-navigation">
        <CompactTabs
          ref="tabs"
          v-model="activeKey"
          :items="options"
          label="학습 정보 항목"
          :panel-id="`${uid}-panel`"
          vertical
          class="number-tabs"
        />
      </div>
      <div
        v-if="active"
        :id="`${uid}-panel`"
        role="tabpanel"
        :aria-labelledby="tabs?.tabId(active.id)"
        class="learning-tab-panel"
      >
        <div class="question-toolbar">
          <h3>{{ active.label }}</h3>
          <div v-if="!readonly" class="actions info-item-actions">
            <button
              type="button"
              class="text-link"
              :disabled="disabled || active.index === 0"
              @click="move(-1)"
              :aria-label="`${active.label} 위로`"
            >
              위로
            </button>
            <button
              type="button"
              class="text-link"
              :disabled="disabled || active.index === groupLength - 1"
              @click="move(1)"
              :aria-label="`${active.label} 아래로`"
            >
              아래로
            </button>
            <button type="button" class="text-link" :disabled="disabled" @click="remove">
              이 항목 삭제
            </button>
          </div>
        </div>
        <div v-if="activeIssues.length && !readonly" :id="`${uid}-errors`" role="alert">
          <p v-for="issue in activeIssues" :key="issue.field" class="field-error">
            {{ issue.message }}
          </p>
        </div>
        <template v-if="readonly">
          <p class="small-label">
            {{
              education
                ? learningTypeLabels[education.type]
                : material
                  ? materialTypeLabels[material.type]
                  : ''
            }}
          </p>
          <h4>{{ active.title || '이름 없음' }}</h4>
          <p v-if="education">{{ education.required ? '필수 교육' : '선택 교육' }}</p>
          <template v-if="material">
            <p v-if="material.description" class="prose-text">{{ material.description }}</p>
            <div v-if="material.type === 'text'" class="material-content">
              {{ material.content }}
            </div>
            <a
              v-else-if="/^https?:\/\//i.test(material.url)"
              :href="material.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-link"
              >{{ material.url }}</a
            >
            <p v-else class="muted">자료 링크를 확인할 수 없습니다.</p>
          </template>
        </template>
        <template v-else-if="education">
          <div class="form-grid learning-fields">
            <label class="field"
              ><span>교육 종류</span
              ><select v-model="education.type" aria-label="교육 종류" :disabled="disabled">
                <option v-for="(label, type) in learningTypeLabels" :key="type" :value="type">
                  {{ label }}
                </option>
              </select></label
            >
            <label class="field"
              ><span>교육명</span
              ><input
                v-model="education.title"
                maxlength="300"
                data-info-field="title"
                :disabled="disabled"
                :aria-invalid="!education.title.trim()"
                :aria-describedby="activeIssues.length ? `${uid}-errors` : undefined"
            /></label>
          </div>
          <label class="checkbox-label"
            ><input
              v-model="education.required"
              type="checkbox"
              data-info-field="required"
              :disabled="disabled"
            />필수 교육</label
          >
        </template>
        <template v-else-if="material">
          <div class="form-grid material-fields">
            <label class="field"
              ><span>자료 유형</span
              ><select v-model="material.type" aria-label="자료 유형" :disabled="disabled">
                <option v-for="(label, type) in materialTypeLabels" :key="type" :value="type">
                  {{ label }}
                </option>
              </select></label
            >
            <label class="field"
              ><span>자료명</span
              ><input
                v-model="material.title"
                maxlength="300"
                data-info-field="title"
                :disabled="disabled"
                :aria-invalid="!material.title.trim()"
                :aria-describedby="activeIssues.length ? `${uid}-errors` : undefined"
            /></label>
          </div>
          <label v-if="material.type === 'text'" class="field"
            ><span>본문</span
            ><textarea
              v-model="material.content"
              rows="6"
              maxlength="20000"
              data-info-field="content"
              :disabled="disabled"
              :aria-describedby="activeIssues.length ? `${uid}-errors` : undefined"
            />
          </label>
          <template v-else>
            <label class="field"
              ><span>URL</span
              ><input
                v-model="material.url"
                type="url"
                placeholder="https://"
                data-info-field="url"
                :disabled="disabled"
                :aria-invalid="!!materialUrlIssue(material)"
                :aria-describedby="activeIssues.length ? `${uid}-errors` : undefined"
            /></label>
            <label class="field"
              ><span>설명 · 선택</span
              ><textarea
                v-model="material.description"
                rows="2"
                maxlength="20000"
                :disabled="disabled"
              />
            </label>
          </template>
        </template>
      </div>
      <p v-else class="editor-empty">등록된 학습 정보가 없습니다.</p>
    </div>
    <p
      v-if="
        !course.learningItems.length &&
        !readonly &&
        issues?.some((issue) => issue.kind === 'learning' && issue.field === 'required')
      "
      class="field-error"
    >
      운영하려면 필수 교육을 하나 이상 설정해 주세요.
    </p>
  </section>
</template>

<style scoped>
.learning-info.panel {
  padding-left: 0;
  padding-right: 0;
  margin-bottom: 0;
}
.learning-info .editor-count {
  margin-left: 8px;
  font-size: var(--text-caption);
  font-weight: var(--weight-body);
  color: var(--ink-muted);
  white-space: nowrap;
}
.learning-info .number-editor {
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 0;
  border: 1px solid var(--line);
  background: var(--surface);
}
.learning-info .number-editor.is-empty {
  grid-template-columns: minmax(0, 1fr);
  border: 0;
}
.learning-info .question-navigation {
  background: var(--surface-tint);
  box-shadow: inset -1px 0 var(--line);
}
.learning-info .number-tabs {
  gap: 0;
  padding: 0;
  max-height: 560px;
  overflow-y: auto;
}
.learning-info :deep([role='tab']) {
  min-width: 44px;
  min-height: 44px;
  width: 100%;
  padding: 6px 4px;
  border: 0;
  border-left: 3px solid transparent;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  font-size: 14px;
}
.learning-info :deep([aria-selected='true']) {
  border-left-color: var(--primary);
  background: var(--surface);
  color: var(--primary-hover);
}
.learning-info :deep([role='tab']:focus-visible) {
  outline-offset: -4px;
}
.learning-tab-panel {
  min-width: 0;
  padding: 16px;
}
.learning-tab-panel h4,
.learning-tab-panel a {
  overflow-wrap: anywhere;
}
.info-add-actions,
.info-item-actions {
  flex-wrap: wrap;
}
.info-item-actions {
  gap: 12px;
}
.info-item-actions button {
  min-height: 44px;
}
@media (max-width: 767px) {
  .learning-info .number-editor {
    grid-template-columns: 64px minmax(0, 1fr);
  }
  .learning-info .number-editor.is-empty {
    grid-template-columns: minmax(0, 1fr);
  }
  .learning-tab-panel {
    padding: 12px;
  }
  .learning-info .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .learning-info .section-heading,
  .learning-info .question-toolbar {
    flex-wrap: wrap;
  }
}
</style>
