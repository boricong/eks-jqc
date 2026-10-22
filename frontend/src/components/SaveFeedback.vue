<script setup lang="ts">
import AppIcon from './AppIcon.vue';
defineProps<{ status: string; error?: string; conflict?: boolean; busy?: boolean }>();
defineEmits<{ retry: []; reload: [] }>();
</script>
<template>
  <div class="save-feedback">
    <span class="save-status" role="status" aria-atomic="true">
      <AppIcon
        :name="conflict || error ? 'alert' : status === '저장됨' ? 'check' : 'clock'"
        :size="16"
      />
      {{ conflict ? '다른 창의 변경 확인 필요' : status }}
    </span>
    <div v-if="error" class="save-error" role="alert">
      <p class="preserve-lines">{{ error }}</p>
      <div class="actions">
        <button
          v-if="!conflict"
          class="button secondary small"
          :disabled="busy"
          @click="$emit('retry')"
        >
          저장 재시도
        </button>
        <button class="button secondary small" :disabled="busy" @click="$emit('reload')">
          다시 불러오기
        </button>
      </div>
    </div>
  </div>
</template>
