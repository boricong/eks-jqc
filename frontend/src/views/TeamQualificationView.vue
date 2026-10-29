<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useDemo } from '../stores/demo';
import { useProcessContext } from '../composables/useProcessContext';
import { withCriteriaType } from '../management-navigation';
import { releaseVersionLabel, qualificationTypeLabels } from '@eks/contracts';
import PageHeading from '../components/PageHeading.vue';
import PropertyList from '../components/PropertyList.vue';
import CoursePreviewDialog from '../components/CoursePreviewDialog.vue';
import CourseCategory from '../components/CourseCategory.vue';
import StatusBadge from '../components/StatusBadge.vue';
import '../team-qualification.css';
const store = useDemo(),
  route = useRoute(),
  previewId = ref('');
const qualification = computed(() =>
  store.data.qualifications.find(
    (q) => q.id === route.params.id && q.lv1OrganizationId === store.managementLv1,
  ),
);
const versions = computed(() =>
  store.data.qualifications
    .filter(
      (q) =>
        q.entityId === qualification.value?.entityId && q.lv1OrganizationId === store.managementLv1,
    )
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0)),
);
const latest = computed(() => versions.value.find((q) => !q.deletedAt));
const canEdit = computed(
  () =>
    qualification.value &&
    !qualification.value.deletedAt &&
    latest.value?.id === qualification.value.id,
);
const courses = computed(
  () =>
    qualification.value?.courseIds.map((id) => store.data.courses.find((c) => c.id === id)) ?? [],
);
const preview = computed(() => courses.value.find((c) => c?.id === previewId.value) ?? null);
const link = (path: string) =>
  withCriteriaType(store.managementLink(path), qualification.value?.qualificationType);
