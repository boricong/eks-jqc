import { effectScope, reactive, watch } from 'vue';
import { useDemo } from '../stores/demo';
interface ReadingState {
  contentTab: 'scope' | 'materials';
  selected: string;
  scroll: Record<string, number>;
  goalExpanded: boolean;
  scopeExpanded: boolean;
}
const reading = new Map<string, ReadingState>();
const attempts = new Map<string, { question: string }>();
let owner = '';
let observing = false;
// UI memory only: never becomes learning evidence or a persisted answer.
export function useLearnerMemory() {
  const store = useDemo();
  // Keep the account boundary active even while the learner is on another screen.
  if (!observing)
    effectScope(true).run(() => {
      observing = true;
      watch(
        () => store.actorId,
        (actor) => {
          if (actor !== owner) {
            owner = actor;
            reading.clear();
            attempts.clear();
          }
        },
        { immediate: true, flush: 'sync' },
      );
    });
  return {
    reading(key: string) {
      if (!reading.has(key))
        reading.set(
          key,
          reactive({
            contentTab: 'scope',
            selected: '',
            scroll: {},
            goalExpanded: false,
            scopeExpanded: false,
          }),
        );
      return reading.get(key)!;
    },
    attempt(id: string) {
      if (!attempts.has(id)) attempts.set(id, { question: '' });
      return attempts.get(id)!;
    },
  };
}
