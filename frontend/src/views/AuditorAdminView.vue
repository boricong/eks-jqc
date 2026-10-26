<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import { confirmAction } from '../composables/useConfirmation';
import {
  auditorLevelLabels,
  type AuditorLevel,
  type AuditorProgram,
  type Qualification,
  type QualificationTemplate,
} from '@eks/contracts';
const store = useDemo(),
  tab = ref('criteria'),
  busy = ref(false),
  error = ref(''),
  dirty = ref(false);
type View = {
  program: AuditorProgram | null;
  readiness: { ready: boolean; reasons: string[] };
  general: {
    qualification: Qualification | null;
    template: QualificationTemplate | null;
    reasons: string[];
  };
  main: {
    qualification: Qualification | null;
    template: QualificationTemplate | null;
    reasons: string[];
  };
};
const data = ref<View>(),
  members = ref<any[]>([]),
  selected = ref<string[]>([]),
  preview = ref(false);
const conflict = ref(false),
  comparison = ref<View>();
const notice = ref({ title: '', body: '', links: [] as { title: string; url: string }[] });
const titles = ref<Record<AuditorLevel, { title: string; description: string }>>({
  general: { title: '일반 Auditor', description: '' },
  main: { title: '메인 Auditor', description: '' },
});
const team = computed(() => store.managementLv1);
const path = (suffix = '') =>
  `/auditor-program${suffix}?lv1OrganizationId=${encodeURIComponent(team.value)}`;
