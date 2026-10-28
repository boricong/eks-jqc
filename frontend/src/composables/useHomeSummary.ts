import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { DashboardResponse, Role } from '@eks/contracts';
import { api } from '../api';
import { useDemo } from '../stores/demo';

export function useHomeSummary(role: Ref<Role>) {
  const store = useDemo();
  const data = ref<DashboardResponse | null>(null);
  const loading = ref(false),
    error = ref('');
  const managed = computed(() => ['admin', 'organization_admin'].includes(role.value));
  const scope = computed(() => ({
    lv1OrganizationId: store.actor.lv1OrganizationId,
    organizationId:
      role.value === 'organization_admin'
        ? store.actor.organizationId
        : store.actor.lv1OrganizationId,
    includeDescendants: 'true',
  }));
  let sequence = 0;
  let controller: AbortController | undefined;
  async function load() {
    const version = ++sequence;
    controller?.abort();
    data.value = null;
    error.value = '';
    loading.value = false;
    if (!managed.value || !store.actorId || !store.hasRole(role.value)) return;
    controller = new AbortController();
    loading.value = true;
    try {
      const query = new URLSearchParams({ ...scope.value, view: 'summary' });
      const result = await api<DashboardResponse>(`/dashboard?${query}`, {
        signal: controller.signal,
      });
      if (version === sequence) data.value = result;
    } catch (e) {
      if (version === sequence)
        error.value =
          e instanceof Error ? e.message : '현황을 불러오지 못했습니다. 다시 시도해 주세요.';
    } finally {
      if (version === sequence) loading.value = false;
    }
  }
  watch(
    [
      role,
      () => store.data,
      () => `${store.actorId}:${store.actor.roles.join(',')}:${store.actor.organizationId}`,
    ],
    () => void load(),
    { immediate: true },
  );
  onBeforeUnmount(() => {
    sequence++;
    controller?.abort();
  });
  function link(path: string, extra: Record<string, string> = {}) {
    return { path, query: { ...scope.value, ...extra } };
  }
  return { data, loading, error, load, link, managed };
}
