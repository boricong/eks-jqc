import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useDemo } from '../stores/demo';

type ReadRequest = {
  id: string;
  generation: number;
  actorId: string;
  explicit: boolean;
  promise: Promise<boolean>;
  resolve: (success: boolean) => void;
};

// A route can remount while its previous POST is still in flight. Share that
// operation across view instances, without retaining their presentation state.
const inFlight = new WeakMap<
  ReturnType<typeof useDemo>,
  {
    id: string;
    actorId: string;
    promise: Promise<unknown>;
  }
>();

/** View-scoped expansion, filter membership and serialized, retry-safe read requests. */
export function useNotificationReading() {
  const store = useDemo();
  const unreadOnly = ref(false);
  const expanded = ref<Record<string, boolean>>({});
  const errors = ref<Record<string, string>>({});
  const pending = ref(new Set<string>());
  const admitted = new Set<string>();
  const bodies = new Map<string, Element>();
  const requests = new Map<string, ReadRequest>();
  const queue: ReadRequest[] = [];
  let observer: IntersectionObserver | undefined;
  let generation = 0;
  let active = true;
  let draining = false;

  const unreadCount = computed(() => store.data.notifications.filter((n) => !n.readAt).length);
  const list = computed(() =>
    [...store.data.notifications]
      .filter((n) => !unreadOnly.value || !n.readAt || admitted.has(n.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );

  function current(request: ReadRequest) {
    return active && request.generation === generation && request.actorId === store.actorId;
  }

  function visible(id: string) {
    const element = bodies.get(id);
    if (
      !active ||
      document.visibilityState !== 'visible' ||
      !expanded.value[id] ||
      !element?.isConnected
    )
      return false;
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < document.documentElement.clientHeight &&
      rect.left < document.documentElement.clientWidth
    );
  }

  async function performRead(request: ReadRequest) {
    while (inFlight.has(store)) {
      const previous = inFlight.get(store)!;
      if (previous.id === request.id && previous.actorId === request.actorId) {
        await previous.promise;
        return true;
      }
      // A different mounted view may still be finishing its request.
      await previous.promise.catch(() => {});
    }
    if (!current(request) || (!request.explicit && !visible(request.id))) return false;
    const operation = {
      id: request.id,
      actorId: request.actorId,
      promise: store.command(`/notifications/${encodeURIComponent(request.id)}/read`),
    };
    inFlight.set(store, operation);
    try {
      await operation.promise;
      return true;
    } finally {
      if (inFlight.get(store) === operation) inFlight.delete(store);
    }
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) {
        const request = queue.shift()!;
        let success = false;
        try {
          if (!current(request) || (!request.explicit && !visible(request.id))) continue;
          const notification = store.data.notifications.find((n) => n.id === request.id);
          if (!notification) continue;
          if (!notification.readAt || errors.value[request.id]) {
            // command retains the idempotency key/confirmed result when either POST or refresh fails.
            if (!(await performRead(request))) continue;
            if (!current(request)) continue;
            if (!store.data.notifications.find((n) => n.id === request.id)?.readAt)
              throw new Error('최신 읽음 상태를 확인하지 못했습니다. 다시 시도해 주세요.');
          }
          if (current(request)) {
            delete errors.value[request.id];
            success = true;
          }
        } catch (error) {
          if (current(request)) errors.value[request.id] = (error as Error).message;
        } finally {
          if (requests.get(request.id) === request) {
            requests.delete(request.id);
            pending.value.delete(request.id);
          }
          request.resolve(success);
        }
      }
    } finally {
      draining = false;
    }
  }

  function read(id: string, explicit = false): Promise<boolean> {
    if (!active) return Promise.resolve(false);
    const existing = requests.get(id);
    if (existing) {
      existing.explicit ||= explicit;
      return existing.promise;
    }
    const notification = store.data.notifications.find((n) => n.id === id);
    if (!notification) return Promise.resolve(false);
    if (notification.readAt && !errors.value[id]) return Promise.resolve(true);
    if (!explicit && (errors.value[id] || !visible(id))) return Promise.resolve(false);
    let resolve!: ReadRequest['resolve'];
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    const request = { id, generation, actorId: store.actorId, explicit, promise, resolve };
    requests.set(id, request);
    pending.value.add(id);
    queue.push(request);
    void drain();
    return promise;
  }

  function scanVisible() {
    for (const id of bodies.keys()) if (visible(id)) void read(id);
  }

  function observeBody(id: string, element: Element | null) {
    const previous = bodies.get(id);
    if (previous === element) return;
    if (previous) observer?.unobserve(previous);
    if (element) {
      bodies.set(id, element);
      observer?.observe(element);
    } else bodies.delete(id);
  }

  function initializePresentation() {
    admitted.clear();
    expanded.value = {};
    for (const n of store.data.notifications) {
      expanded.value[n.id] = !n.readAt;
      if (!n.readAt) admitted.add(n.id);
    }
  }

  function cancelRequests() {
    generation++;
    for (const request of requests.values()) request.resolve(false);
    requests.clear();
    queue.length = 0;
    pending.value.clear();
  }

  watch(
    () => store.actorId,
    () => {
      cancelRequests();
      observer?.disconnect();
      errors.value = {};
      unreadOnly.value = false;
      initializePresentation();
      void nextTick(() => {
        if (!active) return;
        for (const element of bodies.values()) observer?.observe(element);
        scanVisible();
      });
    },
    { flush: 'sync' },
  );

  watch(
    () => store.data.notifications,
    (notifications) => {
      const ids = new Set(notifications.map((n) => n.id));
      for (const id of Object.keys(expanded.value)) {
        if (!ids.has(id)) {
          delete expanded.value[id];
          delete errors.value[id];
          admitted.delete(id);
        }
      }
      for (const n of notifications) {
        if (!(n.id in expanded.value)) expanded.value[n.id] = !n.readAt;
        if (!n.readAt) admitted.add(n.id);
      }
    },
    { immediate: true, flush: 'sync' },
  );

  watch(unreadOnly, initializePresentation, { flush: 'sync' });
  watch(
    expanded,
    () => {
      void nextTick(scanVisible);
    },
    { deep: true, flush: 'post' },
  );

  onMounted(() => {
    observer = new IntersectionObserver(scanVisible, { threshold: 0 });
    for (const element of bodies.values()) observer.observe(element);
    document.addEventListener('visibilitychange', scanVisible);
  });
  onBeforeUnmount(() => {
    active = false;
    cancelRequests();
    observer?.disconnect();
    bodies.clear();
    document.removeEventListener('visibilitychange', scanVisible);
  });

  // Callers capture this before awaiting to prevent late navigation after leaving/changing account.
  function context() {
    const token = generation,
      actorId = store.actorId;
    return () => active && token === generation && actorId === store.actorId;
  }

  return { unreadOnly, unreadCount, list, expanded, errors, pending, observeBody, read, context };
}
