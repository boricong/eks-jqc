<script setup lang="ts">
import { releaseVersionLabel } from '@eks/contracts';
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import type { OrganizationRequirementsView, RequirementsPreview } from '@eks/contracts';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import { confirmAction } from '../composables/useConfirmation';
const props = defineProps<{ organizationId?: string; entityId?: string; disabled?: boolean }>(),
  emit = defineEmits<{ dirty: [boolean]; busy: [boolean]; saved: [] }>(),
  store = useDemo();
const data = ref<OrganizationRequirementsView>(),
  draft = ref<Record<string, string[]>>({}),
  busy = ref(false),
  error = ref(''),
  preview = ref<RequirementsPreview>();
let generation = 0;
const changed = computed(
  () =>
    !!data.value &&
    data.value.entries.some(
      (e) => JSON.stringify(draft.value[e.id] || []) !== JSON.stringify(e.directEntityIds),
    ),
);
const org = computed(() => data.value?.entries.find((e) => e.id === props.organizationId));
const names = (ids: string[]) =>
  ids
    .map((id) => data.value?.qualifications.find((q) => q.entityId === id)?.title || id)
    .join(', ');
watch(changed, (v) => emit('dirty', v));
watch(busy, (v) => emit('busy', v));
async function load(preserveInput = false) {
  const edits = preserveInput
    ? data.value?.entries
        .filter(
          (e) => JSON.stringify(draft.value[e.id] || []) !== JSON.stringify(e.directEntityIds),
        )
        .map((e) => ({ id: e.id, ids: [...(draft.value[e.id] || [])] })) || []
    : [];
  const seq = ++generation;
  if (props.disabled) {
    busy.value = false;
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const d = await api<OrganizationRequirementsView>(
      store.managementPath('/organization-qualification-requirements'),
    );
    if (seq !== generation) return;
    data.value = d;
    draft.value = Object.fromEntries(d.entries.map((e) => [e.id, [...e.directEntityIds]]));
    for (const e of edits) if (d.entries.some((o) => o.id === e.id)) draft.value[e.id] = e.ids;
    preview.value = undefined;
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message;
  } finally {
    if (seq === generation) busy.value = false;
  }
}
watch(
  () => [props.organizationId, props.entityId, store.actorId, store.managementLv1, props.disabled],
  () => load(),
  { immediate: true },
);
function toggle(orgId: string, entityId: string, on: boolean) {
  draft.value[orgId] = on
    ? [...new Set([...(draft.value[orgId] || []), entityId])]
    : (draft.value[orgId] || []).filter((id) => id !== entityId);
  preview.value = undefined;
}
const payload = () => ({
  stateRevision: data.value!.stateRevision,
  organizationRevision: data.value!.organizationRevision,
  changes: data
    .value!.entries.filter(
      (e) => JSON.stringify(draft.value[e.id] || []) !== JSON.stringify(e.directEntityIds),
    )
    .map((e) => ({ organizationId: e.id, entityIds: draft.value[e.id] || [] })),
});
async function review() {
  if (props.disabled || busy.value || !changed.value) return;
  busy.value = true;
  error.value = '';
  const seq = generation;
  try {
    const result = await api<RequirementsPreview>(
      store.managementPath('/organization-qualification-requirements/preview'),
      { method: 'POST', body: JSON.stringify(payload()) },
    );
    if (seq === generation) preview.value = result;
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message;
  } finally {
    if (seq === generation) busy.value = false;
  }
}
async function save() {
  if (props.disabled || busy.value || !preview.value) return;
  busy.value = true;
  error.value = '';
  const seq = generation;
  try {
    const { affected, ...body } = preview.value;
    await store.command(
      store.managementPath('/organization-qualification-requirements'),
      body,
      'PUT',
    );
    if (seq !== generation) return;
    await load();
    emit('saved');
    store.notify('조직 필요자격을 저장했습니다. 새 요청부터 적용됩니다.');
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message;
  } finally {
    if (seq === generation) busy.value = false;
  }
}
async function canLeave() {
  return (
    !busy.value &&
    (!changed.value ||
      (await confirmAction(
        '저장하지 않은 필요자격 변경이 있습니다. 변경을 버릴까요?',
        '변경 버리고 이동',
      )))
  );
}
async function reload() {
  if (await canLeave()) await load();
}
function beforeUnload(e: BeforeUnloadEvent) {
  if (changed.value || busy.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeRouteLeave(() => (props.organizationId ? true : canLeave()));
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload);
  generation++;
  emit('dirty', false);
  emit('busy', false);
});
defineExpose({ canLeave });
</script>
<template>
  <section class="needs-editor">
    <h3>{{ entityId ? '필요 조직 설정' : '조직 필요자격' }}</h3>
    <p v-if="error" role="alert" class="error-message">
      {{ error }}
      <button class="button secondary" :disabled="disabled || busy" @click="reload">
        다시 불러오기
      </button>
      <button
        v-if="changed"
        class="button secondary"
        :disabled="disabled || busy"
        @click="load(true)"
      >
        입력 유지하고 기준 갱신
      </button>
    </p>
    <template v-if="data">
      <template v-if="entityId">
        <p>자격: {{ names([entityId]) }}</p>
        <div v-for="e in data.entries" :key="e.id" class="need-row">
          <label
            ><input
              type="checkbox"
              :checked="draft[e.id]?.includes(entityId)"
              :disabled="
                disabled ||
                busy ||
                !e.editable ||
                (!draft[e.id]?.includes(entityId) &&
                  (!e.effectiveActive ||
                    !!data.qualifications.find((q) => q.entityId === entityId)?.issues.length))
              "
              @change="toggle(e.id, entityId, ($event.target as HTMLInputElement).checked)"
            />{{ e.path.map((p) => p.name).join(' › ') }} · 직접 지정</label
          >
          <p
            v-if="
              e.effective.some(
                (q) => q.entityId === entityId && q.sourceOrganizations.some((o) => o.id !== e.id),
              )
            "
            class="muted"
          >
            상위 조직에서 상속 ·
            {{
              e.effective
                .find((q) => q.entityId === entityId)
                ?.sourceOrganizations.filter((o) => o.id !== e.id)
                .map((o) => o.name)
                .join(', ')
            }}
          </p>
        </div>
      </template>
      <template v-else-if="org">
        <h4>직접 지정</h4>
        <div class="need-choices" role="group" aria-label="직접 지정 필요자격 목록" tabindex="0">
          <div v-for="q in data.qualifications" :key="q.entityId" class="need-row">
            <label
              ><input
                type="checkbox"
                :checked="draft[org.id]?.includes(q.entityId)"
                :disabled="
                  disabled ||
                  busy ||
                  !org.editable ||
                  (!draft[org.id]?.includes(q.entityId) &&
                    (!org.effectiveActive || !!q.issues.length))
                "
                @change="toggle(org.id, q.entityId, ($event.target as HTMLInputElement).checked)"
              />{{ q.title }} · {{ releaseVersionLabel(q) }}</label
            >
            <details v-if="q.issues.length" class="muted">
              <summary>운영 준비 확인 필요 · {{ q.issues.length }}개 사유</summary>
              <ul>
                <li v-for="(issue, index) in q.issues" :key="index">{{ issue }}</li>
              </ul>
            </details>
          </div>
        </div>
        <p v-if="!data.qualifications.length" class="muted">
          지정할 수 있는 자격이 없습니다. 팀 자격을 먼저 준비해 주세요.
        </p>
        <h4>상속된 필요자격</h4>
        <div
          v-for="q in org.effective.filter((q) =>
            q.sourceOrganizations.some((o) => o.id !== org!.id),
          )"
          :key="q.entityId"
          class="need-row"
        >
          {{ q.title }}
          <p class="muted">
            {{
              q.sourceOrganizations
                .filter((o) => o.id !== org!.id)
                .map((o) => o.name)
                .join(', ')
            }}에서 상속 · 해당 상위 조직에서만 해제할 수 있습니다.
          </p>
        </div>
        <h4>최종 적용 목록 · 저장된 기준 {{ org.effective.length }}개</h4>
        <p v-if="!org.effective.length">필요자격 미지정 · 계획 요청 대상에서 제외됩니다.</p>
        <div v-for="q in org.effective" :key="q.entityId" class="need-row">
          {{ q.title }} · {{ q.sourceOrganizations.map((o) => o.name).join(', ') }}
          <p v-if="q.issues.length" class="error-message">
            {{ q.issues.join(' · ') }} · 새 요청 보류
          </p>
        </div>
      </template>
      <div v-if="preview" class="needs-review" aria-live="polite">
        <h4>필요자격 변경 확인</h4>
        <p v-for="c in preview.changes" :key="c.organizationId">
          {{ data.entries.find((e) => e.id === c.organizationId)?.name }}: 직접 지정
          {{ names(c.entityIds) || '없음' }}
        </p>
        <p v-for="e in preview.affected" :key="e.organizationId">
          {{ e.name }} · 추가 {{ names(e.added) || '없음' }} · 해제 {{ names(e.removed) || '없음' }}
        </p>
        <p>이미 발송한 요청과 기존 학습 기록은 변경되지 않습니다.</p>
        <button class="button primary" :disabled="disabled || busy" @click="save">
          필요자격 저장
        </button>
      </div>
      <button
        v-else
        class="button primary needs-confirm"
        :disabled="disabled || busy || !changed"
        @click="review"
      >
        필요자격 변경 확인
      </button>
    </template>
  </section>
</template>
<style scoped>
.needs-editor {
  min-width: 0;
}
.need-choices {
  border: 1px solid var(--line, #e3e8ee);
  border-radius: 6px;
  max-height: 394px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.need-choices > .need-row {
  min-height: 49px;
  box-sizing: border-box;
  padding: 12px;
}
.need-choices > .need-row:last-child {
  border-bottom: 0;
}
.need-choices:focus-visible {
  outline: 2px solid var(--primary, #533afd);
  outline-offset: 2px;
}
.needs-confirm {
  display: block;
  margin-left: auto;
}
.need-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--hairline, #e3e8ee);
  overflow-wrap: anywhere;
}
.need-row label {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 24px;
}
.need-row input {
  flex-shrink: 0;
}
.needs-review {
  border-top: 1px solid var(--hairline, #e3e8ee);
  padding: 16px 0;
}
.needs-editor button {
  margin-top: 12px;
}
</style>
