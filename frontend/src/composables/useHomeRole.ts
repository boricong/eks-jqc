import { computed, ref, watch } from 'vue';
import type { Role } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import { DATASET_EVENT } from '../data-generation';

const prefix = 'eks-home-role-';
const choices: { id: Role; label: string }[] = [
  { id: 'learner', label: '학습자 인증 · Auditee' },
  { id: 'evaluator', label: '평가자 인증 · Auditor' },
  { id: 'admin', label: '팀 관리' },
  { id: 'organization_admin', label: '조직 관리' },
  { id: 'system_operator', label: '시스템 운영' },
];
const memories = new Map<string, string>();
function remember(id: string, role: string) {
  memories.set(id, role);
  try {
    sessionStorage.setItem(prefix + id, role);
  } catch {
    /* In-memory fallback. */
  }
}
function recalled(id: string) {
  try {
    return sessionStorage.getItem(prefix + id) || memories.get(id);
  } catch {
    return memories.get(id);
  }
}
window.addEventListener(DATASET_EVENT, () => {
  memories.clear();
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(prefix)) sessionStorage.removeItem(key);
  } catch {
    /* Storage may be disabled. */
  }
});

// Presentation choice only: never changes actor.role, roles or workspaceScope.
export function useHomeRole() {
  const store = useDemo();
  const items = computed(() =>
    choices
      .filter(
        (item) =>
          store.hasRole(item.id) ||
          (item.id === 'evaluator' && store.personalTypes.includes('auditor')),
      )
      .map((item) =>
        item.id === 'evaluator' && !store.hasRole('evaluator')
          ? { ...item, label: '평가자 인증 · 기존 요청 진행' }
          : item,
      ),
  );
  const selected = ref<Role>('learner');
  const fallback = () =>
    items.value.find((item) => item.id === store.actor.role)?.id || items.value[0]?.id || 'learner';
  watch(
    () => `${store.actorId}:${store.actor.roles.join(',')}:${store.personalTypes.join(',')}`,
    () => {
      const saved = recalled(store.actorId);
      selected.value = items.value.find((item) => item.id === saved)?.id || fallback();
      if (store.actorId) remember(store.actorId, selected.value);
    },
    { immediate: true },
  );
  function select(value: string) {
    const item = items.value.find((item) => item.id === value);
    if (!item || !store.actorId) return;
    selected.value = item.id;
    remember(store.actorId, item.id);
  }
  return { items, selected, select };
}
