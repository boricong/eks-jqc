<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import { confirmAction } from '../composables/useConfirmation';
import type { AuditorProgram } from '@eks/contracts';
import PageHeading from '../components/PageHeading.vue';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
const store = useDemo(),
  busy = ref(false),
  error = ref(''),
  dirty = ref(false);
type View = {
  program: Omit<AuditorProgram, 'general' | 'main'> | null;
  teamEnabled: boolean;
  members: number;
  readiness: { ready: boolean; reasons: string[] };
};
const data = ref<View>(),
  conflict = ref(false),
  comparison = ref<View>();
const notice = ref({ title: '', body: '', links: [] as { title: string; url: string }[] });
const team = computed(() => store.managementLv1);
const loading = ref(false),
  noticeSection = ref<HTMLElement>(),
  noticeTitle = ref<HTMLInputElement>(),
  comparisonSection = ref<HTMLElement>();
const menus = [
  {
    title: '자격 풀',
    label: 'Auditor 자격 풀',
    group: '기준 설정',
    icon: 'award',
    path: '/admin/qualifications',
    description: '팀에서 사용할 자격과 인증 기준을 설정합니다.',
  },
  {
    title: '인증Set',
    label: 'Auditor 인증Set',
    group: '기준 설정',
    icon: 'book',
    path: '/admin/courses',
    description: '교육·자료와 필수 교육 확인 기준을 관리합니다.',
  },
  {
    title: '인증 현황',
    label: 'Auditor 현황',
    group: '현황·기록',
    icon: 'chart',
    path: '/admin/dashboard',
    description: '팀 구성원의 취득·학습·갱신 현황을 확인합니다.',
  },
  {
    title: '평가·수료 결과',
    label: 'Auditor 결과',
    group: '현황·기록',
    icon: 'clipboard',
    path: '/admin/results',
    description: '필수 교육 확인과 인증Set 수료 근거를 조회합니다.',
  },
  {
    title: '보유 인증',
    label: 'Auditor 보유 인증',
    group: '현황·기록',
    icon: 'file',
    path: '/admin/credentials',
    description: '발급된 인증의 효력·유효기간·이력을 관리합니다.',
  },
];
const menuLocation = (path: string) => ({
  path,
  query: {
    lv1OrganizationId: team.value,
    ...(path === '/admin/dashboard' ? { qualificationType: 'auditor' } : { type: 'auditor' }),
  },
});
function editNotice() {
  noticeSection.value?.scrollIntoView({ block: 'start' });
  noticeTitle.value?.focus({ preventScroll: true });
}
const path = (suffix = '') =>
  `/auditor-program${suffix}?lv1OrganizationId=${encodeURIComponent(team.value)}`;
