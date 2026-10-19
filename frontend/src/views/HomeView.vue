<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import AppDialog from '../components/AppDialog.vue';
import type { Notice } from '../types';
const store = useDemo();
const notice = ref<Notice | null>(null);
const active = computed(() => store.myAssignments.filter((a) => !a.certifiedAt));
const waiting = computed(() =>
  store.ftAssignments.flatMap((a) =>
    a.enrollments.filter((e) => e.practical === 'waiting').map((e) => ({ a, e })),
  ),
);
const stats = computed(() =>
  store.actor.role === 'learner'
    ? [
        {
          label: '진행 중인 자격',
          value: active.value.length,
          icon: 'book',
          to: '/qualifications',
        },
        {
          label: '수료 과정',
          value: store.myAssignments.reduce((n, a) => n + store.completedCount(a), 0),
          icon: 'check',
          to: '/qualifications',
        },
        {
          label: '검증용 인증',
          value: store.myAssignments.filter((a) => a.certifiedAt).length,
          icon: 'award',
          to: '/qualifications?filter=certified',
        },
      ]
    : store.actor.role === 'ft'
      ? [
          { label: '평가 대기', value: waiting.value.length, icon: 'clock', to: '/evaluations' },
          {
            label: '담당 과정',
            value: store.ftAssignments.reduce((n, a) => n + a.enrollments.length, 0),
            icon: 'book',
            to: '/evaluations',
          },
          {
            label: '평가 완료 과정',
            value: store.ftAssignments.reduce(
              (n, a) =>
                n + a.enrollments.filter((e) => ['passed', 'failed'].includes(e.practical)).length,
              0,
            ),
            icon: 'check',
            to: '/evaluations?filter=done',
          },
        ]
      : store.actor.role === 'system_operator'
        ? [
            {
              label: 'Lv1 조직',
              value: store.data.organizations.filter((o) => o.level === 1).length,
              icon: 'users',
              to: '/system/organizations',
            },
            {
              label: '등록 사용자',
              value: store.data.users.length,
              icon: 'users',
              to: '/system/users',
            },
            {
              label: '진행 중인 배정',
              value: store.data.assignments.filter((a) => !a.certifiedAt && !a.excludedReason)
                .length,
              icon: 'clipboard',
              to: '/system/overview',
            },
          ]
        : [
            {
              label: '자격 초안',
              value: store.data.qualifications.filter((q) => q.status === 'draft').length,
              icon: 'file',
              to: '/admin/qualifications',
            },
            {
              label: '과정 초안',
              value: store.data.courses.filter((c) => c.status === 'draft').length,
              icon: 'book',
              to: '/admin/courses',
            },
            {
              label: '진행 중인 배정',
              value: store.data.assignments.filter((a) => !a.certifiedAt && !a.excludedReason)
                .length,
              icon: 'users',
              to: '/admin/assignments',
            },
          ],
);
</script>
<template>
  <div class="container home-page">
    <div class="page-heading home-heading">
      <div>
        <h1>{{ store.actor.name }} 님</h1>
        <p class="muted organization-path">
          {{ store.actor.organizationPath.map((p) => p.name).join(' › ') }}
        </p>
      </div>
      <span class="muted home-date">{{
        new Intl.DateTimeFormat('ko-KR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        }).format(new Date())
      }}</span>
    </div>
    <section class="stats-panel" aria-label="내 현황">
      <RouterLink v-for="stat in stats" :key="stat.label" :to="stat.to" class="stat-item"
        ><div class="stat-top">
          <span>{{ stat.label }}</span
          ><AppIcon :name="stat.icon" />
        </div>
        <div class="stat-bottom">
          <span class="stat-value">{{ stat.value.toString().padStart(2, '0') }}</span
          ><AppIcon name="diagonal" :size="18" /></div
      ></RouterLink>
    </section>
    <div class="home-columns">
      <section class="home-card">
        <div class="section-heading">
          <h2>
            {{
              store.actor.role === 'learner'
                ? '진행 중인 자격'
                : store.actor.role === 'ft'
                  ? '평가 요청'
                  : store.actor.role === 'system_operator'
                    ? '시스템 운영'
                    : '기준 관리'
            }}
          </h2>
          <RouterLink
            :to="
              store.actor.role === 'learner'
                ? '/qualifications'
                : store.actor.role === 'ft'
                  ? '/evaluations'
                  : '/admin/qualifications'
            "
            class="text-link"
            >전체 보기<AppIcon name="chevron" :size="16"
          /></RouterLink>
        </div>
        <template v-if="store.actor.role === 'learner' && active.length">
          <div class="home-current">
            <span class="small-label">필수 과정 {{ active[0]!.enrollments.length }}개</span>
            <h3>{{ store.qualification(active[0]!.qualificationId).title }}</h3>
            <div class="progress-label">
              <span>과정 수료</span
              ><span
                >{{ store.completedCount(active[0]!) }} / {{ active[0]!.enrollments.length }}</span
              >
            </div>
            <div class="progress-track">
              <span
                :style="{
                  width: `${(store.completedCount(active[0]!) / active[0]!.enrollments.length) * 100}%`,
                }"
              ></span>
            </div>
            <div class="home-card-bottom">
              <span class="muted"
                >평가 {{ store.passedCount(active[0]!) }} /
                {{ store.assessmentCount(active[0]!) }} 통과</span
              ><RouterLink :to="`/qualifications/${active[0]!.id}`" class="button primary"
                >이어서 진행<AppIcon name="arrow" :size="18"
              /></RouterLink>
            </div>
          </div>
        </template>
        <div v-else-if="store.actor.role === 'learner'" class="empty-state">
          <AppIcon name="book" :size="28" /><span>진행 중인 자격이 없습니다.</span
          ><RouterLink
            v-if="store.myAssignments.some((a) => a.certifiedAt)"
            class="button secondary"
            to="/qualifications?filter=certified"
            >인증 보기</RouterLink
          >
        </div>
        <template v-else-if="store.actor.role === 'ft'"
          ><RouterLink
            v-for="item in waiting.slice(0, 3)"
            :key="item.a.id + item.e.courseId"
            :to="`/evaluations/${item.a.id}/${item.e.courseId}`"
            class="simple-row"
            ><span
              ><strong>{{ store.username(item.a.learnerId) }}</strong
              ><small>{{ store.course(item.e.courseId).title }}</small></span
            ><AppIcon name="chevron"
          /></RouterLink>
          <div v-if="!waiting.length" class="empty-state">
            <AppIcon name="check" :size="28" /><span>대기 중인 평가가 없습니다.</span>
          </div></template
        >
        <template v-else-if="store.actor.role === 'system_operator'"
          ><RouterLink to="/system/organizations" class="simple-row"
            >조직 트리 관리<AppIcon name="chevron" /></RouterLink
          ><RouterLink to="/system/users" class="simple-row"
            >사용자 소속·역할 관리<AppIcon name="chevron" /></RouterLink
          ><RouterLink to="/system/overview" class="simple-row"
            >전체 조직 업무 조회<AppIcon name="chevron" /></RouterLink
        ></template>
        <template v-else
          ><RouterLink
            v-for="q in store.data.qualifications.filter((q) => q.status === 'draft')"
            :key="q.id"
            :to="`/admin/qualifications/${q.id}`"
            class="simple-row"
            ><span
              ><strong>{{ q.title }}</strong
              ><small>v{{ q.version }} · 초안</small></span
            ><AppIcon name="chevron" /></RouterLink
        ></template>
      </section>
      <section class="home-card notice-card">
        <div class="section-heading">
          <h2>공지사항</h2>
          <AppIcon name="notice" :size="20" />
        </div>
        <button
          v-for="n in store.notices.slice(0, 3)"
          :key="n.id"
          class="notice-row"
          @click="notice = n"
        >
          <span
            >{{ n.title }}<time>{{ n.date.replaceAll('-', '.') }}</time></span
          ><AppIcon name="chevron" :size="16" />
        </button>
        <p v-if="!store.notices.length" class="empty-state">등록된 공지가 없습니다.</p>
      </section>
    </div>
    <AppDialog :open="!!notice" :title="notice?.title || '공지사항'" @update:open="notice = null"
      ><time class="muted">{{ notice?.date }}</time>
      <p class="notice-body">{{ notice?.body }}</p></AppDialog
    >
  </div>
</template>
