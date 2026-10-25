<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDemo } from '../stores/demo';
import type { Notice } from '@eks/contracts';
import AppDialog from './AppDialog.vue';
import AppIcon from './AppIcon.vue';
const store = useDemo(),
  selected = ref<Notice>(),
  list = ref<'system' | 'team'>();
const groups = computed(() =>
  [
    { scope: 'system' as const, title: '시스템 공지', target: '전 조직 공통' },
    {
      scope: 'team' as const,
      title: '내 팀 공지',
      target: store.actor.organizationPath[0]?.name || '소속 팀',
    },
  ].map((g) => ({ ...g, notices: store.notices.filter((n) => n.scope === g.scope) })),
);
const current = computed(() => groups.value.find((g) => g.scope === list.value));
watch(
  () => store.actorId,
  () => {
    selected.value = undefined;
    list.value = undefined;
  },
);
</script>
<template>
  <div class="home-notices-grid" role="region" aria-label="홈 공지">
    <section v-for="g in groups" :key="g.scope" class="home-card notice-card" :aria-label="g.title">
      <div class="section-heading">
        <h2>{{ g.title }}</h2>
        <button v-if="g.notices.length" class="button ghost small" @click="list = g.scope">
          전체 보기
        </button>
      </div>
      <button
        v-for="n in g.notices.slice(0, 3)"
        :key="n.id"
        class="notice-row"
        :title="n.title"
        :aria-label="`${n.title} · 게시일 ${n.date.replaceAll('-', '.')}`"
        @click="selected = n"
      >
        <span class="home-notice-title">{{ n.title }}</span
        ><time :datetime="n.date">{{ n.date.replaceAll('-', '.') }}</time
        ><AppIcon name="chevron" :size="16" />
      </button>
      <p v-if="!g.notices.length" class="empty-state">
        게시된 {{ g.scope === 'system' ? '시스템' : '팀' }} 공지가 없습니다.
      </p>
    </section>
  </div>
  <AppDialog
    :open="!!list"
    :title="current?.title || '공지 전체 보기'"
    @update:open="list = undefined"
    ><p class="muted">{{ current?.target }}</p>
    <button
      v-for="n in current?.notices"
      :key="n.id"
      class="notice-row"
      @click="
        selected = n;
        list = undefined;
      "
    >
      <span
        >{{ n.title }}<time>{{ n.date }}</time></span
      ><AppIcon name="chevron" :size="16" /></button
  ></AppDialog>
  <AppDialog
    :open="!!selected"
    :title="selected?.title || '공지'"
    @update:open="selected = undefined"
    ><p class="muted">
      {{
        selected?.scope === 'system'
          ? '시스템 공지 · 전 조직 공통'
          : '팀 공지 · ' + store.actor.organizationPath[0]?.name
      }}
    </p>
    <time class="muted">{{ selected?.date }}</time>
    <p class="notice-body prose-text">{{ selected?.body }}</p></AppDialog
  >
</template>

<style scoped>
.home-notices-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  border-top: 1px solid var(--line);
  margin-top: 32px;
  padding-top: 24px;
}
.home-notices-grid > section {
  min-width: 0;
}
.home-notices-grid .empty-state {
  display: block;
  min-height: 0;
  padding: 12px 0;
  font-size: var(--text-caption);
}
.home-notices-grid .section-heading {
  min-height: 44px;
  margin-bottom: 8px;
}
.home-notices-grid .section-heading .button {
  min-height: 44px;
}
.home-notices-grid .notice-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 86px 16px;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 10px 0;
}
.home-notice-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: var(--text-body);
  font-weight: var(--weight-control);
}
.home-notices-grid time {
  margin: 0;
  text-align: right;
  font-size: var(--text-caption);
}
.home-notices-grid button:focus-visible {
  outline-color: var(--primary-press);
  outline-offset: -2px;
}
@media (max-width: 768px) {
  .home-notices-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 480px) {
  .home-notices-grid .notice-row {
    grid-template-columns: minmax(0, 1fr) 16px;
    grid-template-areas: 'title arrow' 'date arrow';
    gap: 4px 12px;
  }
  .home-notice-title {
    grid-area: title;
  }
  .home-notices-grid time {
    grid-area: date;
    text-align: left;
  }
  .home-notices-grid .notice-row > svg {
    grid-area: arrow;
  }
}
</style>