let sequence = 0;
async function load() {
  if (!team.value) return;
  const seq = ++sequence;
  loading.value = true;
  error.value = '';
  try {
    const result = await api<View>(path());
    if (seq !== sequence) return;
    data.value = result;
    notice.value = structuredClone(result.program?.notice || { title: '', body: '', links: [] });
    dirty.value = false;
  } catch (e) {
    if (seq === sequence) error.value = (e as Error).message;
  } finally {
    if (seq === sequence) loading.value = false;
  }
}
watch(
  [team, () => store.actorId],
  () => {
    sequence++;
    loading.value = false;
    error.value = '';
    dirty.value = false;
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
    if (seq === sequence) {
      comparison.value = latest;
      await nextTick();
      if (seq === sequence) comparisonSection.value?.scrollIntoView({ block: 'center' });
    }
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
  noticeTitle.value?.focus();
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
  <section class="auditor-admin" aria-label="Auditor 관리">
    <PageHeading>
      <div>
        <h1>Auditor 관리</h1>
        <p class="auditor-page-description">팀의 인증 기준과 취득 현황을 한곳에서 관리합니다.</p>
      </div>
      <button v-if="data" type="button" class="button secondary" @click="editNotice">
        <AppIcon name="notice" :size="18" />학습 안내문
      </button>
    </PageHeading>
    <p v-if="!team" class="empty-state" role="status">관리할 팀을 선택해 주세요.</p>
    <p v-else-if="loading && !data" class="empty-state" role="status">
      팀 운영 정보를 불러오는 중입니다.
    </p>
    <div v-if="error && !data" class="auditor-error">
      <p class="error-message" role="alert">{{ error }}</p>
      <button v-if="!data" type="button" class="button secondary" :disabled="loading" @click="load">
        다시 불러오기
      </button>
      <button
        v-if="conflict"
        type="button"
        class="button secondary"
        :disabled="busy"
        @click="compareLatest"
      >
        최신 기준 비교
      </button>
    </div>
    <template v-if="data">
      <section class="auditor-overview" aria-label="Auditor 운영 요약">
        <div class="auditor-overview-item">
          <span class="auditor-overview-label">대상 팀</span>
          <StatusBadge
            :status="data.teamEnabled ? 'active' : 'retired'"
            :label="data.teamEnabled ? '사용' : '미사용'"
          />
          <RouterLink
            v-if="store.hasRole('system_operator')"
            class="text-link auditor-team-setting"
            to="/system/organizations"
            >대상 팀 설정<AppIcon name="chevron" :size="16"
          /></RouterLink>
          <span v-else class="auditor-overview-note">Lv1 및 모든 하위 조직</span>
        </div>
        <div class="auditor-overview-item">
          <span class="auditor-overview-label">대상 인원</span>
          <strong class="auditor-member-count">{{ data.members }}<span>명</span></strong>
          <span class="auditor-overview-note">{{
            data.teamEnabled ? '소속 구성원 전체' : '미사용 팀의 소속 인원'
          }}</span>
        </div>
        <div class="auditor-overview-item">
          <span class="auditor-overview-label">인증 기준</span>
          <StatusBadge
            :status="data.readiness.ready ? 'active' : 'catalogDraft'"
            :label="data.readiness.ready ? '준비 완료' : '보완 필요'"
          />
          <span class="auditor-overview-note">자격·필수 교육 준비 상태</span>
        </div>
      </section>
      <aside
        v-if="!data.teamEnabled || !data.readiness.ready"
        class="auditor-readiness"
        aria-label="Auditor 운영 안내"
      >
        <AppIcon name="alert" :size="20" />
        <div>
          <strong>{{
            !data.teamEnabled ? '신규 취득을 사용하지 않는 팀입니다.' : '인증 기준을 준비해 주세요.'
          }}</strong>
          <p v-if="!data.teamEnabled">
            기존 진행과 인증 기록은 유지됩니다. 신규 취득은 대상 팀 설정 후 이용할 수 있습니다.
          </p>
          <ul v-if="!data.readiness.ready">
            <li v-for="reason in data.readiness.reasons" :key="reason">{{ reason }}</li>
          </ul>
        </div>
      </aside>
      <nav class="auditor-menu-section" aria-labelledby="auditor-menu-title">
        <div class="auditor-section-heading">
          <h2 id="auditor-menu-title">Auditor 업무</h2>
          <span class="muted">기준 설정 · 현황 · 기록</span>
        </div>
        <div class="auditor-menu-grid">
          <RouterLink
            v-for="menu in menus"
            :key="menu.path"
            :to="menuLocation(menu.path)"
            :aria-label="menu.label"
            class="auditor-menu-card"
          >
            <span class="auditor-menu-icon"><AppIcon :name="menu.icon" :size="24" /></span>
            <span class="auditor-menu-content">
              <span class="auditor-menu-category">{{ menu.group }}</span>
              <strong>{{ menu.title }}</strong>
              <span class="auditor-menu-description">{{ menu.description }}</span>
            </span>
            <AppIcon name="chevron" :size="18" class="auditor-menu-arrow" />
          </RouterLink>
        </div>
      </nav>
      <section
        ref="noticeSection"
        class="auditor-notice-editor"
        aria-label="Auditor 팀 학습 안내문 설정"
      >
        <div class="auditor-section-heading auditor-notice-heading">
          <div>
            <h2>Auditor 팀 학습 안내문 설정</h2>
            <p class="muted">구성원 홈에 표시할 학습 안내를 작성합니다.</p>
          </div>
          <span class="auditor-editor-state">{{
            dirty ? '저장하지 않은 변경사항' : data.program ? '저장된 안내문' : '미작성'
          }}</span>
        </div>
        <section
          v-if="comparison"
          ref="comparisonSection"
          class="notice-preview"
          aria-label="최신 운영 기준 비교"
        >
          <h3>다른 창에서 저장한 최신 기준</h3>
          <p>현재 입력은 유지됩니다. 최신 내용과 비교한 뒤 저장 기준을 갱신해 주세요.</p>
          <strong>{{ comparison.program?.notice.title || '제목 없음' }}</strong>
          <p class="notice-body">{{ comparison.program?.notice.body }}</p>
          <a
            v-for="link in comparison.program?.notice.links"
            :key="link.url"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            >{{ link.title }}</a
          >
          <button type="button" class="button secondary" :disabled="busy" @click="keepDraft">
            입력 유지하고 저장 기준 갱신
          </button>
        </section>
        <form :aria-busy="busy" @input="dirty = true" @submit.prevent="save">
          <fieldset class="auditor-notice-fields" :disabled="busy">
            <legend class="sr-only">팀 학습 안내문</legend>
            <label class="field"
              ><span>안내 제목</span
              ><input ref="noticeTitle" v-model="notice.title" maxlength="300"
            /></label>
            <label class="field"
              ><span>안내 본문</span><textarea v-model="notice.body" rows="5" maxlength="2000" />
            </label>
            <div class="auditor-links-heading">
              <h3>
                자료 링크 <span class="muted">{{ notice.links.length }}/20</span>
              </h3>
              <button
                type="button"
                class="button secondary"
                :disabled="notice.links.length >= 20"
                @click="
                  notice.links.push({ title: '', url: '' });
                  dirty = true;
                "
              >
                <AppIcon name="plus" :size="16" />링크 추가
              </button>
            </div>
            <p v-if="!notice.links.length" class="muted auditor-links-empty">
              등록된 자료 링크가 없습니다.
            </p>
            <div
              v-for="(link, index) in notice.links"
              :key="index"
              class="auditor-link-row"
              role="group"
              :aria-label="`자료 링크 ${index + 1}`"
            >
              <label class="field"
                ><span>링크 제목</span><input v-model="link.title" maxlength="200" required
              /></label>
              <label class="field"
                ><span>HTTP(S) 주소</span
                ><input v-model="link.url" type="url" pattern="https?://.*" required
              /></label>
              <button
                type="button"
                class="button secondary"
                :aria-label="`자료 링크 ${index + 1} 삭제`"
                @click="
                  notice.links.splice(index, 1);
                  dirty = true;
                "
              >
                <AppIcon name="close" :size="16" />삭제
              </button>
            </div>
          </fieldset>
          <div v-if="error" class="auditor-error">
            <p class="error-message" role="alert">{{ error }}</p>
            <button
              v-if="conflict"
              type="button"
              class="button secondary"
              :disabled="busy"
              @click="compareLatest"
            >
              최신 기준 비교
            </button>
          </div>
          <div class="auditor-notice-footer">
            <p class="muted" role="status">
              {{ busy ? '안내문을 저장하고 있습니다.' : '저장한 안내문은 구성원 홈에 반영됩니다.' }}
            </p>
            <button class="button primary" :disabled="busy">
              <AppIcon name="check" :size="18" />안내문 저장
            </button>
          </div>
        </form>
      </section>
    </template>
  </section>
</template>
<style scoped>
.auditor-admin {
  min-width: 0;
}
.auditor-admin h1,
.auditor-admin h2,
.auditor-admin h3,
.auditor-admin p {
  margin: 0;
}
.auditor-page-description {
  color: var(--ink-secondary);
  margin-top: 8px !important;
  line-height: 1.6;
}
.auditor-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--line);
  background: var(--surface);
  margin-top: 24px;
}
.auditor-overview-item {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 20px 24px;
}
.auditor-overview-item + .auditor-overview-item {
  border-left: 1px solid var(--line);
}
.auditor-overview-label {
  color: var(--ink-secondary);
  font-size: var(--text-caption);
  font-weight: var(--weight-control);
}
.auditor-member-count {
  font-size: 28px;
  font-weight: var(--weight-heading);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.auditor-member-count span {
  margin-left: 6px;
  font-size: var(--text-body);
  font-weight: var(--weight-body);
}
.auditor-overview-note,
.auditor-team-setting {
  font-size: var(--text-caption);
  line-height: 1.5;
}
.auditor-overview-note {
  color: var(--ink-secondary);
}
.auditor-team-setting {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.auditor-readiness {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: var(--surface-tint);
  border-left: 3px solid var(--line-strong, var(--line));
  padding: 16px 20px;
  margin-top: 16px;
  color: var(--ink-secondary);
  font-size: var(--text-caption);
  line-height: 1.6;
}
.auditor-readiness > svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.auditor-readiness strong {
  color: var(--ink);
  font-weight: var(--weight-control);
}
.auditor-readiness p,
.auditor-readiness ul {
  margin: 4px 0 0;
}
.auditor-readiness ul {
  padding-left: 18px;
}
.auditor-menu-section {
  margin-top: 32px;
}
.auditor-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.auditor-section-heading h2 {
  font-size: var(--text-section);
  font-weight: var(--weight-heading);
  line-height: 1.5;
}
.auditor-section-heading > .muted {
  font-size: var(--text-caption);
}
.auditor-menu-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.auditor-menu-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  padding: 24px 20px;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-input);
  text-decoration: none;
}
.auditor-menu-card:hover {
  border-color: var(--link);
  background: var(--surface-tint);
}
.auditor-menu-card:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}
.auditor-menu-icon {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--link);
  margin-top: 4px;
}
.auditor-menu-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 6px;
}
.auditor-menu-category {
  color: var(--ink-secondary);
  font-size: 12px;
}
.auditor-menu-content strong {
  font-size: 18px;
  font-weight: var(--weight-control);
  line-height: 1.5;
}
.auditor-menu-description {
  color: var(--ink-secondary);
  font-size: var(--text-caption);
  line-height: 1.6;
  word-break: keep-all;
  overflow-wrap: anywhere;
}
.auditor-menu-arrow {
  flex-shrink: 0;
  align-self: center;
  color: var(--ink-secondary);
  margin-left: auto;
}
.auditor-notice-editor {
  margin-top: 40px;
  padding-top: 28px;
  border-top: 1px solid var(--line);
  scroll-margin-top: 96px;
}
.auditor-notice-heading {
  align-items: flex-start;
}
.auditor-notice-heading p {
  margin-top: 6px;
  font-size: var(--text-caption);
}
.auditor-editor-state {
  font-size: var(--text-caption);
  color: var(--ink-secondary);
  line-height: 1.5;
}
.auditor-notice-fields {
  min-width: 0;
  border: 0;
  padding: 0;
  margin: 0;
}
.auditor-notice-fields > .field {
  margin: 20px 0;
}
.auditor-notice-fields textarea {
  resize: vertical;
}
.auditor-links-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding-top: 4px;
}
.auditor-links-heading h3 {
  font-size: var(--text-body);
  font-weight: var(--weight-control);
}
.auditor-links-heading h3 span {
  font-size: var(--text-caption);
  margin-left: 6px;
  font-variant-numeric: tabular-nums;
}
.auditor-links-empty {
  padding: 16px 0;
  font-size: var(--text-caption);
}
.auditor-link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto;
  align-items: end;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
}
.auditor-link-row .field {
  margin: 0;
  min-width: 0;
}
.auditor-notice-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 0 0;
}
.auditor-notice-footer p {
  font-size: var(--text-caption);
}
.notice-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.notice-preview {
  padding: 20px;
  border: 1px solid var(--line);
  background: var(--surface-tint);
  margin: 20px 0;
  display: grid;
  gap: 12px;
}
.notice-preview .button {
  justify-self: start;
}
.notice-preview a {
  overflow-wrap: anywhere;
}
.auditor-error {
  display: grid;
  justify-items: start;
  gap: 12px;
  margin: 16px 0;
}
@media (max-width: 1279px) {
  .auditor-menu-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 767px) {
  .auditor-overview {
    grid-template-columns: 1fr;
  }
  .auditor-overview-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px 16px;
    padding: 16px 20px;
  }
  .auditor-overview-item + .auditor-overview-item {
    border-left: 0;
    border-top: 1px solid var(--line);
  }
  .auditor-overview-note,
  .auditor-team-setting {
    grid-column: 1 / -1;
  }
  .auditor-overview-item > .status {
    justify-self: end;
  }
  .auditor-menu-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .auditor-menu-card {
    padding: 20px;
  }
  .auditor-section-heading {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 8px;
  }
  .auditor-link-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .auditor-link-row > .button {
    justify-self: end;
  }
  .auditor-notice-footer {
    align-items: stretch;
    flex-direction: column;
  }
  .auditor-notice-footer .button {
    width: 100%;
  }
}
</style>
