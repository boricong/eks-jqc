import { confirmAction } from './useConfirmation';
import { computed, onBeforeUnmount, ref, type Ref } from 'vue';
import { ApiError } from '../api';

export function useSavedDraft<T>(
  persist: (value: T, revision: number) => Promise<{ revision: number }>,
) {
  const value = ref(null) as Ref<T | null>,
    revision = ref(0),
    error = ref(''),
    status = ref('저장됨');
  const saved = ref(''),
    conflict = ref(false),
    terminal = ref('');
  const dirty = computed(() => value.value !== null && JSON.stringify(value.value) !== saved.value);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flight: Promise<void> | null = null;
  let pending: { value: T; revision: number; serialized: string } | null = null;
  let generation = 0;
  function clear() {
    generation++;
    clearTimeout(timer);
    value.value = null;
    saved.value = '';
    pending = null;
    conflict.value = false;
    terminal.value = '';
    error.value = '';
    status.value = '저장됨';
  }
  function load(v: T, rev: number) {
    clear();
    value.value = JSON.parse(JSON.stringify(v));
    revision.value = rev;
    saved.value = JSON.stringify(v);
    pending = null;
    conflict.value = false;
    error.value = '';
    status.value = '저장됨';
  }
  async function flush() {
    clearTimeout(timer);
    if (flight) await flight;
    if (terminal.value) throw new ApiError(410, terminal.value, 'PLAN_DELETED');
    if (conflict.value) throw new Error(error.value);
    if (!dirty.value && !pending) return;
    const version = generation;
    flight = (async () => {
      while (version === generation && value.value && (dirty.value || pending)) {
        const payload = pending || {
          value: JSON.parse(JSON.stringify(value.value)) as T,
          revision: revision.value,
          serialized: JSON.stringify(value.value),
        };
        pending = payload;
        status.value = '저장 중';
        try {
          const result = await persist(payload.value, payload.revision);
          if (version !== generation) return;
          revision.value = result.revision;
          saved.value = payload.serialized;
          pending = null;
          error.value = '';
          status.value = '저장됨';
        } catch (err) {
          if (version !== generation) return;
          if (err instanceof ApiError && err.code === 'PLAN_DELETED') {
            stop(err.message);
            throw err;
          }
          error.value = (err as Error).message;
          status.value = '저장 실패';
          if (err instanceof ApiError && err.status === 409) conflict.value = true;
          throw err;
        }
      }
    })();
    try {
      await flight;
    } finally {
      flight = null;
    }
  }
  function changed() {
    if (terminal.value) return;
    status.value = '저장 대기';
    clearTimeout(timer);
    timer = setTimeout(() => void flush().catch(() => {}), 500);
  }
  async function canLeave() {
    if (terminal.value) return true;
    try {
      await flush();
      return true;
    } catch {
      const discard = await confirmAction(
        '저장하지 못한 입력이 있습니다. 변경 내용을 버리고 나갈까요?',
        '변경 버리고 이동',
      );
      if (discard) clear();
      return discard;
    }
  }
  function stop(message: string) {
    clear();
    terminal.value = message;
    status.value = '삭제된 계획';
  }
  function beforeUnload(e: BeforeUnloadEvent) {
    if (dirty.value || pending) {
      e.preventDefault();
      e.returnValue = '';
    }
  }
  window.addEventListener('beforeunload', beforeUnload);
  onBeforeUnmount(() => {
    clear();
    window.removeEventListener('beforeunload', beforeUnload);
  });
  return {
    value,
    revision,
    error,
    status,
    dirty,
    conflict,
    terminal,
    load,
    clear,
    stop,
    flush,
    changed,
    canLeave,
  };
}
