<script setup lang="ts">
import PageHeading from '../components/PageHeading.vue';
import PropertyList from '../components/PropertyList.vue';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import CredentialLifecycle from '../components/CredentialLifecycle.vue';
import CollapsibleSection from '../components/CollapsibleSection.vue';
import { kindLabels, recordQualificationType, qualificationTypeLabels } from '@eks/contracts';
import {
  isOwnedRecordContext,
  ownedQualificationsForType,
  documentContextQuery,
} from '../learner-navigation';
const store = useDemo(),
  route = useRoute();
const a = computed(() => {
  const a = store.assignment(String(route.params.id));
  return a?.certifiedAt &&
    (store.hasRole('system_operator') || store.hasRole('admin') || a.learnerId === store.actorId)
    ? a
    : undefined;
});
const qualification = computed(() =>
  a.value ? store.qualification(a.value.qualificationId, a.value.qualificationMetadata) : undefined,
);
const qualificationType = computed(() =>
  a.value && qualification.value
    ? recordQualificationType(qualification.value, a.value)
    : 'auditee',
);
const snapshot = computed(() => a.value?.certification?.snapshot);
const englishName = computed(() => {
  const metadata = a.value?.certification?.qualificationMetadata ?? a.value?.qualificationMetadata;
  return metadata?.englishName.trim() || '';
});
const evidenceOpen = ref(false),
  evidenceItemOpen = ref<Record<string, boolean>>({});
watch(
  [
    () => a.value?.certification?.id,
    () => a.value?.id,
    () => store.actorId,
    () => route.query.lv1OrganizationId,
  ],
  () => {
    evidenceOpen.value = false;
    evidenceItemOpen.value = {};
  },
);
function toggleEvidence(id: string, event: Event) {
  const details = event.target as HTMLDetailsElement;
  if (details.isConnected) evidenceItemOpen.value[id] = details.open;
}
const recordSource = computed(() =>
  snapshot.value?.source === 'issued'
    ? '발급 당시 정보'
    : snapshot.value?.source === 'migration'
      ? '이관 시 확보한 정보'
      : '기존 기록 기준',
);
const dates = (value: string) =>
  new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
