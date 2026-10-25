<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { useChecklistMemory } from '../composables/useChecklistMemory';
import { onBeforeRouteLeave } from 'vue-router';
import type { Course, Enrollment } from '@eks/contracts';
import { learningTypeLabels } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import { ApiError } from '../api';
import { confirmAction } from '../composables/useConfirmation';
const props = defineProps<{ course: Course; enrollment: Enrollment; blocked: boolean }>();
const store = useDemo();
const { busy, error, pending } = toRefs(useChecklistMemory(props.enrollment.id));
const items = computed(() =>
  [...props.course.learningItems].sort((a, b) => Number(b.required) - Number(a.required)),
);
const required = computed(() => items.value.filter((i) => i.required));
const checked = (id: string) =>
  pending.value?.itemId === id
    ? pending.value.checked
    : !!props.enrollment.checklist?.items.some((i) => i.itemId === id);
const completed = computed(
  () =>
    required.value.filter((i) => props.enrollment.checklist?.items.some((v) => v.itemId === i.id))
      .length,
);

async function save() {
  if (busy.value || !pending.value) return;
  const id = props.enrollment.id,
    actor = store.actorId;
  busy.value = true;
  error.value = '';
  try {
    await store.command(`/enrollments/${id}/checklist`, pending.value, 'PUT');
    if (actor === store.actorId && id === props.enrollment.id) pending.value = null;
  } catch (e) {
    if (actor === store.actorId && id === props.enrollment.id) {
      error.value = (e as Error).message;
      if (e instanceof ApiError && e.status === 409) {
        try {
          await store.refresh();
          pending.value = null;
        } catch {
          error.value += ' 최신 확인 상태를 불러오지 못했습니다. 다시 시도해 주세요.';
        }
      }
    }
  } finally {
    busy.value = false;
  }
}
function change(itemId: string, event: Event) {
  pending.value = {
    revision: props.enrollment.checklist?.revision || 0,
    itemId,
    checked: (event.target as HTMLInputElement).checked,
  };
  void save();
}
onBeforeRouteLeave(
  async () =>
    !busy.value &&
    (!pending.value ||
      (await confirmAction(
        '완료 확인이 저장되지 않았습니다. 현재 화면을 떠날까요?',
        '저장하지 않고 이동',
      ))),
);
</script>
<template>
  <section class="auditor-checklist" aria-label="Auditor 학습 완료 확인" :aria-busy="busy">
    <div class="section-heading">
      <h3>학습 완료 확인</h3>
      <strong>필수 완료 {{ completed }}/{{ required.length }}</strong>
    </div>
    <p class="muted">
      {{
        enrollment.completion
          ? '수료가 확정되어 확인 기록을 변경할 수 없습니다.'
          : '필수 항목을 모두 체크하면 자동으로 수료됩니다. 수료 후에는 체크를 해제할 수 없습니다.'
      }}
    </p>
    <p v-if="blocked" class="error-message">진행이 제한되어 완료 확인을 저장할 수 없습니다.</p>
    <div class="auditor-checklist-items">
      <label v-for="item in items" :key="item.id" class="auditor-check-item">
        <input
          type="checkbox"
          :checked="checked(item.id)"
          :disabled="blocked || busy || !!pending || !!enrollment.completion"
          @change="change(item.id, $event)"
        />
        <span
          ><strong>{{ item.title }}</strong
          ><small
            >{{ learningTypeLabels[item.type] }} · {{ item.required ? '필수' : '선택'
            }}<template v-if="enrollment.checklist?.items.find((v) => v.itemId === item.id)">
              · 확인 완료</template
            ></small
          ></span
        >
      </label>
    </div>
    <p v-if="!items.length" class="muted">
      등록된 학습항목이 없습니다. 관리자에게 기준을 확인해 주세요.
    </p>
    <p v-if="busy" role="status" class="muted">완료 확인을 저장하고 있습니다.</p>
    <div v-if="error" role="alert">
      <p class="error-message">{{ error }}</p>
      <button v-if="pending" class="button secondary" :disabled="busy" @click="save">
        완료 확인 재시도
      </button>
    </div>
    <RouterLink
      v-if="enrollment.completion"
      :to="`/completions/${enrollment.completion.id}`"
      class="text-link"
      >수료증 보기</RouterLink
    >
  </section>
</template>
<style scoped>
.auditor-checklist {
  display: grid;
  gap: 12px;
}
.auditor-checklist h3 {
  font-size: 18px;
}
.auditor-checklist-items {
  max-height: 480px;
  overflow: auto;
  border-block: 1px solid var(--line);
}
.auditor-check-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 56px;
  padding: 12px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}
.auditor-check-item:last-child {
  border-bottom: 0;
}
.auditor-check-item input {
  margin-top: 3px;
  min-width: 18px;
  min-height: 18px;
}
.auditor-check-item strong {
  display: block;
  font-size: 14px;
  font-weight: 500;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.auditor-check-item small {
  display: block;
  font-size: 13px;
  color: var(--ink-secondary);
  margin-top: 4px;
}
.auditor-check-item:has(:checked) {
  background: var(--surface-tint);
}
.auditor-check-item:focus-within {
  outline: 2px solid var(--primary-press);
  outline-offset: -2px;
}
@media (max-width: 768px) {
  .auditor-checklist-items {
    max-height: none;
    overflow: visible;
  }
  .auditor-check-item {
    min-height: 56px;
  }
}
</style>
