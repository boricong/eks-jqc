import { learningStage, isOwnedQualificationsRoute } from './learner-navigation';
import { createRouter, createWebHistory } from 'vue-router';
import { useDemo } from './stores/demo';
import HomeView from './views/HomeView.vue';
import QualificationsView from './views/QualificationsView.vue';
import QualificationView from './views/QualificationView.vue';
import AssessmentView from './views/AssessmentView.vue';
import EvaluationsView from './views/EvaluationsView.vue';
import CertificateView from './views/CertificateView.vue';
import AdminView from './views/AdminView.vue';
import AdminLayout from './components/AdminLayout.vue';
import SystemView from './views/SystemView.vue';
import PlansView from './views/PlansView.vue';
import SubjectiveView from './views/SubjectiveView.vue';
import CompletionView from './views/CompletionView.vue';
import NotificationsView from './views/NotificationsView.vue';
import type { Role } from '@eks/contracts';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, saved) {
    if (
      to.path === from.path &&
      isOwnedQualificationsRoute(to) === isOwnedQualificationsRoute(from)
    )
      return;
    return saved || { top: 0 };
  },
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/plans/:id?', name: 'plans', component: PlansView, meta: { role: 'learner' } },
    { path: '/notifications', name: 'notifications', component: NotificationsView },
    { path: '/completions/:id', name: 'completion', component: CompletionView },
    {
      path: '/qualifications/:id/courses/:courseId/subjective',
      name: 'subjective',
      component: SubjectiveView,
      meta: { role: 'learner' },
    },
    {
      path: '/evaluations/:id/:courseId/subjective',
      name: 'subjective-evaluation',
      component: SubjectiveView,
      meta: {},
    },
    {
      path: '/qualifications',
      name: 'qualifications',
      component: QualificationsView,
      meta: { role: 'learner' },
    },
    {
      path: '/qualifications/:id',
      name: 'qualification',
      component: QualificationView,
      meta: { role: 'learner', title: '자격 상세' },
    },
    {
      path: '/qualifications/:id/courses/:courseId/:kind(objective|practical)',
      name: 'assessment',
      component: AssessmentView,
      meta: { role: 'learner' },
    },
    { path: '/certifications/:id', name: 'certificate', component: CertificateView },
    { path: '/evaluations', name: 'evaluations', component: EvaluationsView, meta: {} },
    {
      path: '/evaluations/:id/:courseId',
      name: 'evaluation',
      component: EvaluationsView,
      meta: {},
    },
    {
      path: '/admin',
      component: AdminLayout,
      meta: { management: true },
      children: [
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('./views/DashboardView.vue'),
          meta: { management: true, managementSection: 'dashboard', title: '인증 현황' },
        },
        {
          path: 'catalog',
          name: 'catalog',
          component: () => import('./views/CatalogView.vue'),
          meta: { management: true, managementSection: 'catalog' },
        },
        {
          path: ':section(policies|targets|credentials|qualifications|courses|assignments|results|notices)/:id?',
          name: 'admin',
          component: AdminView,
          meta: { management: true },
        },
      ],
    },
    // Retired feature links keep their team context and return to the dashboard.
    {
      path: '/admin/comparisons/:id?',
      redirect: (to) => ({ path: '/admin/dashboard', query: to.query }),
    },
    { path: '/system', redirect: '/system/organizations' },
    {
      path: '/system/:section(organizations|users|overview|testing|notices|qualification-templates)',
      component: SystemView,
      meta: { role: 'system_operator' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
router.beforeEach(async (to) => {
  const store = useDemo();
  await store.initialize();
  if (
    (!store.signedIn ||
      (to.meta.management && !store.canEnterManagement) ||
      (to.meta.role && !store.hasRole(to.meta.role as Role))) &&
    to.path !== '/'
  )
    return '/';
  if (
    to.meta.management &&
    store.canEnterManagement &&
    (to.path === '/admin' ||
      !store.canManageSection(String(to.meta.managementSection || to.params.section)))
  )
    return {
      path: '/admin/dashboard',
      query: to.query,
    };
  const managed =
    !!to.meta.management ||
    (['certificate', 'completion'].includes(String(to.name)) &&
      store.canEnterManagement &&
      !!to.query.lv1OrganizationId);
  if (
    managed &&
    store.hasRole('system_operator') &&
    to.query.lv1OrganizationId === undefined &&
    store.rememberedManagement()
  )
    return {
      ...to,
      query: { ...to.query, lv1OrganizationId: store.rememberedManagement() },
      replace: true,
    };
});
// Resolve the new workspace only AFTER component leave/update guards have
// accepted navigation, so a scope change cannot unmount an unsaved editor.
router.beforeResolve(async (to) => {
  const store = useDemo();
  const managed =
    !!to.meta.management ||
    (['certificate', 'completion'].includes(String(to.name)) &&
      store.canEnterManagement &&
      !!to.query.lv1OrganizationId);
  const lv1 = managed
    ? typeof to.query.lv1OrganizationId === 'string'
      ? to.query.lv1OrganizationId
      : store.hasRole('system_operator')
        ? ''
        : store.actor.lv1OrganizationId
    : '';
  const previous = store.workspaceScope;
  if (previous !== lv1) {
    if (store.writing) {
      store.notify('저장이 끝난 뒤 조직을 전환해 주세요.');
      return false;
    }
    store.contextLoading = true;
    store.workspaceScope = lv1;
  }
  if (store.signedIn)
    try {
      await store.refresh();
      if (
        (to.meta.management &&
          !store.canManageSection(String(to.meta.managementSection || to.params.section))) ||
        (to.meta.role && !store.hasRole(to.meta.role as Role))
      )
        return '/';
      if (managed && store.hasRole('system_operator')) store.rememberManagement(lv1);
    } catch (error) {
      store.workspaceScope = previous;
      store.notify((error as Error).message);
      return false;
    }
});
router.afterEach((to, from, failure) => {
  useDemo().contextLoading = false;
  if (failure) return;
  const learnerTitle = ['qualification', 'qualifications', 'assessment'].includes(String(to.name))
    ? to.query.filter === 'certified'
      ? '보유 자격'
      : learningStage(to) === 'assessment'
        ? '자격 평가'
        : '자격 학습'
    : undefined;
  document.title = learnerTitle
    ? `${learnerTitle} · EKS 직무자격인증`
    : to.meta.title
      ? `${to.meta.title} · EKS 직무자격인증`
      : 'EKS 직무자격인증';
  if (to.path === from.path && isOwnedQualificationsRoute(to) === isOwnedQualificationsRoute(from))
    return;
  requestAnimationFrame(() => {
    const main = document.querySelector<HTMLElement>('#main');
    main?.focus({ preventScroll: true });
  });
});
