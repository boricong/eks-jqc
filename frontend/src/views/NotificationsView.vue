<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { type Notification } from '@eks/contracts';
import { useDemo } from '../stores/demo';
const store = useDemo(),
  router = useRouter(),
  unreadOnly = ref(false),
  error = ref(''),
  busy = ref(false);
const list = computed(() =>
  [...store.data.notifications]
    .filter((n) => !unreadOnly.value || !n.readAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);
async function view(n: Notification) {
  busy.value = true;
  error.value = '';
  try {
    if (!n.readAt) await store.command(`/notifications/${n.id}/read`);
    await router.push(n.href);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="container page">
    <div class="page-heading">
      <h1>내 알림</h1>
      <span class="muted">읽음 처리와 업무 완료는 별도로 관리됩니다.</span>
    </div>
    <label class="checkbox-label"
      ><input v-model="unreadOnly" type="checkbox" />읽지 않은 알림만</label
    >
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <div class="notification-list">
      <article
        v-for="n in list"
        :key="n.id"
        class="panel notification-row"
        :class="{ unread: !n.readAt && !n.resolvedAt }"
      >
        <div>
          <h2>{{ n.title }}</h2>
          <p>{{ n.body }}</p>
          <small class="muted"
            >{{ new Date(n.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) }} ·
            {{ n.readAt ? '읽음' : '읽지 않음'
            }}{{ n.resolvedAt ? ' · 종료된 안내 · 이력 보존' : '' }}</small
          >
        </div>
        <button class="button secondary" :disabled="busy" @click="view(n)">내용 확인</button>
      </article>
    </div>
    <p v-if="!list.length" class="panel empty-state">표시할 알림이 없습니다.</p>
  </div>
</template>
