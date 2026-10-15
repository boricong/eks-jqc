import { createRouter, createWebHistory } from 'vue-router';
import { useDemo } from './stores/demo';
import HomeView from './views/HomeView.vue';
import QualificationsView from './views/QualificationsView.vue';
import QualificationView from './views/QualificationView.vue';
import AssessmentView from './views/AssessmentView.vue';
import EvaluationsView from './views/EvaluationsView.vue';
import CertificateView from './views/CertificateView.vue';
import AdminView from './views/AdminView.vue';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, saved) {
    if (to.path === from.path) return;
    return saved || { top: 0 };
  },
  routes: [
    { path: '/', name: 'home', component: HomeView },
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
      meta: { role: 'learner' },
    },
    {
      path: '/qualifications/:id/courses/:courseId/:kind(objective|practical)',
      name: 'assessment',
      component: AssessmentView,
      meta: { role: 'learner' },
    },
    { path: '/certifications/:id', name: 'certificate', component: CertificateView },
    { path: '/evaluations', name: 'evaluations', component: EvaluationsView, meta: { role: 'ft' } },
    {
      path: '/evaluations/:id/:courseId',
      name: 'evaluation',
      component: AssessmentView,
      meta: { role: 'ft' },
    },
    { path: '/admin', redirect: '/admin/qualifications' },
    {
      path: '/admin/:section(qualifications|courses|assignments|results|comparisons|notices)/:id?',
      name: 'admin',
      component: AdminView,
      meta: { role: 'admin' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
router.beforeEach(async (to) => {
  const store = useDemo();
  await store.initialize();
  if (
    (!store.signedIn ||
      (to.meta.role && !store.hasRole(to.meta.role as 'learner' | 'ft' | 'admin'))) &&
    to.path !== '/'
  )
    return '/';
  if (store.signedIn)
    try {
      await store.refresh();
    } catch (error) {
      store.notify((error as Error).message);
    }
});
router.afterEach((to, from) => {
  if (to.path === from.path) return;
  requestAnimationFrame(() => {
    const main = document.querySelector<HTMLElement>('#main');
    main?.focus({ preventScroll: true });
  });
});
