<script setup lang="ts">
import { computed } from 'vue';
import type { DashboardChart, DashboardChartSelection } from '@eks/contracts';
const props = defineProps<{
  chart: DashboardChart;
  table?: boolean;
  start?: number;
  limit?: number;
  disabled?: boolean;
}>();
const emit = defineEmits<{ select: [DashboardChartSelection] }>();
const units = {
  people: '명',
  person_qualification: '사람·자격',
  credentials: '인증',
  requests: '요청',
  enrollments: '인증Set 수강',
};
const unit = computed(() => units[props.chart.unit]);
const groups = computed(() =>
  props.chart.comparison
    ? props.chart.groups.slice(props.start || 0, (props.start || 0) + (props.limit || 8))
    : props.chart.groups,
);
const group = computed(() => groups.value[0]);
const values = computed(() => group.value?.values || []);
const total = computed(() => values.value.reduce((a, b) => a + b, 0));
const max = computed(() =>
  Math.max(
    1,
    ...props.chart.groups.flatMap((g) =>
      props.chart.kind === 'stacked' ? [g.values.reduce((a, b) => a + b, 0)] : g.values,
    ),
  ),
);
const allZero = computed(() => !props.chart.groups.some((g) => g.values.some(Boolean)));
const selection = (key: string, index: number) => {
  if (props.disabled) return;
  emit('select', {
    chartId: props.chart.id,
    groupKey: key,
    seriesKey: props.chart.series[index]!.key,
  });
};
const count = (value: number) => value.toLocaleString('ko-KR');
const description = (key: string, label: string, value: number) =>
  (props.chart.comparison ? key + ' · ' : '') +
  label +
  ' ' +
  count(value) +
  ' ' +
  unit.value +
  ' 명세 보기';
