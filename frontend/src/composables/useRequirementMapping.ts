import { computed, ref, watch, onBeforeUnmount } from 'vue';
import {
  resolveRequirementRules,
  type RequirementRule,
  type OrganizationRequirementsView,
  type RequirementsPreview,
} from '@eks/contracts';
import { api, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import { DATASET_EVENT } from '../data-generation';

export function useRequirementMapping() {
  const store = useDemo();
  const data = ref<OrganizationRequirementsView>(),
    draft = ref<Record<string, string[]>>({});
  type Exclusion = { entityId: string; reason: string };
  type Rule = { mode: 'inherit' | 'direct' | 'exclude'; reason: string };
  const exclusions = ref<Record<string, Exclusion[]>>({}),
    removalReasons = ref<Record<string, Record<string, string>>>({});
  const mergeConflicts = ref<
    { organizationId: string; entityId: string; mine: Rule; latest: Rule; removalReason: string }[]
  >([]);
  const busy = ref(false),
    error = ref(''),
    conflict = ref(false),
    revoked = ref(false);
  const preview = ref<RequirementsPreview>(),
    rebased = ref(false);
  type Input = Pick<
    RequirementsPreview,
    'contractVersion' | 'stateRevision' | 'organizationRevision' | 'changes'
  >;
  const pending = ref<Input>();
  let confirmed = false,
    sequence = 0;
  const endpoint = () => store.managementPath('/organization-qualification-requirements');
  const equal = (a: readonly string[], b: readonly string[]) =>
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const exclusionEqual = (a: Exclusion[], b: Exclusion[]) =>
    JSON.stringify([...a].map((e) => [e.entityId, e.reason]).sort()) ===
    JSON.stringify([...b].map((e) => [e.entityId, e.reason]).sort());
  const changes = computed(
    () =>
      data.value?.entries
        .filter(
          (e) =>
            !equal(draft.value[e.id] || [], e.directEntityIds) ||
            !exclusionEqual(exclusions.value[e.id] || [], e.exclusions),
        )
        .map((e) => ({
          organizationId: e.id,
          entityIds: [...(draft.value[e.id] || [])],
          exclusions: (exclusions.value[e.id] || []).map((v) => ({ ...v })),
          removalReasons: e.exclusions
            .filter((old) => !exclusions.value[e.id]?.some((x) => x.entityId === old.entityId))
            .map((old) => ({
              entityId: old.entityId,
              reason: removalReasons.value[e.id]?.[old.entityId] || '',
            })),
        })) || [],
  );
  const dirty = computed(() => !!changes.value.length || !!mergeConflicts.value.length);
  const locked = computed(
    () => busy.value || !!pending.value || revoked.value || !!mergeConflicts.value.length,
  );
  const entries = computed(() => data.value?.entries || []);
  const rules = computed(
    () =>
      new Map<string, Pick<RequirementRule, 'entityIds' | 'exclusions'>>([
        ...(data.value?.ancestorRules || []).map((r) => [r.organization.id, r] as const),
        ...entries.value.map(
          (e) =>
            [
              e.id,
              {
                entityIds: draft.value[e.id] || [],
                exclusions: (exclusions.value[e.id] || []).map((x) => ({
                  ...x,
                  updatedBy: store.actorId,
                  updatedAt: '',
                })),
              },
            ] as const,
        ),
      ]),
  );
  const resolved = computed(
    () => new Map(entries.value.map((e) => [e.id, resolveRequirementRules(e.path, rules.value)])),
  );
  const effective = computed(() => new Map([...resolved.value].map(([id, r]) => [id, r.sources])));
  const excluded = computed(() => new Map([...resolved.value].map(([id, r]) => [id, r.excluded])));
  const canExclude = (orgId: string, id: string) => {
    const e = entries.value.find((e) => e.id === orgId);
    return (
      !!e?.editable &&
      e.effectiveActive &&
      !!e.parentId &&
      resolveRequirementRules(e.path.slice(0, -1), rules.value).sources.has(id)
    );
  };
  const changedOrganizations = computed(
    () =>
      new Set(
        entries.value
          .filter((e) => {
            const before = new Map(
                e.effective.map((r) => [r.entityId, r.sourceOrganizations.map((o) => o.id)]),
              ),
              after = effective.value.get(e.id)!;
            return (
              changes.value.some((c) => c.organizationId === e.id) ||
              before.size !== after.size ||
              [...after].some(
                ([id, src]) =>
                  !equal(
                    before.get(id) || [],
                    src.map((o) => o.id),
                  ),
              ) ||
              JSON.stringify(e.excluded) !==
                JSON.stringify([...(excluded.value.get(e.id)?.values() || [])])
            );
          })
          .map((e) => e.id),
      ),
  );
  const ruleOf = (ids: string[], ex: Exclusion[], id: string): Rule => ({
    mode: ids.includes(id) ? 'direct' : ex.some((e) => e.entityId === id) ? 'exclude' : 'inherit',
    reason: ex.find((e) => e.entityId === id)?.reason || '',
  });
  function assignRule(org: string, id: string, r: Rule, removalReason = '') {
    draft.value[org] = (draft.value[org] || []).filter((x) => x !== id);
    exclusions.value[org] = (exclusions.value[org] || []).filter((x) => x.entityId !== id);
    if (r.mode === 'direct') draft.value[org]!.push(id);
    if (r.mode === 'exclude') exclusions.value[org]!.push({ entityId: id, reason: r.reason });
    (removalReasons.value[org] ||= {})[id] = removalReason || removalReasons.value[org]?.[id] || '';
  }
  function resolveConflict(index: number, useMine: boolean, reason = '') {
    const c = mergeConflicts.value[index];
    if (!c) return;
    if (
      useMine &&
      c.latest.mode === 'exclude' &&
      c.mine.mode !== 'exclude' &&
      !reason.trim() &&
      !c.removalReason
    )
      return;
    if (useMine) assignRule(c.organizationId, c.entityId, c.mine, reason.trim() || c.removalReason);
    mergeConflicts.value.splice(index, 1);
  }
  const payload = (): Input => ({
    contractVersion: 2,
    stateRevision: data.value!.stateRevision,
    organizationRevision: data.value!.organizationRevision,
    changes: changes.value,
  });
  function reset() {
    sequence++;
    data.value = undefined;
    draft.value = {};
    exclusions.value = {};
    removalReasons.value = {};
    mergeConflicts.value = [];
    preview.value = undefined;
    pending.value = undefined;
    confirmed = false;
    error.value = '';
    busy.value = false;
    conflict.value = false;
    revoked.value = false;
    rebased.value = false;
  }
  async function load(rebase = false) {
    if (!store.managementReady) return;
    const seq = ++sequence;
    const edits = rebase
      ? changes.value.flatMap((c) => {
          const old = data.value!.entries.find((e) => e.id === c.organizationId)!;
          return [
            ...new Set([
              ...old.directEntityIds,
              ...old.exclusions.map((e) => e.entityId),
              ...c.entityIds,
              ...c.exclusions.map((e) => e.entityId),
            ]),
          ].flatMap((id) => {
            const before = ruleOf(old.directEntityIds, old.exclusions, id),
              mine = ruleOf(c.entityIds, c.exclusions, id);
            return JSON.stringify(before) === JSON.stringify(mine)
              ? []
              : [
                  {
                    organizationId: c.organizationId,
                    entityId: id,
                    before,
                    mine,
                    removalReason: c.removalReasons.find((r) => r.entityId === id)?.reason || '',
                  },
                ];
          });
        })
      : [];
    busy.value = true;
    error.value = '';
    try {
      const next = await api<OrganizationRequirementsView>(endpoint());
      if (seq !== sequence) return;
      if (edits.some((c) => !next.entries.some((e) => e.id === c.organizationId && e.editable)))
        throw new Error(
          '편집한 조직의 권한 또는 구조가 변경되었습니다. 변경을 취소하고 다시 불러와 주세요.',
        );
      data.value = next;
      draft.value = Object.fromEntries(next.entries.map((e) => [e.id, [...e.directEntityIds]]));
      exclusions.value = Object.fromEntries(
        next.entries.map((e) => [
          e.id,
          e.exclusions.map((x) => ({ entityId: x.entityId, reason: x.reason })),
        ]),
      );
      removalReasons.value = {};
      mergeConflicts.value = [];
      for (const edit of edits) {
        const entry = next.entries.find((e) => e.id === edit.organizationId)!;
        const latest = ruleOf(entry.directEntityIds, entry.exclusions, edit.entityId);
        if (
          JSON.stringify(latest) !== JSON.stringify(edit.before) &&
          JSON.stringify(latest) !== JSON.stringify(edit.mine)
        )
          mergeConflicts.value.push({ ...edit, latest });
        else assignRule(edit.organizationId, edit.entityId, edit.mine, edit.removalReason);
      }
      preview.value = undefined;
      pending.value = undefined;
      confirmed = false;
      conflict.value = false;
      revoked.value = false;
      rebased.value = rebase;
    } catch (e) {
      if (seq === sequence) fail(e);
    } finally {
      if (seq === sequence) busy.value = false;
    }
  }
  function fail(e: unknown) {
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 409) conflict.value = true;
    if (e instanceof ApiError && e.status === 403) revoked.value = true;
  }
  function setRule(orgId: string, id: string, mode: Rule['mode'], reason = '') {
    if (locked.value || !entries.value.find((e) => e.id === orgId)?.editable) return;
    if (
      (mode === 'exclude' || exclusions.value[orgId]?.some((e) => e.entityId === id)) &&
      !reason.trim()
    )
      return;
    if (
      mode === 'exclude' &&
      !exclusions.value[orgId]?.some((e) => e.entityId === id) &&
      !canExclude(orgId, id)
    )
      return;
    assignRule(orgId, id, { mode, reason: mode === 'exclude' ? reason.trim() : '' }, reason.trim());
    preview.value = undefined;
  }
  function toggle(orgId: string, id: string, on: boolean) {
    setRule(orgId, id, on ? 'direct' : 'inherit');
  }
  function discard() {
    if (locked.value) return;
    draft.value = Object.fromEntries(entries.value.map((e) => [e.id, [...e.directEntityIds]]));
    exclusions.value = Object.fromEntries(
      entries.value.map((e) => [
        e.id,
        e.exclusions.map((x) => ({ entityId: x.entityId, reason: x.reason })),
      ]),
    );
    removalReasons.value = {};
    mergeConflicts.value = [];
    preview.value = undefined;
    rebased.value = false;
    if (conflict.value) void load();
    else error.value = '';
  }
  async function inspect() {
    if (locked.value || conflict.value || !dirty.value) return;
    const seq = sequence;
    busy.value = true;
    error.value = '';
    try {
      const result = await api<RequirementsPreview>(
        store.managementPath('/organization-qualification-requirements/preview'),
        { method: 'POST', body: JSON.stringify(payload()) },
      );
      if (seq === sequence) preview.value = result;
    } catch (e) {
      if (seq === sequence) fail(e);
    } finally {
      if (seq === sequence) busy.value = false;
    }
  }
  async function save() {
    if (busy.value || revoked.value || (!preview.value && !pending.value)) return;
    const seq = sequence;
    pending.value ||= payload();
    busy.value = true;
    error.value = '';
    try {
      if (!confirmed) {
        await store.command(endpoint(), pending.value, 'PUT');
        if (seq !== sequence) return;
        confirmed = true;
      }
      // A failed post-save read retries only the same receipt or the read, never a fresh edit.
      await load();
      if (!pending.value && data.value) store.notify('조직 필요자격을 저장했습니다.');
    } catch (e) {
      if (seq !== sequence) return;
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        pending.value = undefined;
        preview.value = undefined;
      }
      fail(e);
    } finally {
      if (seq === sequence) busy.value = false;
    }
  }
  watch(
    () =>
      `${store.actorId}:${store.managementLv1}:${store.actor.organizationId}:${store.actor.roles.join(',')}:${store.managementReady}`,
    () => {
      reset();
      void load();
    },
    { immediate: true },
  );
  window.addEventListener(DATASET_EVENT, reset);
  onBeforeUnmount(() => {
    reset();
    window.removeEventListener(DATASET_EVENT, reset);
  });
  return {
    data,
    exclusions,
    excluded,
    canExclude,
    setRule,
    mergeConflicts,
    resolveConflict,
    draft,
    entries,
    effective,
    changedOrganizations,
    changes,
    dirty,
    busy,
    locked,
    error,
    conflict,
    revoked,
    preview,
    pending,
    rebased,
    load,
    toggle,
    discard,
    review: inspect,
    save,
  };
}
