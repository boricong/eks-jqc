<script setup lang="ts">
import { onBeforeUnmount, useId, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useDemo } from '../stores/demo';
import { confirmation, settleConfirmation } from '../composables/useConfirmation';
import AppDialog from './AppDialog.vue';
const store = useDemo(),
  route = useRoute(),
  descriptionId = useId();
watch(
  () => `${store.actorId}:${store.managementLv1}:${route.fullPath}`,
  () => void settleConfirmation(false),
);
onBeforeUnmount(() => void settleConfirmation(false));
</script>
<template>
  <AppDialog
    :open="!!confirmation"
    :title="confirmation?.title || '변경 확인'"
    :description-id="descriptionId"
    data-testid="app-confirmation"
    @update:open="settleConfirmation(false)"
  >
    <p :id="descriptionId" class="prose-text">{{ confirmation?.message }}</p>
    <template #footer>
      <button class="button secondary" autofocus @click="settleConfirmation(false)">취소</button>
      <button class="button primary" @click="settleConfirmation(true)">
        {{ confirmation?.action }}
      </button>
    </template>
  </AppDialog>
</template>