const length = 2 * Math.PI * 60;
function offset(index: number) {
  return (-values.value.slice(0, index).reduce((a, b) => a + b, 0) / total.value) * length;
}
</script>
<template>
  <div class="dashboard-chart-plot">
    <p class="chart-unit">
      단위: {{ unit }}<template v-if="chart.percentage"> · 충족 / 전체 필수</template>
    </p>
    <div
      v-if="table"
      class="dashboard-table-wrap"
      tabindex="0"
      role="region"
      :aria-label="chart.title + ' 데이터 표'"
    >
      <table class="dashboard-table chart-data-table">
        <thead>
          <tr>
            <th scope="col">{{ chart.comparison ? '항목' : '분류' }}</th>
            <th v-for="s in chart.series" :key="s.key" scope="col">{{ s.label }}</th>
            <th v-if="chart.percentage" scope="col">필수 충족률</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in groups" :key="g.key">
            <th scope="row">{{ g.label }}</th>
            <td v-for="(s, i) in chart.series" :key="s.key">
              <button
                class="dashboard-link"
                :disabled="!g.values[i] || disabled"
                :aria-label="description(g.label, s.label, g.values[i]!)"
                @click="selection(g.key, i)"
              >
                {{ count(g.values[i]!) }}
              </button>
            </td>
            <td v-if="chart.percentage">
              {{
                g.denominator
                  ? ((g.values[0]! / g.denominator) * 100).toFixed(1) + '%'
                  : '— · 필수 자격 없음'
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <template v-else-if="chart.kind === 'donut'">
      <div class="chart-donut-layout">
        <svg class="chart-donut" viewBox="0 0 180 180" role="group" :aria-label="chart.title">
          <circle
            cx="90"
            cy="90"
            r="60"
            fill="none"
            stroke="var(--progress-track)"
            stroke-width="24"
            aria-hidden="true"
          />
          <template v-if="total">
            <circle
              v-for="(s, i) in chart.series"
              :key="s.key"
              cx="90"
              cy="90"
              r="60"
              fill="none"
              stroke-width="24"
              :class="'chart-stroke-' + s.tone"
              :stroke-dasharray="(values[i]! / total) * length + ' ' + length"
              :stroke-dashoffset="offset(i)"
              transform="rotate(-90 90 90)"
              role="button"
              :tabindex="values[i] && !disabled ? 0 : -1"
              :aria-disabled="!values[i] || disabled"
              :aria-label="description('', s.label, values[i]!)"
              @click="values[i] && selection(group!.key, i)"
              @keydown.enter.prevent="values[i] && selection(group!.key, i)"
              @keydown.space.prevent="values[i] && selection(group!.key, i)"
            >
              <title>{{ s.label }} {{ count(values[i]!) }} {{ unit }}</title>
            </circle>
          </template>
          <text x="90" y="87" text-anchor="middle" class="chart-donut-total">
            {{ total ? count(total) : '—' }}
          </text>
          <text x="90" y="108" text-anchor="middle" class="chart-donut-unit">{{ unit }}</text>
        </svg>
        <ul class="chart-value-legend">
          <li v-for="(s, i) in chart.series" :key="s.key">
            <button
              :disabled="!values[i] || disabled"
              :aria-label="description('', s.label, values[i] || 0)"
              @click="selection(group!.key, i)"
            >
              <span class="chart-swatch" :class="'chart-fill-' + s.tone" aria-hidden="true"></span
              ><span>{{ s.label }}</span
              ><strong>{{ count(values[i] || 0) }}</strong>
              <small v-if="total">{{ ((values[i]! / total) * 100).toFixed(1) }}%</small>
            </button>
          </li>
        </ul>
      </div>
    </template>
    <template v-else-if="chart.kind === 'bar'">
      <ul class="chart-distribution">
        <li v-for="(s, i) in chart.series" :key="s.key">
          <button
            :disabled="!values[i] || disabled"
            :aria-label="description('', s.label, values[i] || 0)"
            @click="selection(group!.key, i)"
          >
            <span class="chart-category">{{ s.label }}</span
            ><span class="chart-bar-track"
              ><span
                :class="'chart-fill-' + s.tone"
                :style="{ width: ((values[i] || 0) / max) * 100 + '%' }"
              ></span
            ></span>
            <strong>{{ count(values[i] || 0) }}</strong>
          </button>
        </li>
      </ul>
    </template>
    <template v-else>
      <div class="chart-series-legend" aria-label="차트 범례">
        <span v-for="s in chart.series" :key="s.key"
          ><i class="chart-swatch" :class="'chart-fill-' + s.tone" aria-hidden="true"></i
          >{{ s.label }}</span
        >
      </div>
      <ol class="chart-comparison">
        <li v-for="g in groups" :key="g.key">
          <div class="chart-group-heading">
            <strong>{{ g.label }}</strong
            ><span v-if="chart.percentage">{{
              g.denominator
                ? ((g.values[0]! / g.denominator) * 100).toFixed(1) +
                  '% · ' +
                  count(g.values[0]!) +
                  ' / ' +
                  count(g.denominator)
                : '— · 필수 자격 없음'
            }}</span>
          </div>
          <div :class="chart.kind === 'grouped' ? 'chart-grouped-bars' : 'chart-stacked-bar'">
            <template v-for="(s, i) in chart.series" :key="s.key">
              <button
                v-if="g.values[i] || chart.kind === 'grouped'"
                :disabled="!g.values[i] || disabled"
                :class="'chart-fill-' + s.tone"
                :style="{
                  width: (g.values[i]! / (chart.percentage ? g.denominator || 1 : max)) * 100 + '%',
                }"
                :aria-label="description(g.label, s.label, g.values[i]!)"
                :title="s.label + ' ' + count(g.values[i]!)"
                @click="selection(g.key, i)"
              ></button>
            </template>
          </div>
          <div class="chart-group-values">
            <button
              v-for="(s, i) in chart.series"
              :key="s.key"
              :disabled="!g.values[i] || disabled"
              :aria-label="description(g.label, s.label, g.values[i]!)"
              @click="selection(g.key, i)"
            >
              <i class="chart-swatch" :class="'chart-fill-' + s.tone" aria-hidden="true"></i
              >{{ s.label }} <strong>{{ count(g.values[i]!) }}</strong>
            </button>
          </div>
        </li>
      </ol>
    </template>
    <p v-if="allZero" class="chart-empty" role="status">{{ chart.emptyLabel }}</p>
  </div>
</template>
