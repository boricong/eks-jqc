<script setup lang="ts">
import { computed } from 'vue';
import {
  certificationStatus,
  certificationStatusLabels,
  renewalPhase,
  type Certification,
} from '@eks/contracts';
const props = withDefaults(
  defineProps<{ certification: Certification; showRenewalPhase?: boolean }>(),
  { showRenewalPhase: true },
);
const status = computed(() => certificationStatus(props.certification)),
  phase = computed(() => renewalPhase(props.certification));
</script>
<template>
  <span class="validity-badge" :class="status">{{
    status === 'expiring' ? '유효' : certificationStatusLabels[status]
  }}</span
  ><span
    v-if="showRenewalPhase && (phase?.state === 'upcoming' || phase?.state === 'open')"
    class="renewal-phase-label"
    >{{ phase.state === 'open' ? '재인증 가능' : '재인증 예정' }} · {{ phase.opensOn }}</span
  >
</template>
