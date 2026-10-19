<script setup lang="ts">
import { computed } from 'vue';
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
const choices = computed(() =>
  Array.from(
    {
      length: Math.max(
        4,
        ...Object.keys(props.row)
          .filter((k) => /^choice\d+$/.test(k))
          .map((k) => Number(k.slice(6))),
      ),
    },
    (_, i) => i + 1,
  ),
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
      >과정<select v-model="row.courseCode" data-field="courseCode" aria-label="과정">
        <option value="">연결할 과정 선택</option>
        <option v-for="(c, index) in courses" :key="String(c.code)" :value="c.code">
          {{ index + 1 }}. {{ c.title || '이름 없는 과정' }}
        </option></select
      ><CatalogFieldErrors :issues="issues" field="courseCode"
    /></label>
    <label class="field" v-if="['courses', 'learning', 'practical'].includes(table)"
      >{{ table === 'courses' ? '과정명' : table === 'learning' ? '학습 항목명' : '평가 항목'
      }}<input v-model="row.title" data-field="title" /><CatalogFieldErrors
        :issues="issues"
        field="title"
    /></label>
    <template v-if="table === 'courses'">
      <fieldset class="catalog-kinds">
        <legend>필수 평가 유형</legend>
        <label
          v-for="[key, label] in [
            ['objective', '객관식'],
            ['subjective', '주관식'],
            ['practical', '실기'],
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
        ><label v-if="kinds.includes('subjective')" class="field"
          >주관식 합격 기준 (%)<input
            v-model.number="row.subjectivePassScore"
            data-field="subjectivePassScore"
            type="number"
            min="0"
            max="100"
            placeholder="사용 등록 전 입력" /><CatalogFieldErrors
            :issues="issues"
            field="subjectivePassScore"
        /></label>
      </div>
      <label class="field"
        >학습자료<textarea
          v-model="content.material"
          data-field="material"
          rows="4" /><CatalogFieldErrors :issues="issues" field="material" /></label
      ><label class="field"
        >자료 URL<input v-model="row.materialUrl" data-field="materialUrl" /><CatalogFieldErrors
          :issues="issues"
          field="materialUrl" /></label
      ><label v-if="kinds.includes('practical')" class="field"
        >실기 수행 조건<textarea
          v-model="content.instruction"
          data-field="instruction"
          rows="2"
        /><CatalogFieldErrors :issues="issues" field="instruction" />
      </label>
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
    <template v-if="table === 'objective' || table === 'subjective'">
      <p class="muted">정답·모범답안·채점 기준은 관리자와 지정 평가자가 확인하는 정보입니다.</p>
      <label class="field"
        >문항<textarea v-model="content.prompt" data-field="prompt" rows="4" /><CatalogFieldErrors
          :issues="issues"
          field="prompt"
        />
      </label>
      <div class="form-grid">
        <label v-if="table === 'objective'" class="field"
          >문항 종류<select v-model="row.category" data-field="category" aria-label="문항 종류">
            <option value="written">필기</option>
            <option value="case">Case</option></select
          ><CatalogFieldErrors :issues="issues" field="category" /></label
        ><label class="field"
          >배점<input
            v-model.number="row.points"
            data-field="points"
            type="number"
            min="1" /><CatalogFieldErrors :issues="issues" field="points"
        /></label>
      </div>
      <template v-if="table === 'objective'"
        ><div class="catalog-choices">
          <label v-for="n in choices" :key="n" class="field"
            >선택지 {{ n
            }}<input v-model="row[`choice${n}`]" :data-field="`choice${n}`" /><CatalogFieldErrors
              :issues="issues"
              field="`choice${n}`"
          /></label>
        </div>
        <button
          class="text-link"
          type="button"
          :disabled="choices.length >= 50"
          @click="
            row[`choice${choices.length + 1}`] = '';
            emit('change');
          "
        >
          선택지 추가</button
        ><label class="field"
          >정답<select v-model.number="row.correct" data-field="correct" aria-label="정답">
            <option :value="null">정답 선택</option>
            <option v-for="n in choices" :key="n" :value="n">
              {{ n }}. {{ row[`choice${n}`] || '선택지 입력 필요' }}
            </option></select
          ><CatalogFieldErrors :issues="issues" field="correct" /></label
      ></template>
      <template v-else
        ><label class="field"
          >모범답안<textarea
            v-model="content.modelAnswer"
            data-field="modelAnswer"
            rows="4" /><CatalogFieldErrors :issues="issues" field="modelAnswer" /></label
        ><label class="field"
          >채점 기준<textarea
            v-model="content.rubric"
            data-field="rubric"
            rows="4" /><CatalogFieldErrors :issues="issues" field="rubric" /></label
      ></template>
    </template>
    <template v-if="table === 'practical'"
      ><label class="field"
        >관찰·판정 기준<textarea
          v-model="content.criterion"
          data-field="criterion"
          rows="4" /><CatalogFieldErrors :issues="issues" field="criterion" /></label
      ><label class="field"
        >필수 여부<select v-model="row.mandatory" data-field="mandatory" aria-label="필수 여부">
          <option :value="true">필수</option>
          <option :value="false">선택</option></select
        ><CatalogFieldErrors :issues="issues" field="mandatory" /></label
    ></template>
  </fieldset>
</template>