let sequence = 0;
async function load() {
  if (!team.value) return;
  const seq = ++sequence;
  try {
    const [result, people] = await Promise.all([api<View>(path()), api<any[]>(path('/members'))]);
    if (seq !== sequence) return;
    data.value = result;
    members.value = people;
    notice.value = structuredClone(result.program?.notice || { title: '', body: '', links: [] });
    for (const level of ['general', 'main'] as const) {
      titles.value[level] = {
        title: result[level].template?.title || auditorLevelLabels[level],
        description: result[level].template?.description || '',
      };
    }
    dirty.value = false;
    preview.value = false;
  } catch (e) {
    if (seq === sequence) error.value = (e as Error).message;
  }
}
watch(
  [team, () => store.actorId],
  () => {
    data.value = undefined;
    selected.value = [];
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
  preview.value = false;
  error.value = '';
  dirty.value = true;
}
function create(level: AuditorLevel) {
  return run(() =>
    store.command(path('/qualifications'), {
      revision: data.value?.program?.revision || 0,
      level,
      ...titles.value[level],
    }),
  );
}
function save() {
  return run(() =>
    store.command(
      path(),
      {
        revision: data.value?.program?.revision || 0,
        notice: { title: notice.value.title, body: notice.value.body, links: notice.value.links },
        titles: (['general', 'main'] as const)
          .filter((level) => data.value?.program?.[level])
          .map((level) => ({ level, ...titles.value[level] })),
      },
      'PUT',
    ),
  );
}
async function resend() {
  if (!preview.value || !data.value?.program) return;
  if (
    await run(() =>
      store.command(path('/notices/send'), {
        revision: data.value!.program!.revision,
        recipientIds: selected.value,
      }),
    )
  )
    selected.value = [];
}
function completionEvidence(assignmentId: string) {
  return (
    store.data.assignments
      .find((a) => a.id === assignmentId)
      ?.enrollments.filter((e) => e.completion)
      .map((e) => ({
        id: e.completion!.id,
        title: e.completion!.snapshot?.title || store.course(e.courseId).title,
      })) || []
  );
}
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
    <p class="muted">팀의 일반·메인 자격과 지정 안내를 관리합니다.</p>
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
      <p v-for="level in ['general', 'main'] as const" :key="level">
        {{ auditorLevelLabels[level] }} ·
        {{ comparison[level].qualification?.title || '준비 중' }} ·
        <span v-if="comparison[level].qualification?.description"
          >{{ comparison[level].qualification?.description }} · </span
        >현재 기준 버전
        {{ comparison[level].qualification?.version || '없음' }}
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
      <nav class="actions" aria-label="Auditor 운영 구역">
        <button
          v-for="item in [
            { id: 'criteria', label: '자격·학습 기준' },
            { id: 'notice', label: '지정 안내문' },
            { id: 'members', label: '대상자·진행' },
          ]"
          :key="item.id"
          class="button secondary"
          :aria-pressed="tab === item.id"
          @click="tab = item.id"
        >
          {{ item.label }}
        </button>
      </nav>
      <p role="status">신규 지정 준비 · {{ data.readiness.ready ? '완료' : '확인 필요' }}</p>
      <ul v-if="!data.readiness.ready" class="muted">
        <li v-for="reason in data.readiness.reasons" :key="reason">{{ reason }}</li>
      </ul>
      <form v-if="tab === 'criteria'" @input="dirty = true" @submit.prevent="save">
        <section
          v-for="level in ['general', 'main'] as const"
          :key="level"
          class="criteria-section"
        >
          <h2>{{ auditorLevelLabels[level] }}</h2>
          <label class="field"
            >자격명<input
              v-model="titles[level].title"
              :aria-label="`${auditorLevelLabels[level]} 자격명`"
              maxlength="300"
              required
          /></label>
          <label class="field"
            >설명 (선택)<textarea
              v-model="titles[level].description"
              :aria-label="`${auditorLevelLabels[level]} 설명`"
              maxlength="20000"
            />
          </label>
          <template v-if="data[level].qualification">
            <p>현재 기준 버전 · v{{ data[level].qualification!.version }}</p>
            <RouterLink
              class="text-link"
              :to="store.managementLink(`/admin/qualifications/${data[level].qualification!.id}`)"
              >인증Set·유효기간·갱신 기준 편집</RouterLink
            >
            <ul class="muted">
              <li v-for="reason in data[level].reasons" :key="reason">{{ reason }}</li>
            </ul>
          </template>
          <button
            v-else
            class="button secondary"
            type="button"
            :disabled="busy || !titles[level].title.trim()"
            @click="create(level)"
          >
            {{ auditorLevelLabels[level] }} 자격 생성
          </button>
        </section>
        <button class="button primary" :disabled="busy">운영 기준 저장</button>
      </form>
      <section v-else-if="tab === 'notice'">
        <form
          @input="
            dirty = true;
            preview = false;
          "
          @submit.prevent="save"
        >
          <label class="field">안내 제목<input v-model="notice.title" maxlength="300" /></label
          ><label class="field"
            >안내 본문<textarea v-model="notice.body" rows="6" maxlength="2000" />
          </label>
          <fieldset>
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
            <button
              type="button"
              class="button secondary"
              :disabled="notice.links.length >= 20"
              @click="
                notice.links.push({ title: '', url: '' });
                dirty = true;
              "
            >
              자료 링크 추가
            </button>
          </fieldset>
          <p class="muted">수정은 이후 지정부터 적용됩니다. 이미 발송한 안내는 바뀌지 않습니다.</p>
          <button class="button primary" :disabled="busy">안내문 저장</button>
        </form>
        <h2>선택 대상자에게 재발송</h2>
        <label
          v-for="person in members.filter((p) => p.designated)"
          :key="person.id"
          class="recipient"
          ><input v-model="selected" type="checkbox" :value="person.id" />{{ person.name }}</label
        >
        <button
          class="button secondary"
          :disabled="dirty || !selected.length || busy"
          @click="preview = true"
        >
          발송 미리보기
        </button>
        <section v-if="preview" class="notice-preview" aria-label="발송 미리보기">
          <h3>{{ data.program?.notice.title }}</h3>
          <p class="notice-body">{{ data.program?.notice.body }}</p>
          <p>수신자 {{ selected.length }}명 · Auditor 학습 진입 링크 포함</p>
          <a
            v-for="link in data.program?.notice.links"
            :key="link.url"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            >{{ link.title }}</a
          ><button class="button primary" :disabled="busy || !selected.length" @click="resend">
            안내 발송
          </button>
        </section>
      </section>
      <section v-else aria-label="Auditor 대상자 진행">
        <article v-for="person in members" :key="person.id" class="member-row">
          <h2>{{ person.name }}</h2>
          <p>
            {{ person.designated ? '지정' : '지정 해제' }} · 현재
            {{
              person.currentLevel
                ? auditorLevelLabels[person.currentLevel as AuditorLevel]
                : '유효 등급 없음'
            }}
          </p>
          <div v-for="level in person.levels" :key="level.level">
            <strong>{{ auditorLevelLabels[level.level as AuditorLevel] }}</strong
            ><span>
              ·
              {{
                level.certification
                  ? '유효'
                  : level.assignment
                    ? `${level.completed}/${level.total} 수료`
                    : level.history.length
                      ? '과거 취득 이력 보유'
                      : '미시작'
              }}</span
            ><span v-if="level.certification">
              · 만료 {{ level.certification.expiresOn || '무기한' }}</span
            >
            <p v-if="level.pendingAward" class="muted">
              학습 수료 · 선행 자격과 취득 효력 확인 대기
            </p>
            <p v-if="level.renewal" class="muted">
              {{ level.renewal.canStart ? '갱신 가능' : level.renewal.reasons.join(' · ') }}
            </p>
            <ul v-if="level.assignment">
              <li v-for="evidence in completionEvidence(level.assignment.id)" :key="evidence.id">
                <RouterLink :to="store.managementLink(`/completions/${evidence.id}`)"
                  >{{ evidence.title }} · 수료 근거</RouterLink
                >
              </li>
            </ul>
            <ul v-if="level.history.length">
              <li v-for="cert in level.history" :key="cert.id">
                <RouterLink :to="store.managementLink(`/certifications/${cert.assignmentId}`)"
                  >{{
                    new Date(cert.date).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
                  }}
                  취득 · 인증·효력 근거</RouterLink
                >
              </li>
            </ul>
          </div>
          <ul v-if="person.legacyCertifications.length">
            <li v-for="cert in person.legacyCertifications" :key="cert.id">
              <RouterLink :to="store.managementLink(`/certifications/${cert.assignmentId}`)"
                >이전 Auditor 인증 · 등급 미지정</RouterLink
              >
            </li>
          </ul>
        </article>
        <p v-if="!members.length" class="muted">Auditor 대상자가 없습니다.</p>
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
