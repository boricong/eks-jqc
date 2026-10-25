<script setup lang="ts">
import { computed, useId } from 'vue';
import { useDemo } from '../stores/demo';
import AppIcon from './AppIcon.vue';

const store = useDemo(),
  id = useId();
const notifications = computed(() =>
  [...store.data.notifications]
    .filter((n) => n.recipientId === store.actorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, 4),
);
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
function receivedAt(value: string) {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
}
</script>

<template>
  <section class="home-card home-recent-notifications" :aria-labelledby="id">
    <div class="section-heading">
      <h2 :id="id">최근 알림</h2>
      <RouterLink to="/notifications" class="text-link"
        >전체 보기<AppIcon name="chevron" :size="16"
      /></RouterLink>
    </div>
    <div class="home-notification-list">
      <RouterLink
        v-for="n in notifications"
        :key="n.id"
        class="home-notification-row"
        :to="{ path: '/notifications', query: { notification: n.id } }"
        :title="n.title"
        :aria-label="`${n.readAt ? '읽음' : '미읽음'} · ${n.title} · 수신 ${receivedAt(n.createdAt)} KST`"
        :data-notification-id="n.id"
      >
        <span class="home-notification-content"
          ><span class="home-notification-title"
            ><span v-if="!n.readAt" class="home-notification-dot" aria-hidden="true"></span
            ><strong>{{ n.title }}</strong></span
          ><time :datetime="n.createdAt">{{ receivedAt(n.createdAt) }}</time></span
        >
        <AppIcon name="chevron" :size="16" />
      </RouterLink>
      <p v-if="!notifications.length" class="muted home-notifications-empty">
        받은 알림이 없습니다.
      </p>
    </div>
  </section>
</template>

<style scoped>
.home-notification-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16px;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  color: var(--ink);
}
.home-notification-row:last-child {
  border-bottom: 0;
}
.home-notification-content {
  min-width: 0;
}
.home-notification-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.home-notification-title strong {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: var(--text-body);
  font-weight: var(--weight-control);
  line-height: 1.5;
}
.home-notification-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
  flex-shrink: 0;
}
.home-notification-content time {
  display: block;
  margin-top: 3px;
  font-size: var(--text-caption);
  color: var(--ink-secondary);
  font-variant-numeric: tabular-nums;
}
.home-notification-row:hover strong {
  color: var(--link-hover);
}
.home-notification-row:focus-visible {
  outline: 2px solid var(--primary-press);
  outline-offset: -2px;
}
.home-notifications-empty {
  font-size: var(--text-caption);
  padding: 8px 0;
}
</style>
