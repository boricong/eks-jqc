import { computed, ref, onBeforeUnmount } from 'vue';
import type { AssessmentAttempt, Draft } from '@eks/contracts';
import { mutate, ApiError } from '../api';

export function useAttemptDraft(actorId: () => string) {
  const attempt = ref<AssessmentAttempt | null>(null),
    draft = ref<Draft>({ answers: {}, verdicts: {} }),
    status = ref<'saved' | 'saving' | 'dirty' | 'error'>('saved'),
    error = ref(''),
    conflict = ref(false);
  const saved = ref('');
  let timer: ReturnType<typeof setTimeout> | undefined,
    inFlight: Promise<void> | null = null;
  let pending: {
    revision: number;
    answers: Draft['answers'];
    verdicts: Draft['verdicts'];
    key: string;
  } | null = null;
  const dirty = computed(() => !!attempt.value && JSON.stringify(draft.value) !== saved.value);
  function load(value: AssessmentAttempt | null) {
    clearTimeout(timer);
    attempt.value = value ? JSON.parse(JSON.stringify(value)) : null;
    draft.value = {
      answers: JSON.parse(JSON.stringify(value?.answers || {})),
      verdicts: JSON.parse(JSON.stringify(value?.verdicts || {})),
    };
    saved.value = JSON.stringify(draft.value);
    pending = null;
    status.value = 'saved';
    error.value = '';
    conflict.value = false;
  }
  async function flush() {
    clearTimeout(timer);
    if (inFlight) {
      await inFlight;
      if (!dirty.value) return;
    }
    if (!attempt.value || (!dirty.value && !pending)) return;
    if (conflict.value) throw new Error(error.value);
    inFlight = (async () => {
      while (attempt.value && (dirty.value || pending)) {
        const request = pending || {
          ...JSON.parse(JSON.stringify(draft.value)),
          revision: attempt.value.revision,
          key: crypto.randomUUID(),
        };
        pending = request;
        status.value = 'saving';
        try {
          const result = await mutate<{ id: string; revision: number }>(
            `/attempts/${attempt.value.id}/draft`,
            { revision: request.revision, answers: request.answers, verdicts: request.verdicts },
            'PUT',
            actorId(),
            request.key,
          );
          attempt.value.revision = result.revision;
          saved.value = JSON.stringify({ answers: request.answers, verdicts: request.verdicts });
          pending = null;
          error.value = '';
          status.value = 'saved';
        } catch (e) {
          error.value = (e as Error).message;
          status.value = 'error';
          if (e instanceof ApiError && e.status === 409) conflict.value = true;
          throw e;
        }
      }
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }
  function changed() {
    if (status.value !== 'error') status.value = 'dirty';
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (status.value !== 'error') void flush().catch(() => {});
    }, 500);
  }
  async function canLeave() {
    try {
      await flush();
      return true;
    } catch {
      return window.confirm('저장하지 못한 입력이 있습니다. 나갈까요?');
    }
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (dirty.value || pending) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  window.addEventListener('beforeunload', beforeUnload);
  onBeforeUnmount(() => {
    clearTimeout(timer);
    window.removeEventListener('beforeunload', beforeUnload);
  });
  return { attempt, draft, status, error, conflict, dirty, load, flush, changed, canLeave };
}
