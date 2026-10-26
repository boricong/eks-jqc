import type {
  DashboardEfficacy,
  DashboardProgress,
  DashboardRenewalState,
  DashboardMetric,
} from '@eks/contracts';
import { kstDate } from '@eks/contracts';

export const dashboardTabs = [
  { id: 'summary', label: '요약' },
  { id: 'organizations', label: '조직별' },
  { id: 'qualifications', label: '자격별' },
  { id: 'members', label: '구성원별' },
  { id: 'renewals', label: '만료·재인증' },
] as const;
export type DashboardTab = (typeof dashboardTabs)[number]['id'];
export const efficacyLabels: Record<DashboardEfficacy, string> = {
  Active: 'Active · 유효',
  Hold: 'Hold · 정지',
  Revoke: 'Revoke · 폐기',
  none: '미보유',
};
export const progressLabels: Record<DashboardProgress, string> = {
  unplanned: '계획 미작성',
  draft: '계획 작성',
  learning_wait: '학습 확인 대기',
  learning_progress: '학습 확인 중',
  assessment_wait: '평가 대기',
  assessment_progress: '평가 진행',
  partial_completion: '일부 수료',
  none: '진행 없음',
};
export const renewalLabels: Record<DashboardRenewalState, string> = {
  available: '재인증 가능',
  in_progress: '재인증 진행',
  upcoming: '재인증 예정',
  scheduled: '시작 전',
  blocked: '확인 필요',
  not_applicable: '해당 없음',
};
export const metricLabels: Record<DashboardMetric, string> = {
  eligiblePeople: '대상 인원',
  uniqueActiveHolders: '유효 자격 보유 인원',
  inProgress: '취득 진행',
  incompleteRequests: '미완료 계획 요청',
  expires0to30: '30일 내 만료',
  overdueRequests: '계획 요청 기한 경과',
  overdueTargets: '자격 종료일 경과',
  excludedPeople: '집계 제외 인원',
  blockedProgress: '진행 제한',
};
export const assessmentLabels: Record<string, string> = {
  not_required: '해당 없음',
  ready: '미시작',
  draft: '진행 중',
  passed: '통과',
  failed: '미통과',
};
export const scheduleLabels = {
  request: '계획 요청 기한',
  target: '자격 종료일',
};
export const renewalBlockLabels: Record<string, string> = {
  TARGET_HOLD: '취득 대상자 Hold 해제가 필요합니다.',
  ORGANIZATION_INACTIVE: '소속 조직이 사용 중지 상태입니다.',
  CREDENTIAL_NOT_ACTIVE: '개인 자격이 Active 상태가 아닙니다.',
  VALIDITY_UNKNOWN: '인증 유효기간 확인이 필요합니다.',
  NOT_REGISTERED: '현재 현재 팀 기준 자격이 없습니다.',
  CRITERIA_UNAVAILABLE: '팀 자격 기준의 운영 상태 또는 설정을 확인해 주세요.',
  CREDENTIAL_HOLD: '개인 자격 Hold의 확인이 필요합니다.',
  DRAFT_VERSION_CHANGED:
    '현재 팀 기준 버전이 변경되었습니다. 현재 버전으로 계획을 다시 작성해 주세요.',
  REQUEST_REQUIRED: '현재 소속의 계획 수립 요청이 필요합니다.',
};
export function displayDate(value?: string) {
  return value ? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : kstDate(value)) : '—';
}
export function displayTime(value?: string) {
  return value
    ? new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '';
}
