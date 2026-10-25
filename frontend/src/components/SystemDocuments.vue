<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { SystemDocumentDetail, SystemDocumentSummary } from '@eks/contracts';
import { api, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import { documentAnchor, renderDocument } from '../document-markdown';
import AppIcon from './AppIcon.vue';
import '../documents.css';

const route = useRoute(),
  router = useRouter(),
  store = useDemo();
const id = computed(() => String(route.params.id || ''));
const items = ref<SystemDocumentSummary[]>([]),
  document = ref<SystemDocumentDetail>();
const query = ref(String(route.query.q || '')),
  loading = ref(false),
  error = ref('');
const body = ref<HTMLElement>(),
  contentsOpen = ref(false);
const rendered = computed(() =>
  document.value ? renderDocument(document.value, items.value) : { html: '', headings: [] },
);
const listed = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  return items.value.filter((item) =>
    `${item.title} ${item.description}`.toLocaleLowerCase().includes(needle),
  );
});
const contextQuery = computed(() => (query.value ? { q: query.value } : {}));
let sequence = 0,
  controller: AbortController | undefined;
function jumpTo(hash: string, update = false) {
  const target = window.document.getElementById(documentAnchor(hash));
  if (!target || !body.value?.contains(target)) return;
  if (update)
    history.replaceState(history.state, '', `${location.pathname}${location.search}#${target.id}`);
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start' });
}
async function load() {
  const seq = ++sequence;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  items.value = [];
  document.value = undefined;
  contentsOpen.value = false;
  error.value = '';
  loading.value = true;
  if (!store.hasRole('system_operator')) {
    loading.value = false;
    return;
  }
  try {
    const result = await api<{ items: SystemDocumentSummary[] }>('/system/documents', { signal });
    if (seq !== sequence) return;
    items.value = result.items;
    if (id.value) {
      const result = await api<SystemDocumentDetail>(
        `/system/documents/${encodeURIComponent(id.value)}`,
        { signal },
      );
      if (seq !== sequence) return;
      document.value = result;
      window.document.title = `${result.title} · EKS 직무자격인증`;
    }
  } catch (e) {
    if (seq !== sequence || signal.aborted) return;
    error.value = (e as Error).message;
    if (e instanceof ApiError && [401, 403].includes(e.status)) {
      items.value = [];
      await router.replace('/');
    }
  } finally {
    if (seq === sequence) {
      loading.value = false;
      await nextTick();
      requestAnimationFrame(() => {
        if (seq === sequence && location.hash) jumpTo(location.hash);
      });
    }
  }
}
function follow(event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const anchor = (event.target as Element).closest<HTMLAnchorElement>('a');
  const href = anchor?.getAttribute('href');
  if (href?.startsWith('#')) {
    event.preventDefault();
    jumpTo(href, true);
  } else if (href?.startsWith('/system/documents/')) {
    event.preventDefault();
    void router.push(href);
  }
}
watch([id, () => store.actorId, () => store.hasRole('system_operator')], () => void load(), {
  immediate: true,
  flush: 'sync',
});
watch(
  () => route.query.q,
  (value) => {
    if (typeof value === 'string') query.value = value;
  },
);
watch(
  () => route.hash,
  async (hash) => {
    await nextTick();
    if (!loading.value && hash) jumpTo(hash);
  },
);
onBeforeUnmount(() => {
  sequence++;
  controller?.abort();
});
</script>

<template>
  <section class="system-documents" :aria-busy="loading">
    <RouterLink
      v-if="id"
      :to="{ path: '/system/documents', query: contextQuery }"
      class="document-back"
    >
      <AppIcon name="back" :size="16" />
      <span>문서 목록</span>
    </RouterLink>
    <header class="document-heading">
      <h1>{{ document?.title || (id ? '문서 읽기' : '문서 조회') }}</h1>
      <p v-if="document" class="document-meta">
        갱신일
        <time :datetime="document.updatedOn">{{ document.updatedOn.replaceAll('-', '.') }}</time>
      </p>
    </header>
    <p v-if="loading" class="document-message" role="status">문서를 불러오는 중입니다.</p>
    <div v-else-if="error" class="document-message document-error" role="alert">
      <p>{{ error }}</p>
      <button class="button secondary" @click="load">다시 불러오기</button>
    </div>
    <template v-else-if="!id">
      <div class="document-toolbar">
        <p class="document-meta">
          전체 {{ items.length }}개<span v-if="query.trim()">
            · 검색 결과 {{ listed.length }}개</span
          >
        </p>
        <label class="document-search"
          ><span>문서 검색</span><input v-model="query" type="search" placeholder="제목·설명 검색"
        /></label>
      </div>
      <div class="document-list">
        <RouterLink
          v-for="item in listed"
          :key="item.id"
          :to="{ path: `/system/documents/${item.id}`, query: contextQuery }"
          class="document-row"
        >
          <span class="document-row-copy"
            ><strong>{{ item.title }}</strong
            ><span>{{ item.description }}</span></span
          >
          <time :datetime="item.updatedOn">{{ item.updatedOn.replaceAll('-', '.') }}</time
          ><AppIcon name="chevron" :size="18" />
        </RouterLink>
        <p v-if="!listed.length" class="document-message">
          {{ items.length ? '검색 결과가 없습니다.' : '등록된 문서가 없습니다.' }}
        </p>
      </div>
    </template>
    <template v-else-if="document">
      <nav v-if="rendered.headings.length" class="document-contents" aria-label="문서 목차">
        <button
          class="document-contents-toggle"
          :aria-expanded="contentsOpen"
          aria-controls="document-contents-list"
          @click="contentsOpen = !contentsOpen"
        >
          <span
            >목차 <small>{{ rendered.headings.length }}개 항목</small></span
          >
          <span
            >{{ contentsOpen ? '접기' : '펼쳐 보기'
            }}<AppIcon name="down" :size="16" :class="{ 'is-open': contentsOpen }"
          /></span>
        </button>
        <ol v-if="contentsOpen" id="document-contents-list">
          <li
            v-for="heading in rendered.headings"
            :key="heading.id"
            :class="{ 'is-nested': heading.level > 2 }"
          >
            <a :href="`#${heading.id}`" @click.prevent="jumpTo(heading.id, true)">{{
              heading.text
            }}</a>
          </li>
        </ol>
      </nav>
      <article
        ref="body"
        class="document-markdown"
        aria-label="문서 본문"
        @click="follow"
        v-html="rendered.html"
      ></article>
    </template>
  </section>
</template>
