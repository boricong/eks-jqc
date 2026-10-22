<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDemo } from '../stores/demo';
import {
  effectiveCredentialStatus,
  credentialCurrent,
  lifecycleLabels,
  kstDate,
} from '@eks/contracts';
const store = useDemo(),
  search = ref(''),
  status = ref('all');
const rows = computed(() =>
  store.data.assignments.filter(
    (a) =>
      a.certification &&
      (!status.value ||
        status.value === 'all' ||
        effectiveCredentialStatus(a.certification) === status.value) &&
      `${store.username(a.learnerId)} ${store.qualification(a.qualificationId, a.qualificationMetadata).title}`.includes(
        search.value,
      ),
  ),
);
</script>
<template>
  <section class="panel editor-panel lifecycle-panel" aria-label="개인 보유 자격 관리">
    <h2>개인 보유 자격 관리</h2>
    <p>
      취득자의 자격 효력을 정지·해제·폐기하거나 갱신 이력을 확인합니다. 대상자 Hold와 별도로
      적용하며 최초 취득 근거는 유지합니다.
    </p>
    <div class="form-grid">
      <label class="field">이름·자격 검색<input v-model="search" type="search" /></label
      ><label class="field"
        >개인 자격 상태<select v-model="status">
          <option value="all">전체</option>
          <option v-for="(label, key) in lifecycleLabels" :key="key" :value="key">
            {{ label }}
          </option>
        </select></label
      >
    </div>
    <div class="table-panel lifecycle-target-table">
      <table>
        <thead>
          <tr>
            <th>취득자</th>
            <th>자격</th>
            <th>현재 효력</th>
            <th>최초 취득 / 현재 만료</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in rows" :key="a.id">
            <td>{{ store.username(a.learnerId) }}</td>
            <td>
              {{ store.qualification(a.qualificationId, a.qualificationMetadata).title
              }}<small class="muted">
                · 최초 v{{
                  store.qualification(a.qualificationId, a.qualificationMetadata).version
                }}</small
              >
            </td>
            <td>{{ lifecycleLabels[effectiveCredentialStatus(a.certification!)] }}</td>
            <td>
              {{ kstDate(a.certification!.date) }}<br />{{
                credentialCurrent(a.certification!).expiresOn ||
                (credentialCurrent(a.certification!).validity?.type === 'unlimited'
                  ? '무기한'
                  : '확인 필요')
              }}
            </td>
            <td>
              <RouterLink
                class="button secondary"
                :to="store.managementLink(`/certifications/${a.id}`)"
                >상태·이력 관리</RouterLink
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!rows.length" class="empty-state">해당하는 보유 자격이 없습니다.</p>
  </section>
</template>