const evidence = computed(() => {
  if (!a.value?.certification) return [];
  return a.value.certification.evidence.map((reference) => {
    const enrollment = a.value!.enrollments.find((e) => e.id === reference.enrollmentId);
    const completion =
      enrollment?.completion?.id === reference.completionId ? enrollment.completion : undefined;
    const course = enrollment && store.course(enrollment.courseId);
    return {
      id: reference.completionId,
      completion,
      title: completion?.snapshot?.title || course?.title || '인증Set 기록 확인 필요',
      version: completion?.snapshot?.version || course?.version,
      retired: course?.operationalStatus === 'retired',
      attempts: (completion?.evidence || []).map((item) => ({
        kind: item.kind,
        attempt: enrollment?.history.find((h) => h.id === item.attemptId),
      })),
    };
  });
});
const back = computed(() =>
  isOwnedRecordContext(route, a.value, store.actor)
    ? ownedQualificationsForType(qualificationType.value)
    : store.canEnterManagement && route.query.lv1OrganizationId
      ? store.managementLink('/admin/results')
      : store.hasRole('system_operator')
        ? '/system/overview'
        : store.hasRole('admin')
          ? '/admin/results'
          : ownedQualificationsForType(qualificationType.value),
);
</script>
<template>
  <div v-if="a" class="container page certificate-page">
    <RouterLink :to="back" class="back-link"><AppIcon name="back" :size="16" />목록으로</RouterLink>
    <PageHeading class="page-heading"
      ><h1>{{ qualificationTypeLabels[qualificationType] }} 자격 인증서</h1></PageHeading
    >
    <article class="certificate-document" aria-label="자격 발급 기록과 인증서">
      <section class="certificate-record" aria-label="발급 기록">
        <div class="certificate-record-heading">
          <AppIcon name="award" :size="20" />
          <h2>발급 기록</h2>
          <span>{{ recordSource }}</span>
        </div>
        <PropertyList class="certificate-record-facts">
          <div class="certificate-identifier">
            <dt>인증번호 · 기록 식별자</dt>
            <dd>{{ a.certification?.id || '기록 확인 필요' }}</dd>
          </div>
          <div>
            <dt>최초 발급 일시 · KST</dt>
            <dd>{{ dates(a.certification?.date || a.certifiedAt!) }}</dd>
          </div>
        </PropertyList>
      </section>
      <section class="certificate-identity" aria-label="발급 당시 자격 정보">
        <p class="certificate-eyebrow">
          {{ qualificationTypeLabels[qualificationType] }} 자격 인증서
        </p>
        <h2 class="certificate-title">{{ snapshot?.title || qualification?.title }}</h2>
        <p v-if="englishName" class="certificate-english-name" lang="en">{{ englishName }}</p>
        <p v-else class="certificate-english-empty">영문 자격명 미등록</p>
        <PropertyList class="certificate-identity-facts">
          <div>
            <dt>취득자</dt>
            <dd class="certificate-recipient">
              {{ snapshot?.learnerName || store.username(a.learnerId) }}
            </dd>
          </div>
          <div>
            <dt>{{ snapshot ? '발급 당시 소속' : '소속 · 기존 기록 기준' }}</dt>
            <dd>
              {{
                (snapshot?.organizationPath || a.organizationPath).map((o) => o.name).join(' › ')
              }}
            </dd>
          </div>
          <div>
            <dt>적용 자격 버전</dt>
            <dd>v{{ snapshot?.version || qualification?.version }}</dd>
          </div>
        </PropertyList>
      </section>
    </article>
    <p v-if="qualification?.description.includes('프로세스 검증용')" class="test-data-disclaimer">
      프로세스 검증용 가상 기준으로 발급된 시험 인증입니다. 실제 사내 직무 자격으로 사용하지
      않습니다.
    </p>
    <p v-if="a.excludedReason" class="error-message" role="alert">
      검증 제외 · {{ a.excludedReason }}
    </p>
    <CredentialLifecycle v-if="a.certification" :certification="a.certification">
      <template #evidence>
        <CollapsibleSection
          v-model:open="evidenceOpen"
          title="수료 근거"
          class="certificate-evidence certificate-disclosure"
        >
          <template #summary
            >인증Set {{ evidence.length }}개 · {{ evidenceOpen ? '접기' : '펼쳐 보기' }}</template
          >
          <details
            v-for="item in evidence"
            :key="item.id"
            class="evidence-course"
            :open="evidenceItemOpen[item.id] ?? false"
            @toggle="toggleEvidence(item.id, $event)"
          >
            <summary>
              <span class="evidence-course-name"
                >{{ item.title }}<small v-if="item.version">v{{ item.version }}</small></span
              ><StatusBadge v-if="item.completion" status="complete" /><StatusBadge
                v-if="item.retired"
                status="retired"
              /><span class="certificate-detail-action">{{
                evidenceItemOpen[item.id] ? '접기' : '상세 보기'
              }}</span
              ><AppIcon name="down" :size="16" :class="{ 'is-open': evidenceItemOpen[item.id] }" />
            </summary>
            <div class="certificate-evidence-body">
              <p v-if="item.completion?.method === 'self_confirmation'" class="muted">
                본인 학습 확인으로 수료 · 필수 항목 모두 완료
              </p>
              <div
                v-for="entry in item.completion?.learningEvidence || []"
                :key="entry.itemId"
                class="certificate-attempt"
              >
                <strong>{{ entry.title }}</strong>
                <p class="muted">
                  {{ entry.required ? '필수' : '선택' }} · 본인 확인 ·
                  {{ dates(entry.confirmedAt) }}
                </p>
              </div>
              <div v-for="entry in item.attempts" :key="entry.kind" class="certificate-attempt">
                <strong>{{ kindLabels[entry.kind] }}</strong>
                <PropertyList class="certificate-attempt-facts">
                  <div>
                    <dt>평가 점수</dt>
                    <dd>
                      {{
                        entry.attempt
                          ? `${entry.attempt.earned ?? '—'} / ${entry.attempt.total ?? '—'}점`
                          : '기록 확인 필요'
                      }}
                    </dd>
                  </div>
                  <div>
                    <dt>응시 회차</dt>
                    <dd>{{ entry.attempt ? `${entry.attempt.round}회` : '기록 확인 필요' }}</dd>
                  </div>
                  <div>
                    <dt>확정 일시 · KST</dt>
                    <dd>{{ entry.attempt ? dates(entry.attempt.date) : '기록 확인 필요' }}</dd>
                  </div>
                </PropertyList>
              </div>
              <p v-if="!item.completion" class="muted">연결된 수료 기록을 확인할 수 없습니다.</p>
              <RouterLink
                v-if="item.completion"
                class="text-link"
                :to="{
                  path: `/completions/${item.completion.id}`,
                  query: documentContextQuery(route, a, store.actor, qualificationType),
                }"
                >인증Set 수료증 보기 →</RouterLink
              >
            </div>
          </details>
          <p v-if="!evidence.length" class="muted">등록된 수료 근거가 없습니다.</p>
        </CollapsibleSection>
      </template>
    </CredentialLifecycle>
    <p v-else class="muted">현재 효력과 수료 근거를 확인할 인증 기록이 없습니다.</p>
  </div>
  <div v-else class="container page empty-state">
    <h1>인증을 찾을 수 없습니다.</h1>
    <RouterLink to="/" class="button secondary">홈으로</RouterLink>
  </div>
</template>
