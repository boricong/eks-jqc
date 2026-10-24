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
