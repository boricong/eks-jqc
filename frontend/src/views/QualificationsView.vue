<script setup lang="ts">
import {
  learningStage,
  qualificationLocation,
  ownedCertificateLocation,
} from '../learner-navigation';
import PageHeading from '../components/PageHeading.vue';
import { computed, ref, watch } from 'vue';
import {
  kstDate,
  certificationStatus,
  credentialCurrent,
  latestPeriod,
  renewalOpensOn,
  type Assignment,
} from '@eks/contracts';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import LearnerNav from '../components/LearnerNav.vue';
import ValidityBadge from '../components/ValidityBadge.vue';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const assessments = computed(
  () => route.query.filter !== 'certified' && learningStage(route) === 'assessment',
);
const search = ref(''),
  validity = ref('all');
const filter = computed(() =>
  route.query.filter === 'excluded'
    ? 'excluded'
    : route.query.filter === 'certified'
      ? 'certified'
      : 'active',
);
const title = (a: Assignment) =>
  (filter.value === 'certified' && a.certification?.snapshot?.title) ||
  store.qualification(a.qualificationId, a.qualificationMetadata).title;
watch(
  () => filter.value === 'certified',
  () => {
    search.value = '';
    validity.value = 'all';
  },
);
const list = computed(() =>
  store.data.assignments.filter(
    (a) =>
      a.learnerId === store.actorId &&
      !a.acquisitionClosedAt &&
      (filter.value === 'excluded'
        ? !!a.excludedReason
        : !a.excludedReason && Boolean(a.certifiedAt) === (filter.value === 'certified')) &&
      (filter.value !== 'certified' ||
        validity.value === 'all' ||
        (a.certification &&
          (validity.value === 'valid'
            ? ['valid', 'expiring'].includes(certificationStatus(a.certification))
            : certificationStatus(a.certification) === validity.value))) &&
      title(a).toLowerCase().includes(search.value.toLowerCase()),
  ),
);
</script>
<template>
  <div class="container page">
    <LearnerNav v-if="filter !== 'certified'" />
    <p v-if="store.actor.certificationEligibility === 'hold'" class="error-message">
      취득 대상자 Hold · 새 취득·평가·재인증은 중단됩니다. 기록과 자료는 확인할 수 있습니다.
    </p>
    <PageHeading class="page-heading">
      <h1>{{ filter === 'certified' ? '보유 자격' : assessments ? '평가' : '학습' }}</h1>
      <span class="muted">{{ store.actor.name }}</span>
    </PageHeading>
    <div class="list-toolbar">
      <div v-if="filter !== 'certified'" class="tabs" aria-label="자격 상태">
        <button
          :class="{ active: filter === 'active' }"
          :aria-pressed="filter === 'active'"
          @click="router.replace({ query: { stage: assessments ? 'assessment' : undefined } })"
        >
          진행 중
          <span>{{
            store.myAssignments.filter((a) => !a.certifiedAt && !a.acquisitionClosedAt).length
          }}</span>
        </button>
        <button
          :class="{ active: filter === 'excluded' }"
          :aria-pressed="filter === 'excluded'"
          @click="
            router.replace({
              query: { filter: 'excluded', stage: assessments ? 'assessment' : undefined },
            })
          "
        >
          검증 제외
        </button>
      </div>
      <select v-if="filter === 'certified'" v-model="validity" aria-label="자격 유효 상태">
        <option value="all">취득 이력 전체</option>
        <option value="valid">현재 유효</option>
        <option value="expiring">재인증 기간</option>
        <option value="revoked">Revoke · 폐기</option>
        <option value="held">Hold · 정지</option>
        <option value="expired">만료 처리 예정</option>
        <option value="unknown">유효기간 미설정</option>
      </select>
      <label class="search-field"
        ><AppIcon name="search" :size="18" /><input
          v-model="search"
          aria-label="자격 검색"
          placeholder="자격 검색"
      /></label>
    </div>
    <div v-if="filter === 'certified'" class="qualification-list owned-qualification-list">
      <div v-if="list.length" class="owned-list-heading" aria-hidden="true">
        <span>자격명</span><span>취득일</span><span>만료일</span><span>상태</span><span></span>
      </div>
      <RouterLink
        v-for="a in list"
        :key="a.id"
        :to="ownedCertificateLocation(a.id)"
        class="qualification-row owned-qualification-row"
      >
        <span class="owned-title row-title">{{ title(a) }}</span>
        <span class="owned-acquired owned-date"
          ><span class="owned-mobile-label">취득일</span
          ><time>{{ kstDate(a.certification?.date || a.certifiedAt!) }}</time></span
        >
        <span class="owned-expires owned-date"
          ><span class="owned-mobile-label">만료일</span
          ><time v-if="a.certification && credentialCurrent(a.certification).expiresOn">{{
            credentialCurrent(a.certification).expiresOn
          }}</time
          ><span v-else>{{
            a.certification && credentialCurrent(a.certification).validity?.type === 'unlimited'
              ? '무기한'
              : '미설정'
          }}</span></span
        >
        <span class="owned-status"
          ><ValidityBadge
            v-if="a.certification"
            :certification="a.certification"
            :show-renewal-phase="false"
          /><span v-else class="muted">기존 기록</span
          ><span
            v-if="
              store
                .qualification(a.qualificationId, a.qualificationMetadata)
                .description.includes('프로세스 검증용')
            "
            class="test-data-tag"
            >시험 데이터</span
          ></span
        >
        <AppIcon class="owned-arrow" name="arrow" :size="18" />
      </RouterLink>
    </div>
    <div v-else class="qualification-list">
      <RouterLink
        v-for="a in list"
        :key="a.id"
        :to="
          a.certifiedAt
            ? ownedCertificateLocation(a.id)
            : qualificationLocation(assessments ? 'assessment' : 'learning', a.id)
        "
        class="qualification-row"
        ><span class="qualification-icon"
          ><AppIcon :name="a.certifiedAt ? 'award' : 'book'" :size="26" /></span
        ><span class="qualification-info"
          ><span class="row-title">{{
            store.qualification(a.qualificationId, a.qualificationMetadata).title
          }}</span
          ><span
            v-if="
              store
                .qualification(a.qualificationId, a.qualificationMetadata)
                .description.includes('프로세스 검증용')
            "
            class="test-data-tag"
            >시험 데이터</span
          ><span class="muted"
            >v{{ store.qualification(a.qualificationId, a.qualificationMetadata).version }} · 필수
            {{ a.enrollments.length }}인증Set</span
          ><span v-if="a.certification" class="muted"
            >취득 {{ kstDate(a.certifiedAt!) }} ·
            {{
              credentialCurrent(a.certification).expiresOn
                ? `만료 ${credentialCurrent(a.certification).expiresOn}`
                : credentialCurrent(a.certification).validity?.type === 'unlimited'
                  ? '무기한'
                  : '유효기간 미설정 · 기존 기록'
            }}</span
          ><span
            v-if="
              a.certification &&
              latestPeriod(a.certification) &&
              renewalOpensOn(latestPeriod(a.certification)!)
            "
            class="muted"
            >재인증 시작 {{ renewalOpensOn(latestPeriod(a.certification)!) }} · 상태와 이력
            보기</span
          ></span
        ><span v-if="a.planId && !assessments" class="qualification-target"
          ><span class="small-label">목표일</span
          ><time>{{
            store.data.plans.find((p) => p.id === a.planId)?.targetOn || '미설정'
          }}</time></span
        ><span class="qualification-progress"
          ><span class="progress-label"
            ><span>{{ assessments ? '평가 통과' : '인증Set 수료' }}</span
            ><span
              >{{ assessments ? store.passedCount(a) : store.completedCount(a) }} /
              {{ assessments ? store.assessmentCount(a) : a.enrollments.length }}</span
            ></span
          ><span class="progress-track"
            ><span
              :style="{
                width: `${assessments ? (store.assessmentCount(a) ? (store.passedCount(a) / store.assessmentCount(a)) * 100 : 0) : a.enrollments.length ? (store.completedCount(a) / a.enrollments.length) * 100 : 0}%`,
              }"
            ></span></span></span
        ><StatusBadge v-if="a.excludedReason" status="excluded" /><ValidityBadge
          v-else-if="a.certification"
          :certification="a.certification" /><span v-else class="inline-action"
          >{{
            assessments
              ? `평가 선택 · ${Math.max(0, store.assessmentCount(a) - store.passedCount(a))}개 남음`
              : '학습하기'
          }}<AppIcon name="arrow" :size="18" /></span
      ></RouterLink>
    </div>
    <div v-if="!list.length" class="panel empty-state spacious">
      <AppIcon name="book" :size="32" />
      <h2>
        {{
          search
            ? '검색 결과가 없습니다.'
            : filter === 'certified'
              ? '완료된 인증이 없습니다.'
              : '배정된 자격이 없습니다.'
        }}
      </h2>
      <RouterLink v-if="filter === 'active' && !search" to="/plans" class="button primary"
        >내 계획 확인</RouterLink
      >
    </div>
  </div>
</template>
