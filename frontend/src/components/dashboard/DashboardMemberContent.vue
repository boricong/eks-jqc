<script setup lang="ts">
import { releaseVersionLabel } from '@eks/contracts';
import { computed } from 'vue';
import type { DashboardMemberDetail } from '@eks/contracts';
import { qualificationVersionLabel } from '@eks/contracts';
import {
  efficacyLabels,
  progressLabels,
  renewalLabels,
  renewalBlockLabels,
  assessmentLabels,
  displayDate,
} from './labels';
const props = defineProps<{
  detail: DashboardMemberDetail | null;
  entityId?: string;
  loading: boolean;
  error: string;
}>();
defineEmits<{ retry: [] }>();
const qualifications = computed(
  () =>
    props.detail?.qualifications.filter((q) => !props.entityId || q.entityId === props.entityId) ||
    [],
);
const history = computed(
  () => props.detail?.history.filter((h) => !props.entityId || h.entityId === props.entityId) || [],
);
</script>
<template>
  <p v-if="loading" class="dashboard-loading" role="status">구성원 현황을 불러오는 중입니다.</p>
  <div v-else-if="error" class="dashboard-notice error" role="alert">
    <span>{{ error }}</span
    ><button class="button secondary" @click="$emit('retry')">다시 조회</button>
  </div>
  <template v-else-if="detail">
    <dl class="dashboard-person-summary">
      <div>
        <dt>현재 소속</dt>
        <dd>{{ detail.person.organizationPath.map((p) => p.name).join(' / ') }}</dd>
      </div>
      <div>
        <dt>집계 상태</dt>
        <dd>
          {{ detail.person.eligible ? '취득 대상' : '집계 제외'
          }}{{ detail.person.held ? ' · 대상자 Hold' : ''
          }}{{ detail.person.inactive ? ' · 비활성 소속' : '' }}
        </dd>
      </div>
    </dl>
    <section aria-label="구성원 자격 현황">
      <h2>자격 현황</h2>
      <p v-if="!qualifications.length" class="dashboard-empty">조회할 자격이 없습니다.</p>
      <article v-for="q in qualifications" :key="q.entityId" class="dashboard-person-record">
        <h3>{{ q.title }}</h3>
        <div class="dashboard-record-attributes">
          <span class="dashboard-status" :class="q.efficacy.toLowerCase()">{{
            efficacyLabels[q.efficacy]
          }}</span>
          <span>{{
            q.registered
              ? `현재 팀 기준 ${releaseVersionLabel({ version: q.currentVersion, releaseVersion: q.currentReleaseVersion })}`
              : '과거 기록 · 기록 보존'
          }}</span>
          <span v-if="q.progress !== 'none'">{{ progressLabels[q.progress] }}</span>
          <span v-if="q.renewalState !== 'not_applicable'">{{
            renewalLabels[q.renewalState]
          }}</span>
        </div>
        <dl class="dashboard-person-summary">
          <div>
            <dt>기록 기준</dt>
            <dd>
              {{ q.recordTitle || q.title
              }}{{
                q.recordVersion
                  ? ` · ${releaseVersionLabel({ version: q.recordVersion, releaseVersion: q.recordReleaseVersion })}`
                  : ''
              }}
            </dd>
          </div>
          <div>
            <dt>인증Set 수료</dt>
            <dd>{{ q.completedCourses }} / {{ q.totalCourses }}</dd>
          </div>
          <div v-if="q.issuedOn">
            <dt>취득일</dt>
            <dd>{{ displayDate(q.issuedOn) }}</dd>
          </div>
          <div v-if="q.certificationId">
            <dt>현재 만료일</dt>
            <dd>
              {{ q.expiresOn || (q.expiryBucket === 'unlimited' ? '무기한' : '확인 필요') }}
            </dd>
          </div>
          <div v-if="q.endOn">
            <dt>종료일</dt>
            <dd>{{ q.endOn }}</dd>
          </div>
          <div v-if="q.renewalOpensOn">
            <dt>재인증 시작일</dt>
            <dd>{{ q.renewalOpensOn }}</dd>
          </div>
        </dl>
        <ul v-if="q.acquisitionBlockCodes.length" class="dashboard-meta">
          <li v-for="code in q.acquisitionBlockCodes" :key="code">
            {{ renewalBlockLabels[code] || '취득 진행 상태를 관리자에게 확인해 주세요.' }}
          </li>
        </ul>
        <ul
          v-if="q.renewalBlockCodes.length && q.renewalState === 'blocked'"
          class="dashboard-meta"
        >
          <li v-for="code in q.renewalBlockCodes" :key="code">
            {{ renewalBlockLabels[code] || '재인증 상태를 관리자에게 확인해 주세요.' }}
          </li>
        </ul>
        <details v-if="q.courses.length">
          <summary>
            {{
              q.courses[0]?.qualificationType === 'auditor'
                ? '인증Set·학습 확인 현황'
                : '인증Set·평가 통과 현황'
            }}
          </summary>
          <div
            class="dashboard-table-wrap"
            tabindex="0"
            role="region"
            aria-label="인증Set 평가 상태 표"
          >
            <table class="dashboard-table">
              <thead>
                <tr>
                  <th scope="col">인증Set</th>
                  <th scope="col">수료</th>
                  <th scope="col">
                    {{
                      q.courses[0]?.qualificationType === 'auditor' ? '필수 학습 확인' : '지식 평가'
                    }}
                  </th>
                  <th v-if="q.courses[0]?.qualificationType !== 'auditor'" scope="col">
                    상황 대응 평가
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in q.courses" :key="c.courseId">
                  <td>{{ c.title }} · {{ releaseVersionLabel(c) }}</td>
                  <td>
                    {{ c.completed ? '수료' : '미수료'
                    }}<small v-if="c.completedOn" class="dashboard-meta">{{
                      displayDate(c.completedOn)
                    }}</small>
                  </td>
                  <td>
                    {{
                      c.qualificationType === 'auditor'
                        ? `${c.confirmedItems} / ${c.requiredItems}`
                        : assessmentLabels[c.objective]
                    }}
                  </td>
                  <td v-if="c.qualificationType !== 'auditor'">
                    {{ assessmentLabels[c.practical] }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
        <RouterLink v-if="q.detailsHref" class="dashboard-link" :to="q.detailsHref"
          >상세 근거 조회</RouterLink
        >
      </article>
    </section>
    <section
      v-if="detail.requests.length && !entityId"
      class="dashboard-person-record"
      aria-label="계획 요청 현황"
    >
      <h2>계획 요청</h2>
      <ul>
        <li v-for="request in detail.requests" :key="request.id">
          <strong>{{
            request.closedOn ? '요청 종료' : request.completedOn ? '계획 수립 완료' : '미완료'
          }}</strong>
          · 작성 기한
          {{ request.dueOn }}
          <p v-if="request.closedOn" class="dashboard-meta">
            종료일 {{ request.closedOn }} · {{ request.closeReason }}
          </p>
          <p class="dashboard-meta">
            요청일 {{ request.createdOn
            }}{{ request.completedOn ? ` · 완료일 ${request.completedOn}` : '' }}
          </p>
        </li>
      </ul>
    </section>
    <details v-if="history.length" class="dashboard-person-record">
      <summary>과거 취득 기록 {{ history.length }}건</summary>
      <ol>
        <li v-for="record in history" :key="record.assignmentId">
          <strong>{{ record.title }} · {{ releaseVersionLabel(record) }}</strong>
          <p>
            {{ efficacyLabels[record.efficacy] }}{{ record.excluded ? ' · 검증 제외' : ''
            }}{{ record.closed ? ' · 취득 종료' : '' }}
          </p>
          <p class="dashboard-meta">
            {{ record.organizationPath.map((p) => p.name).join(' / ')
            }}{{ record.currentOrganization ? '' : ' · 이전 소속' }} ·
            {{
              record.issuedOn
                ? `취득 ${displayDate(record.issuedOn)}`
                : `배정 ${displayDate(record.assignedOn)}`
            }}
          </p>
          <RouterLink v-if="record.detailsHref" class="dashboard-link" :to="record.detailsHref"
            >상세 근거 조회</RouterLink
          >
        </li>
      </ol>
    </details>
    <details
      v-if="detail.previousPlanningRecords.length && !entityId"
      class="dashboard-person-record"
    >
      <summary>이전 소속의 계획 기록 {{ detail.previousPlanningRecords.length }}건</summary>
      <p class="dashboard-meta">현재 조직의 진행·기한 경과 집계에서 제외합니다.</p>
      <ul>
        <li v-for="record in detail.previousPlanningRecords" :key="`${record.kind}-${record.id}`">
          <strong>{{ record.title }}</strong>
          <p>
            {{
              record.kind === 'draft'
                ? '계획 초안'
                : record.completedOn
                  ? '완료한 계획 요청'
                  : '미완료 계획 요청'
            }}{{ record.dueOn ? ` · 기한 ${record.dueOn}` : '' }}
          </p>
          <p class="dashboard-meta">
            {{ record.organizationPath.map((p) => p.name).join(' / ') }} ·
            {{ displayDate(record.createdOn) }}
          </p>
        </li>
      </ul>
    </details>
  </template>
</template>