useProcessContext(() => 'readonly');
</script>
<template>
  <div v-if="qualification" class="team-qualification-view">
    <RouterLink :to="link('/admin/qualifications')" class="back-link">← 팀 자격 설정</RouterLink>
    <PageHeading>
      <h1>{{ qualification.title || '이름 없는 자격' }}</h1>
      <div class="actions">
        <RouterLink
          v-if="canEdit"
          class="button primary"
          :to="link(`/admin/qualifications/${qualification.id}/edit`)"
          >변경</RouterLink
        >
      </div>
    </PageHeading>
    <div class="qualification-view-meta">
      <span>{{ qualificationTypeLabels[qualification.qualificationType] }}</span
      ><strong>{{ releaseVersionLabel(qualification) }}</strong
      ><span class="lifecycle-badge" :data-status="qualification.lifecycleStatus || 'Active'"
        >현재 상태 · {{ qualification.lifecycleStatus || 'Active' }}</span
      ><span v-if="qualification.deletedAt" class="muted"
        >삭제된 자격 · {{ qualification.deletionReason }}</span
      >
    </div>
    <p v-if="latest && latest.id !== qualification.id" class="qualification-newer-version">
      과거 버전 ·
      <RouterLink class="text-link" :to="link(`/admin/qualifications/${latest.id}`)"
        >최신 {{ releaseVersionLabel(latest) }} 조회</RouterLink
      >
    </p>
    <section class="qualification-view-section" aria-label="저장된 자격 정보">
      <h2>자격 정보</h2>
      <PropertyList class="team-qualification-facts"
        ><div>
          <dt>자격명</dt>
          <dd>{{ qualification.title }}</dd>
        </div>
        <div>
          <dt>영문명</dt>
          <dd>{{ qualification.englishName || '미설정' }}</dd>
        </div>
        <div v-if="qualification.description" class="team-qualification-description">
          <dt>설명</dt>
          <dd class="preserve-lines">{{ qualification.description }}</dd>
        </div>
        <div v-if="qualification.auditorCriteria">
          <dt>Auditor 등급</dt>
          <dd>{{ qualification.auditorCriteria.level === 'main' ? '메인' : '일반' }}</dd>
        </div></PropertyList
      >
    </section>
    <section
      v-if="qualification.purpose !== 'renewal'"
      class="qualification-view-section"
      aria-label="저장된 팀 운영 기준"
    >
      <h2>팀 운영 기준</h2>
      <p v-if="qualification.qualificationType === 'auditee'" class="muted">
        계획 확정 후 최대 완료 개월:
        {{
          qualification.planningDeadlineMonths
            ? `${qualification.planningDeadlineMonths}개월`
            : '당시 미설정'
        }}
      </p>
      <PropertyList class="team-qualification-facts"
        ><div>
          <dt>인증기간</dt>
          <dd>
            {{
              qualification.validity.type === 'unlimited'
                ? '무기한'
                : qualification.validity.type === 'months' && qualification.validity.months
                  ? `취득 후 ${qualification.validity.months}개월`
                  : '미정'
            }}
          </dd>
        </div>
        <template v-if="qualification.validity.type === 'months'"
          ><div>
            <dt>재인증 시작</dt>
            <dd>
              {{
                qualification.renewalLeadMonths == null
                  ? '미설정'
                  : `만료 ${qualification.renewalLeadMonths}개월 전`
              }}
            </dd>
          </div>
          <div>
            <dt>재인증 시작 전 알림</dt>
            <dd>
              {{
                qualification.renewalNoticeDaysBefore == null
                  ? '미설정'
                  : `${qualification.renewalNoticeDaysBefore}일 전`
              }}
            </dd>
          </div></template
        ></PropertyList
      >
    </section>
    <p v-else class="muted">재인증 · 객관식 전용 인증Set 1개</p>
    <section
      v-for="category in ['common', 'specialized']"
      :key="category"
      class="qualification-view-section"
      :aria-label="`적용 ${category === 'common' ? '공통' : '특화'}인증Set`"
    >
      <h2>적용 {{ category === 'common' ? '공통' : '특화' }}인증Set</h2>
      <div
        v-for="c in courses.filter((c) => c?.category === category)"
        :key="c!.id"
        class="qualification-course-row"
      >
        <strong>{{ c!.title || '이름 없음' }}</strong>
        <div class="qualification-course-meta">
          <CourseCategory :course="c!" /><span>{{ releaseVersionLabel(c!) }}</span
          ><StatusBadge v-if="c!.operationalStatus === 'retired'" status="retired" />
        </div>
        <button
          class="button secondary"
          :aria-label="`${c!.title} ${releaseVersionLabel(c!)} 내용 조회`"
          @click="previewId = c!.id"
        >
          내용 조회
        </button>
      </div>
      <p v-if="!courses.some((c) => c?.category === category)" class="muted">
        적용된 인증Set이 없습니다.
      </p>
    </section>
    <p v-if="courses.some((c) => !c)" class="error-message" role="alert">
      저장된 인증Set을 찾을 수 없습니다. 관리자 확인이 필요합니다.
    </p>
    <details class="criterion-versions">
      <summary>버전 이력 · {{ versions.length }}개</summary>
      <ul>
        <li v-for="q in versions" :key="q.id">
          <RouterLink :to="link(`/admin/qualifications/${q.id}`)"
            >{{ releaseVersionLabel(q) }} · {{ q.title
            }}{{ q.deletedAt ? ' · 삭제됨' : '' }}</RouterLink
          >
        </li>
      </ul>
    </details>
    <CoursePreviewDialog
      :open="!!previewId"
      :course="preview"
      @update:open="
        (open) => {
          if (!open) previewId = '';
        }
      "
    />
  </div>
  <p v-else class="empty-state">선택한 팀의 자격을 찾을 수 없습니다.</p>
</template>
<style scoped>
.team-qualification-view {
  min-width: 0;
}
.qualification-view-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
  font-size: var(--text-caption);
}
.qualification-view-section {
  padding: 24px 0;
  border-top: 1px solid var(--line);
}
.qualification-view-section h2 {
  font-size: var(--text-section);
  margin: 0 0 20px;
}
.qualification-view-section dd {
  overflow-wrap: anywhere;
}
.qualification-newer-version {
  margin-bottom: 24px;
}
</style>
