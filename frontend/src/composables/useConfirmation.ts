import { nextTick, readonly, shallowRef } from 'vue';

type Confirmation = { message: string; action: string; title: string };
const pending = shallowRef<Confirmation | null>(null);
let resolvePending: ((accepted: boolean) => void) | undefined;
let settling = false;

export const confirmation = readonly(pending);

/** One explicit decision at a time. A repeated request never accepts another action. */
export function confirmAction(message: string, action = '변경 버리고 이동', title = '변경 확인') {
  if (resolvePending) return Promise.resolve(false);
  pending.value = { message, action, title };
  return new Promise<boolean>((resolve) => {
    resolvePending = resolve;
  });
}

export async function settleConfirmation(accepted: boolean) {
  const resolve = resolvePending;
  if (!resolve || settling) return;
  settling = true;
  pending.value = null;
  // Close the modal and restore focus before a route guard continues navigation.
  await nextTick();
  await nextTick();
  resolvePending = undefined;
  settling = false;
  resolve(accepted);
}
