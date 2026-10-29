<script setup lang="ts">
import type { DashboardChartDetails } from '@eks/contracts';
import { efficacyLabels, progressLabels } from './labels';
defineProps<{ detail: DashboardChartDetails }>();
defineEmits<{ member: [string, string?]; page: [number] }>();
</script>
<template>
  <p class="dashboard-detail-context">
    전체 {{ detail.rows.total.toLocaleString('ko-KR')
    }}{{
      detail.unit === 'people'
        ? '명'
        : detail.unit === 'credentials'
          ? '건 · 인증'
          : '건 · 사람×자격'
    }}
  </p>
  <div
    v-if="detail.rows.items.length"
    class="dashboard-table-wrap"
    tabindex="0"
    role="region"
    aria-label="차트 구간 명세 표"
  >
    <table class="dashboard-table">
      <thead>
        <tr>
          <th scope="col">구성원</th>
          <th scope="col">소속</th>
          <th scope="col">자격</th>
          <th scope="col">상태</th>
          <th scope="col">만료일</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in detail.rows.items" :key="row.key">
          <td>
            <button
              class="dashboard-link chart-member-link"
              :data-user-id="row.userId"
              @click="$emit('member', row.userId, row.entityId)"
            >
              {{ row.name }}
            </button>
          </td>
          <td>{{ row.organizationName }}</td>
          <td>{{ row.title || '—' }}</td>
          <td>
            <span v-if="row.efficacy">{{ efficacyLabels[row.efficacy] }}</span>
            <small v-if="row.progress && row.progress !== 'none'" class="dashboard-meta">{{
              progressLabels[row.progress]
            }}</small>
            <small v-if="row.held || row.inactive || row.workDeactive" class="dashboard-meta"
              >{{ row.workDeactive ? 'deactive' : row.held ? '대상자 Hold' : ''
              }}{{ row.inactive ? ' · 비활성 소속' : '' }}</small
            >
          </td>
          <td>{{ row.expiresOn || '—' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-else class="dashboard-empty">해당하는 기록이 없습니다.</p>
  <nav v-if="detail.rows.pages > 1" class="dashboard-pagination" aria-label="차트 명세 페이지">
    <button
      class="icon-button"
      aria-label="차트 명세 이전 페이지"
      :disabled="detail.rows.page <= 1"
      @click="$emit('page', detail.rows.page - 1)"
    >
      ‹
    </button>
    <span>{{ detail.rows.page }} / {{ detail.rows.pages }}</span>
    <button
      class="icon-button"
      aria-label="차트 명세 다음 페이지"
      :disabled="detail.rows.page >= detail.rows.pages"
      @click="$emit('page', detail.rows.page + 1)"
    >
      ›
    </button>
  </nav>
</template>
