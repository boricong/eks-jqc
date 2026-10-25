import type { QualificationType } from '@eks/contracts';
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
  type: QualificationType = 'auditee',
): RouteLocationRaw {
  return {
    path: assignmentId ? `/qualifications/${assignmentId}` : '/qualifications',
    query: {
      ...(type === 'auditor' ? { type } : {}),
      ...(stage === 'assessment' ? { stage } : {}),
      ...(courseId ? { course: courseId } : {}),
    },
  };
}

export function learnerNavigationItems(
  assignmentId?: string,
  courseId?: string,
  type: QualificationType = 'auditee',
) {
  return [
    { path: type === 'auditor' ? '/plans?type=auditor' : '/plans', label: '내 계획', key: 'plans' },
    {
      path: qualificationLocation(
        'learning',
        assignmentId,
        assignmentId ? courseId : undefined,
        type,
      ),
      label: '학습',
      key: 'learning',
    },
    {
      path: qualificationLocation('assessment', assignmentId, assignmentId ? courseId : undefined),
      label: '평가',
      key: 'assessment',
    },
  ].filter((item) => type === 'auditee' || item.key !== 'assessment');
}

// URL hints choose a presentation context; ownership and roles remain authoritative.
export const ownedQualificationsLocation = '/qualifications?filter=certified';
export const ownedQualificationsForType = (type: QualificationType) =>
  ownedQualificationsLocation + (type === 'auditor' ? '&type=auditor' : '');
type NavigationActor = { id: string; roles: readonly string[] };
type OwnedRecord = { learnerId: string; certifiedAt?: string } | undefined;
type NavigationRoute = Pick<RouteLocationNormalizedLoaded, 'name' | 'path' | 'query'>;
export function isOwnedQualificationsRoute(route: Pick<NavigationRoute, 'name' | 'query'>) {
  return route.name === 'qualifications' && route.query.filter === 'certified';
}
export function ownedCertificateLocation(
  id: string,
  type: QualificationType = 'auditee',
): RouteLocationRaw {
  return {
    path: `/certifications/${id}`,
    query: { from: 'owned', ...(type === 'auditor' ? { type } : {}) },
  };
}
export function isOwnedRecordContext(
  route: Pick<NavigationRoute, 'query'>,
  record: OwnedRecord,
  actor: NavigationActor,
) {
  return (
    route.query.from === 'owned' &&
    !route.query.lv1OrganizationId &&
    !!record?.certifiedAt &&
    record.learnerId === actor.id
  );
}
export function documentContextQuery(
  route: Pick<NavigationRoute, 'query'>,
  record: OwnedRecord,
  actor: NavigationActor,
  type: QualificationType = 'auditee',
) {
  if (route.query.lv1OrganizationId) return { lv1OrganizationId: route.query.lv1OrganizationId };
  return isOwnedRecordContext(route, record, actor)
    ? { from: 'owned', ...(type === 'auditor' ? { type } : {}) }
    : {};
}
export function primaryNavigationSection(
  route: NavigationRoute,
  actor: NavigationActor,
  record?: OwnedRecord,
  personalAccess = false,
) {
  const learner =
    personalAccess ||
    actor.roles.includes('learner') ||
    actor.roles.includes('evaluator') ||
    (!!record && record.learnerId === actor.id);
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
