<script setup lang="ts">
import { computed } from 'vue';
import { kstDate, addCalendarMonths, renewalOpensOn, renewalNoticeOn } from '@eks/contracts';
const props = defineProps<{ months: number | null; lead?: number; days?: number }>();
const example = computed(() => {
  if (!props.months || !Number.isInteger(props.lead ?? 3) || !Number.isInteger(props.days ?? 7))
    return;
  const startsOn = kstDate(),
    p = {
      id: 'example',
      sequence: 1,
      kind: 'initial' as const,
      qualificationId: 'example',
      qualificationVersion: 1,
      source: 'issued' as const,
      completedAt: new Date().toISOString(),
      startsOn,
      baseOn: startsOn,
      expiresOn: addCalendarMonths(startsOn, props.months),
      validity: { type: 'months' as const, months: props.months, reminderDays: [] },
      renewalLeadMonths: props.lead ?? 3,
      renewalNoticeDaysBefore: props.days ?? 7,
    };
  return { opensOn: renewalOpensOn(p), noticeOn: renewalNoticeOn(p) };
});
</script>
<template>
  <p v-if="example" class="muted renewal-notice-example">
    예시 · 오늘 취득하면 재인증 시작 {{ example.opensOn }}, 알림 {{ example.noticeOn }}에 1회입니다.
    실제 발급일에 따라 날짜가 정해집니다.
  </p>
</template>
