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
  <section v-for="g in groups" :key="g.scope" class="home-card notice-card" :aria-label="g.title">
    <div class="section-heading">
      <h2>{{ g.title }}</h2>
      <button v-if="g.notices.length" class="button ghost small" @click="list = g.scope">
        전체 보기
      </button>
    </div>
    <p class="muted notice-audience">{{ g.target }}</p>
    <button v-for="n in g.notices.slice(0, 3)" :key="n.id" class="notice-row" @click="selected = n">
      <span
        >{{ n.title }}<time>{{ n.date.replaceAll('-', '.') }}</time></span
      ><AppIcon name="chevron" :size="16" />
    </button>
    <p v-if="!g.notices.length" class="empty-state">
      게시된 {{ g.scope === 'system' ? '시스템' : '팀' }} 공지가 없습니다.
    </p>
  </section>
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
