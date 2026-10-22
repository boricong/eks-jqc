<script setup lang="ts">
import { useId } from 'vue';
const props = defineProps<{
  choices: string[];
  correct: number | null | undefined;
  disabled?: boolean;
  errors?: Record<string, string>;
}>();
const emit = defineEmits<{ 'update:choices': [string[]]; 'update:correct': [number | null] }>();
const name = useId();
function remove(index: number) {
  emit(
    'update:choices',
    props.choices.filter((_, i) => i !== index),
  );
  emit(
    'update:correct',
    props.correct == null || props.correct === index
      ? null
      : props.correct > index
        ? props.correct - 1
        : props.correct,
  );
}
function update(index: number, value: string) {
  emit(
    'update:choices',
    props.choices.map((v, i) => (i === index ? value : v)),
  );
}
</script>
<template>
  <fieldset class="objective-choices" :disabled="disabled">
    <legend>선택지 · 정답 선택</legend>
    <p class="muted choice-help">
      정답인 선택지의 원을 선택하세요. 현재
      {{ correct == null ? '정답 미선택' : `${correct + 1}번이 정답` }}입니다.
    </p>
    <div
      v-for="(choice, index) in choices"
      :key="index"
      class="objective-choice"
      :class="{ 'is-correct': correct === index }"
    >
      <label class="choice-radio"
        ><input
          type="radio"
          :name="name"
          :checked="correct === index"
          :data-field="index === 0 ? 'correct' : undefined"
          :aria-label="`${index + 1}번 선택지를 정답으로 지정`"
          :aria-invalid="!!errors?.correct"
          :aria-describedby="errors?.correct ? `${name}-correct-error` : undefined"
          @change="emit('update:correct', index)"
        /><span class="choice-number">{{ index + 1 }}</span
        ><small class="choice-status" :class="{ 'is-visible': correct === index }"
          >정답</small
        ></label
      >
      <div class="choice-content">
        <textarea
          :value="choice"
          :aria-label="`${index + 1}번 선택지`"
          :data-field="`choice${index + 1}`"
          rows="2"
          :aria-invalid="!!errors?.[`choice${index + 1}`]"
          :aria-describedby="
            errors?.[`choice${index + 1}`] ? `${name}-choice-${index}-error` : undefined
          "
          @input="update(index, ($event.target as HTMLTextAreaElement).value)"
        />
      </div>
      <button
        v-if="!disabled"
        type="button"
        class="icon-button"
        :aria-label="`${index + 1}번 선택지 삭제`"
        @click="remove(index)"
      >
        ×
      </button>
      <p
        v-if="errors?.[`choice${index + 1}`]"
        :id="`${name}-choice-${index}-error`"
        class="field-error choice-error"
      >
        {{ errors[`choice${index + 1}`] }}
      </p>
    </div>
    <p v-if="errors?.correct" :id="`${name}-correct-error`" class="field-error">
      {{ errors.correct }}
    </p>
    <p v-if="errors?.choices" :id="`${name}-choices-error`" class="field-error">
      {{ errors.choices }}
    </p>
    <button
      v-if="!disabled"
      type="button"
      class="text-link"
      :disabled="choices.length >= 50"
      data-field="choices"
      :aria-describedby="errors?.choices ? `${name}-choices-error` : undefined"
      @click="emit('update:choices', [...choices, ''])"
    >
      선택지 추가
    </button>
  </fieldset>
</template>
