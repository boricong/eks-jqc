<script setup lang="ts">
import type { DashboardDetails, DashboardMetric } from '@eks/contracts';
import AppDialog from '../AppDialog.vue';
import { metricLabels, efficacyLabels, progressLabels, renewalBlockLabels } from './labels';
defineProps<{
  open: boolean;
  metric: DashboardMetric;
  detail: DashboardDetails | null;
  loading: boolean;
  error: string;
}>();
defineEmits<{ close: []; retry: []; member: [string, string?]; page: [number]; closed: [] }>();
const units = {
  people: '명',
  person_qualification: '사람·자격',
  requests: '요청',
  credentials: '인증',
  enrollments: '인증Set 수강',
};
const blockReasons = (codes: string[]) =>
  codes.map((code) => renewalBlockLabels[code] || '진행 상태 확인 필요').join(' ');
</script>
<template>
  <AppDialog
    class="dashboard-dialog"
    :open="open"
    :title="`${metricLabels[metric] || '인증 현황'} · 명세`"
    @update:open="!$event && $emit('close')"
    @closed="$emit('closed')"
  >
    <p v-if="loading" class="dashboard-loading" role="status">명세를 불러오는 중입니다.</p>
    <div v-else-if="error" class="dashboard-notice error" role="alert">
      <span>{{ error }}</span
      ><button class="button secondary" @click="$emit('retry')">다시 조회</button>
    </div>
    <template v-else-if="detail">
      <p class="dashboard-detail-context">
        {{ detail.snapshot.scope.organizationName }} · 전체
        {{ detail.rows.total.toLocaleString('ko-KR') }} {{ units[detail.unit]
        }}<template v-if="detail.denominator !== undefined">
          · 충족 {{ detail.numerator }} / 대상 {{ detail.denominator }}</template
        >
      </p>
      <div
        v-if="detail.rows.items.length"
        class="dashboard-table-wrap"
        tabindex="0"
        role="region"
        aria-label="지표 명세 표"
      >
        <table class="dashboard-table">
          <thead>
            <tr>
              <th scope="col">구성원</th>
              <th scope="col">소속</th>
              <th scope="col">자격·요청</th>
              <th scope="col">상태</th>
              <th scope="col">기한</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in detail.rows.items" :key="row.key">
              <td>
                <button class="dashboard-link" @click="$emit('member', row.userId, row.entityId)">
                  {{ row.name }}
                </button>
              </td>
              <td>{{ row.organizationName }}</td>
              <td>
                <span v-if="row.required" class="dashboard-required">[필수] </span
                >{{ row.title || (row.requestId ? '계획 수립 요청' : '—')
                }}<small v-if="row.courseTitle" class="dashboard-meta">{{ row.courseTitle }}</small>
              </td>
              <td>
                <template
                  v-if="
                    ['requiredCoverage', 'requiredMissing'].includes(metric) &&
                    row.fulfilled !== undefined
                  "
                  >{{ row.fulfilled ? '충족' : '미충족' }}</template
                ><template v-else-if="row.efficacy || row.progress"
                  ><span v-if="row.efficacy">{{ efficacyLabels[row.efficacy] }}</span
                  ><small v-if="row.progress && row.progress !== 'none'" class="dashboard-meta">{{
                    progressLabels[row.progress]
                  }}</small></template
                ><template v-else>{{ row.eligible ? '취득 대상' : '집계 제외' }}</template
                ><small v-if="row.held || row.inactive" class="dashboard-meta">{{
                  [row.held ? '대상자 Hold' : '', row.inactive ? '비활성 소속' : '']
                    .filter(Boolean)
                    .join(' · ')
                }}</small>
                <small v-if="row.acquisitionBlockCodes?.length" class="dashboard-meta">{{
                  blockReasons(row.acquisitionBlockCodes)
                }}</small>
              </td>
              <td class="dashboard-date">{{ row.dueOn || row.expiresOn || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="dashboard-empty">해당하는 기록이 없습니다.</p>
      <nav v-if="detail.rows.pages > 1" class="dashboard-pagination" aria-label="명세 페이지">
        <button
          class="icon-button"
          aria-label="명세 이전 페이지"
          :disabled="detail.rows.page <= 1"
          @click="$emit('page', detail.rows.page - 1)"
        >
          ‹</button
        ><span>{{ detail.rows.page }} / {{ detail.rows.pages }}</span
        ><button
          class="icon-button"
          aria-label="명세 다음 페이지"
          :disabled="detail.rows.page >= detail.rows.pages"
          @click="$emit('page', detail.rows.page + 1)"
        >
          ›
        </button>
      </nav>
    </template>
    <template #footer
      ><button class="button secondary" @click="$emit('close')">닫기</button></template
    >
  </AppDialog>
</template>
