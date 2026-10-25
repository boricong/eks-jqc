<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { type Notification } from '@eks/contracts';
import PageHeading from '../components/PageHeading.vue';
import CollapsibleSection from '../components/CollapsibleSection.vue';
import { useDemo } from '../stores/demo';
import { useNotificationReading } from '../composables/useNotificationReading';
import '../notifications.css';

const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const targetId = computed(() =>
  typeof route.query.notification === 'string' ? route.query.notification : undefined,
);
const {
  unreadOnly,
  unreadCount,
  list,
  expanded,
  errors,
  pending,
  observeBody,
  read,
  context,
  targetMissing,
} = useNotificationReading(targetId);
const navigating = ref<string>();
const navigationError = ref<Record<string, string>>({});
watch(
  () => store.actorId,
  () => {
    navigating.value = undefined;
    navigationError.value = {};
  },
  { flush: 'sync' },
);
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
async function view(notification: Notification) {
  if (navigating.value) return;
  const isCurrent = context();
  navigating.value = notification.id;
  delete navigationError.value[notification.id];
  try {
    if ((await read(notification.id, true)) && isCurrent()) await router.push(notification.href);
  } catch (error) {
    if (isCurrent()) navigationError.value[notification.id] = (error as Error).message;
  } finally {
    if (isCurrent()) navigating.value = undefined;
  }
}
</script>

<template>
  <div class="container page notifications-page">
    <PageHeading>
      <h1>내 알림</h1>
    </PageHeading>
    <p v-if="targetMissing" class="notifications-target-missing" role="status">
      선택한 알림을 찾을 수 없습니다.
    </p>
    <div class="notifications-toolbar">
      <p class="notifications-count" aria-live="polite" aria-atomic="true">
        <span
          >전체 <strong>{{ store.data.notifications.length }}</strong
          >건</span
        >
        <span
          >미읽음 <strong>{{ unreadCount }}</strong
          >건</span
        >
      </p>
      <label class="checkbox-label notifications-filter">
        <input v-model="unreadOnly" type="checkbox" />읽지 않은 알림만
      </label>
    </div>
    <p v-if="unreadOnly" class="notifications-filter-help">
      이 화면에서 확인한 알림은 목록에 유지됩니다.
    </p>
    <div class="notification-list">
      <CollapsibleSection
        v-for="n in list"
        :key="n.id"
        v-model:open="expanded[n.id]"
        :title="n.title"
        class="notification-row"
        :class="{ unread: !n.readAt }"
        :data-notification-id="n.id"
      >
        <template #summary>
          <span class="notification-meta">
            <span class="notification-status" :class="{ 'is-unread': !n.readAt }">
              <span v-if="!n.readAt" class="notification-dot" aria-hidden="true"></span>
              {{ n.readAt ? '읽음' : '읽지 않음' }}
            </span>
            <time :datetime="n.createdAt"
              >{{ dateFormatter.format(new Date(n.createdAt)) }} KST</time
            >
            <span v-if="n.resolvedAt">종료된 안내 · 이력 보존</span>
          </span>
        </template>
        <p
          :ref="(element) => observeBody(n.id, element as Element | null)"
          class="notification-body"
        >
          {{ n.body }}
        </p>
        <div v-if="errors[n.id]" class="notification-error" role="alert">
          <p>읽음 처리에 실패했습니다. {{ errors[n.id] }}</p>
          <button
            type="button"
            class="button secondary"
            :disabled="pending.has(n.id)"
            @click="read(n.id, true)"
          >
            읽음 처리 재시도
          </button>
        </div>
        <p v-if="navigationError[n.id]" class="error-message" role="alert">
          {{ navigationError[n.id] }}
        </p>
        <div class="notification-actions">
          <button type="button" class="button secondary" :disabled="!!navigating" @click="view(n)">
            관련 업무로 이동
          </button>
          <span v-if="pending.has(n.id)" class="notification-progress" role="status"
            >읽음 처리 중…</span
          >
        </div>
      </CollapsibleSection>
    </div>
    <div v-if="!list.length" class="notifications-empty" role="status">
      <h2>
        {{
          store.data.notifications.length
            ? '읽지 않은 알림이 없습니다.'
            : '아직 받은 알림이 없습니다.'
        }}
      </h2>
      <p>
        {{
          store.data.notifications.length
            ? '전체 알림에서 이전 안내를 다시 확인할 수 있습니다.'
            : '새로운 업무 안내가 도착하면 이곳에 표시됩니다.'
        }}
      </p>
    </div>
  </div>
</template>
