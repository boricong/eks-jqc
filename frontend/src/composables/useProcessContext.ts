import { randomUUID } from '../uuid';
import { shallowRef, watchEffect, onBeforeUnmount } from 'vue';
export const processContext = shallowRef({ owner: '', state: '' });
export function useProcessContext(read: () => string) {
  const owner = randomUUID();
  watchEffect(() => {
    processContext.value = { owner, state: read() };
  });
  onBeforeUnmount(() => {
    if (processContext.value.owner === owner) processContext.value = { owner: '', state: '' };
  });
}
