<script setup lang="ts">
import type { DashboardMemberDetail } from '@eks/contracts';
import AppDialog from '../AppDialog.vue';
import DashboardMemberContent from './DashboardMemberContent.vue';
defineProps<{
  open: boolean;
  detail: DashboardMemberDetail | null;
  entityId?: string;
  loading: boolean;
  error: string;
}>();
defineEmits<{ close: []; retry: []; closed: [] }>();
</script>
<template>
  <AppDialog
    class="dashboard-dialog dashboard-person-dialog"
    :open="open"
    :title="detail ? detail.person.name + ' · 인증 현황' : '구성원 인증 현황'"
    @update:open="!$event && $emit('close')"
    @closed="$emit('closed')"
  >
    <DashboardMemberContent
      :detail="detail"
      :entity-id="entityId"
      :loading="loading"
      :error="error"
      @retry="$emit('retry')"
    />
    <template #footer
      ><button class="button secondary" @click="$emit('close')">닫기</button></template
    >
  </AppDialog>
</template>
