<script setup lang="ts">
import { computed } from 'vue';
import ObjectiveChoices from './ObjectiveChoices.vue';
import CatalogFieldErrors from './CatalogFieldErrors.vue';
import type { CatalogIssue } from '@eks/contracts';
import type { CatalogRow, CatalogTable } from '@eks/contracts';
const props = defineProps<{
  row: CatalogRow;
  table: CatalogTable;
  courses: CatalogRow[];
  disabled?: boolean;
  issues?: CatalogIssue[];
}>();
const emit = defineEmits<{ change: []; checkpoint: [] }>();
const kinds = computed({
  get: () =>
    String(props.row.kinds || '')
      .split(',')
      .filter(Boolean),
  set: (v: string[]) => {
    props.row.kinds = v.join(',');
    emit('change');
  },
});
const content = computed(() => props.row as Record<string, string>);
const choices = computed({
  get: () =>
    Array.from(
      {
        length: Math.max(
          0,
          ...Object.keys(props.row)
            .filter((k) => /^choice\d+$/.test(k))
            .map((k) => Number(k.slice(6))),
        ),
      },
      (_, i) => String(props.row['choice' + (i + 1)] ?? ''),
    ),
  set: (values: string[]) => {
    Object.keys(props.row)
      .filter((k) => /^choice\d+$/.test(k))
      .forEach((k) => delete props.row[k]);
    values.forEach((v, i) => (props.row['choice' + (i + 1)] = v));
    emit('change');
  },
});
const correct = computed({
  get: () =>
    props.row.correct == null || props.row.correct === '' ? null : Number(props.row.correct) - 1,
  set: (v: number | null) => {
    props.row.correct = v == null ? null : v + 1;
    emit('change');
  },
});
const choiceErrors = computed(() =>
  Object.fromEntries((props.issues || []).map((i) => [i.column, i.message])),
);
</script>
<template>
  <fieldset
    class="catalog-fields"
    :disabled="disabled"
    @focusin="emit('checkpoint')"
    @input="emit('change')"
    @change="emit('change')"
  >
    <label v-if="table !== 'courses'" class="field"
      >인증Set<select v-model="row.courseCode" data-field="courseCode" aria-label="인증Set">
        <option value="">연결할 인증Set 선택</option>
        <option v-for="(c, index) in courses" :key="String(c.code)" :value="c.code">
          {{ index + 1 }}. {{ c.title || '이름 없는 인증Set' }}
        </option></select
      ><CatalogFieldErrors :issues="issues" field="courseCode"
    /></label>
    <label class="field" v-if="['courses', 'learning', 'materials'].includes(table)"
      >{{ table === 'courses' ? '인증Set명' : table === 'learning' ? '학습 항목명' : '자료명'
      }}<input v-model="row.title" data-field="title" /><CatalogFieldErrors
        :issues="issues"
        field="title"
    /></label>
    <template v-if="table === 'courses'">
      <fieldset class="catalog-kinds">
        <legend>필수 평가 유형</legend>
        <label
          v-for="[key, label] in [
            ['objective', '객관식 · 지식 평가'],
            ['practical', '실기 · 상황 대응 평가'],
          ]"
          :key="key"
          ><input v-model="kinds" type="checkbox" :value="key" />{{ label }}</label
        >
      </fieldset>
      <div class="form-grid">
        <label v-if="kinds.includes('objective')" class="field"
          >객관식 합격 기준 (%)<input
            v-model.number="row.passScore"
            data-field="passScore"
            type="number"
            min="0"
            max="100"
            placeholder="사용 등록 전 입력" /><CatalogFieldErrors
            :issues="issues"
            field="passScore" /></label
        ><label v-if="kinds.includes('practical')" class="field"
          >상황 대응 합격 기준 (%)<input
            v-model.number="row.practicalPassScore"
            data-field="practicalPassScore"
            type="number"
            min="0"
            max="100"
            placeholder="사용 등록 전 입력" /><CatalogFieldErrors
            :issues="issues"
            field="practicalPassScore"
        /></label>
      </div>
    </template>
    <template v-if="table === 'learning'"
      ><div class="form-grid">
        <label class="field"
          >교육 종류<select v-model="row.type" data-field="type" aria-label="교육 종류">
            <option value="mtc">MTC교육</option>
            <option value="team">팀 특화 교육</option>
            <option value="ojt">현업 OJT</option></select
          ><CatalogFieldErrors :issues="issues" field="type" /></label
        ><label class="field"
          >필수 여부<select v-model="row.required" data-field="required" aria-label="필수 여부">
            <option :value="true">필수</option>
            <option :value="false">선택</option></select
          ><CatalogFieldErrors :issues="issues" field="required"
        /></label></div
    ></template>
    <template v-if="table === 'objective' || table === 'practical'">
      <p class="muted">정답은 관리자만 확인하는 정보입니다.</p>
      <div class="form-grid">
        <label class="field"
          >배점<input
            v-model.number="row.points"
            data-field="points"
            type="number"
            min="1" /><CatalogFieldErrors :issues="issues" field="points"
        /></label>
      </div>
      <label v-if="table === 'practical'" class="field"
        >상황 설명<textarea
          v-model="content.scenario"
          data-field="scenario"
          rows="4" /><CatalogFieldErrors :issues="issues" field="scenario"
      /></label>
      <label class="field"
        >문항<textarea v-model="content.prompt" data-field="prompt" rows="4" /><CatalogFieldErrors
          :issues="issues"
          field="prompt"
        />
      </label>

      <ObjectiveChoices
        v-model:choices="choices"
        v-model:correct="correct"
        :disabled="disabled"
        :errors="choiceErrors"
      />
    </template>
    <template v-if="table === 'materials'"
      ><label class="field"
        >자료 유형<select v-model="row.type" data-field="type">
          <option value="text">직접 작성</option>
          <option value="edm">EDM Link</option>
          <option value="confluence">Confluence</option>
          <option value="url">일반 URL</option>
        </select></label
      ><label v-if="row.type === 'text'" class="field"
        >본문<textarea v-model="content.content" data-field="content" rows="5" /></label
      ><template v-else
        ><label class="field">URL<input v-model="row.url" data-field="url" type="url" /></label
        ><label class="field"
          >설명<textarea
            v-model="content.description"
            data-field="description"
            rows="2"
          /></label></template
    ></template>
  </fieldset>
</template>
