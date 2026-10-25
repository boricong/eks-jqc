import { effectScope, reactive, watch } from 'vue';
import { useDemo } from '../stores/demo';
import { DATASET_EVENT } from '../data-generation';
type Pending = { revision: number; itemId: string; checked: boolean };
const states = new Map<string, { busy: boolean; error: string; pending: Pending | null }>();
window.addEventListener(DATASET_EVENT, () => states.clear());
let initialized = false;
export function useChecklistMemory(enrollmentId: string) {
  const store = useDemo();
  if (!initialized) {
    initialized = true;
    effectScope(true).run(() =>
      watch(
        () => store.actorId,
        () => states.clear(),
      ),
    );
  }
  const key = `${store.actorId}:${enrollmentId}`;
  if (!states.has(key)) states.set(key, reactive({ busy: false, error: '', pending: null }));
  return states.get(key)!;
}
