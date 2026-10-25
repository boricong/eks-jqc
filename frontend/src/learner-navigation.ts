import type { RouteLocationNormalizedLoaded, RouteLocationRaw } from 'vue-router';
export type LearningStage = 'learning' | 'assessment';
export function learningStage(
  route: Pick<RouteLocationNormalizedLoaded, 'name' | 'query'>,
): LearningStage {
  return route.name === 'assessment' || route.query.stage === 'assessment'
    ? 'assessment'
    : 'learning';
}
export function qualificationLocation(
  stage: LearningStage,
  assignmentId?: string,
  courseId?: string,
): RouteLocationRaw {
  return {
    path: assignmentId ? `/qualifications/${assignmentId}` : '/qualifications',
    query: {
      ...(stage === 'assessment' ? { stage } : {}),
      ...(courseId ? { course: courseId } : {}),
    },
  };
}

export function learnerNavigationItems(assignmentId?: string, courseId?: string) {
  return [
    { path: '/plans', label: '내 계획', key: 'plans' },
    {
      path: qualificationLocation('learning', assignmentId, assignmentId ? courseId : undefined),
      label: '학습',
      key: 'learning',
    },
    {
      path: qualificationLocation('assessment', assignmentId, assignmentId ? courseId : undefined),
      label: '평가',
      key: 'assessment',
    },
  ];
}

// URL hints choose a presentation context; ownership and roles remain authoritative.
export const ownedQualificationsLocation = '/qualifications?filter=certified';
type NavigationActor = { id: string; roles: readonly string[] };
type OwnedRecord = { learnerId: string; certifiedAt?: string } | undefined;
type NavigationRoute = Pick<RouteLocationNormalizedLoaded, 'name' | 'path' | 'query'>;
export function isOwnedQualificationsRoute(route: Pick<NavigationRoute, 'name' | 'query'>) {
  return route.name === 'qualifications' && route.query.filter === 'certified';
}
export function ownedCertificateLocation(id: string): RouteLocationRaw {
  return { path: `/certifications/${id}`, query: { from: 'owned' } };
}
export function isOwnedRecordContext(
  route: Pick<NavigationRoute, 'query'>,
  record: OwnedRecord,
  actor: NavigationActor,
) {
  return (
    route.query.from === 'owned' &&
    !route.query.lv1OrganizationId &&
    actor.roles.includes('learner') &&
    !!record?.certifiedAt &&
    record.learnerId === actor.id
  );
}
export function documentContextQuery(
  route: Pick<NavigationRoute, 'query'>,
  record: OwnedRecord,
  actor: NavigationActor,
) {
  if (route.query.lv1OrganizationId) return { lv1OrganizationId: route.query.lv1OrganizationId };
  return isOwnedRecordContext(route, record, actor) ? { from: 'owned' } : {};
}
export function primaryNavigationSection(
  route: NavigationRoute,
  actor: NavigationActor,
  record?: OwnedRecord,
) {
  const learner = actor.roles.includes('learner');
  const operator = actor.roles.includes('system_operator');
  const admin = actor.roles.includes('admin');
  if (route.name === 'home') return 'home';
  if (route.path === '/notifications') return 'notifications';
  if (route.path.startsWith('/admin')) return 'management';
  if (route.path.startsWith('/system')) return 'system';
  if (isOwnedQualificationsRoute(route)) return learner ? 'owned' : '';
  if (['certificate', 'completion'].includes(String(route.name))) {
    if (isOwnedRecordContext(route, record, actor)) return 'owned';
    if (
      route.query.lv1OrganizationId &&
      (admin || operator || actor.roles.includes('organization_admin'))
    )
      return 'management';
    if (route.name === 'certificate') {
      if (operator) return 'system';
      if (admin) return 'management';
      return learner && record?.learnerId === actor.id && record.certifiedAt ? 'owned' : '';
    }
    if (record?.learnerId === actor.id && learner) return 'learning';
    return operator ? 'system' : admin ? 'management' : '';
  }
  return learner && (route.path.startsWith('/qualifications') || route.path.startsWith('/plans'))
    ? 'learning'
    : '';
}
