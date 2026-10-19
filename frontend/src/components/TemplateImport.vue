<script setup lang="ts">
import { ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import AppDialog from './AppDialog.vue';
const store = useDemo(),
  open = ref(false),
  busy = ref(false),
  error = ref(''),
  chosen = ref<string[]>([]);
const templates = ref<{ id: string; title: string; englishName: string; imported: boolean }[]>([]);
async function show() {
  const scope = store.managementLv1,
    actor = store.actorId;
  try {
    const data = await api<typeof templates.value>(
      store.managementPath('/qualification-templates'),
    );
    if (scope !== store.managementLv1 || actor !== store.actorId) return;
    templates.value = data;
    chosen.value = [];
    error.value = '';
    open.value = true;
  } catch (err) {
    store.notify((err as Error).message);
  }
}
async function save() {
  busy.value = true;
  error.value = '';
  try {
    await store.command('/qualification-templates/import', { templateIds: chosen.value });
    open.value = false;
    store.notify('선택한 자격을 조직의 독립 초안으로 등록했습니다.');
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
function leave() {
  return (
    !busy.value &&
    (!open.value ||
      !chosen.value.length ||
      window.confirm('선택한 자격 가져오기를 취소하고 이동할까요?'))
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
</script>
<template>
  <button class="button secondary" :disabled="!store.managementReady || busy" @click="show">
    기본 자격 가져오기
  </button>
  <AppDialog v-model:open="open" title="기본 자격 가져오기">
    <p>{{ store.managementOrganization?.name }}</p>
    <p class="muted">필요한 자격을 선택한 뒤 설명·기간·과정 기준을 준비해 주세요.</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <div class="template-list">
      <label v-for="t in templates" :key="t.id" class="choice"
        ><input
          v-model="chosen"
          type="checkbox"
          :value="t.id"
          :disabled="t.imported || busy"
        /><span
          >{{ t.title
          }}<small class="muted"
            >{{ t.englishName }}{{ t.imported ? ' · 등록됨' : '' }}</small
          ></span
        ></label
      >
    </div>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="open = false">취소</button
      ><button class="button primary" :disabled="busy || !chosen.length" @click="save">
        선택 자격 가져오기
      </button></template
    >
  </AppDialog>
</template>
