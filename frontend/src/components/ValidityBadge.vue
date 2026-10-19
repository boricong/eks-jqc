<script setup lang="ts">
import { certificationStatus, certificationStatusLabels, type Certification } from '@eks/contracts';
defineProps<{ certification: Certification }>();
</script>
<template>
  <span class="validity-badge" :class="certificationStatus(certification)">{{
    certificationStatusLabels[certificationStatus(certification)]
  }}</span>
</template>
