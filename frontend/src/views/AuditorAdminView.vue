<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import { confirmAction } from '../composables/useConfirmation';
import type { AuditorProgram } from '@eks/contracts';
const store = useDemo(),
  busy = ref(false),
  error = ref(''),
  dirty = ref(false);
type View = { program: Omit<AuditorProgram, 'general' | 'main'> | null };
const data = ref<View>(),
  conflict = ref(false),
  comparison = ref<View>();
const notice = ref({ title: '', body: '', links: [] as { title: string; url: string }[] });
const team = computed(() => store.managementLv1);
const path = (suffix = '') =>
  `/auditor-program${suffix}?lv1OrganizationId=${encodeURIComponent(team.value)}`;
let sequence = 0;
async function load() {
  if (!team.value) return;
  const seq = ++sequence;
  try {
    const result = await api<View>(path());
    if (seq !== sequence) return;
    data.value = result;
    notice.value = structuredClone(result.program?.notice || { title: '', body: '', links: [] });
    dirty.value = false;
  } catch (e) {
    if (seq === sequence) error.value = (e as Error).message;
  }
}
watch(
  [team, () => store.actorId],
  () => {
    data.value = undefined;

    comparison.value = undefined;
    conflict.value = false;
    void load();
  },
  { immediate: true },
);
async function run(action: () => Promise<unknown>) {
  if (busy.value) return false;
  busy.value = true;
  error.value = '';
  try {
    await action();
    await store.refresh();
    await load();
    conflict.value = false;
    comparison.value = undefined;
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    conflict.value = e instanceof ApiError && e.code === 'REVISION_CONFLICT';
    return false;
  } finally {
    busy.value = false;
  }
}
async function compareLatest() {
  const seq = sequence;
  busy.value = true;
  try {
    const latest = await api<View>(path());
    if (seq === sequence) comparison.value = latest;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function keepDraft() {
  if (!comparison.value) return;
  data.value = comparison.value;
  comparison.value = undefined;
  conflict.value = false;

  error.value = '';
  dirty.value = true;
}
function save() {
  return run(() =>
    store.command(
      path(),
      {
        revision: data.value?.program?.revision || 0,
        notice: { title: notice.value.title, body: notice.value.body, links: notice.value.links },
      },
      'PUT',
    ),
  );
}
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value || busy.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeUnmount(() => {
  sequence++;
  window.removeEventListener('beforeunload', beforeUnload);
});
async function leave() {
  if (busy.value) return false;
  return (
    !dirty.value || (await confirmAction('저장하지 않은 운영 설정이 있습니다. 이동할까요?', '이동'))
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
</script>
<template>
  <section class="auditor-admin">
    <h1>Auditor 운영</h1>
    <p v-if="!team" role="status">관리할 팀을 선택해 주세요.</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <button v-if="conflict" class="button secondary" :disabled="busy" @click="compareLatest">
      최신 기준 비교
    </button>
    <section v-if="comparison" class="notice-preview" aria-label="최신 운영 기준 비교">
      <h2>다른 창에서 저장한 최신 기준</h2>
      <p>
        현재 입력은 아래 편집 화면에 유지됩니다. 최신 내용과 비교한 뒤 저장할 내용을 결정해 주세요.
      </p>
      <h3>{{ comparison.program?.notice.title }}</h3>
      <p class="notice-body">{{ comparison.program?.notice.body }}</p>
      <a
        v-for="link in comparison.program?.notice.links"
        :key="link.url"
        :href="link.url"
        target="_blank"
        rel="noopener noreferrer"
        >{{ link.title }}</a
      >
      <button class="button secondary" :disabled="busy" @click="keepDraft">
        입력 유지하고 저장 기준 갱신
      </button>
    </section>
    <template v-if="data">
      <section aria-label="Auditor 지정 학습 안내문 설정">
        <h2>Auditor 지정 학습 안내문 설정</h2>
        <form @input="dirty = true" @submit.prevent="save">
          <label class="field">안내 제목<input v-model="notice.title" maxlength="300" /></label
          ><label class="field"
            >안내 본문<textarea v-model="notice.body" rows="6" maxlength="2000" />
          </label>
          <fieldset v-if="notice.links.length">
            <legend>자료 링크</legend>
            <div v-for="(link, index) in notice.links" :key="index" class="link-row">
              <label class="field">링크 제목<input v-model="link.title" required /></label
              ><label class="field"
                >HTTP(S) 주소<input
                  v-model="link.url"
                  type="url"
                  pattern="https?://.*"
                  required /></label
              ><button
                type="button"
                class="button secondary"
                @click="
                  notice.links.splice(index, 1);
                  dirty = true;
                "
              >
                삭제
              </button>
            </div>
          </fieldset>
          <div class="notice-actions">
            <button class="button primary" :disabled="busy">안내문 저장</button>
          </div>
        </form>
      </section>
    </template>
  </section>
</template>
<style scoped>
.auditor-admin {
  min-width: 0;
  max-width: 1080px;
}
.criteria-section,
.member-row {
  border-top: 1px solid var(--border, #e3e8ee);
  padding: 24px 0;
}
.notice-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.field {
  margin: 16px 0;
}
.link-row {
  display: flex;
  align-items: end;
  gap: 12px;
  margin-bottom: 12px;
}
.link-row .field {
  flex: 1;
  min-width: 0;
}
.recipient {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
}
.notice-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.notice-preview {
  padding: 20px;
  border: 1px solid var(--border, #e3e8ee);
  margin: 20px 0;
}
.notice-preview a {
  display: block;
}
.member-row .text-link {
  margin-left: 12px;
}
fieldset {
  min-width: 0;
}
@media (max-width: 768px) {
  .link-row {
    display: block;
  }
  .button {
    min-height: 44px;
    white-space: normal;
  }
}
</style>
