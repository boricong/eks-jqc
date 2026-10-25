// Presentation metadata only. Authorization remains in store.canManageSection.
export const managementGroups = [
  { id: 'overview', name: '현황 조회' },
  { id: 'operations', name: '인증 운영' },
  { id: 'criteria', name: '자격 기준 설정' },
  { id: 'communication', name: '팀 소통' },
] as const;

export const managementSections = [
  { id: 'dashboard', group: 'overview', name: '인증 현황', icon: 'chart' },
  { id: 'targets', group: 'operations', name: '취득 대상자 상태', icon: 'users' },
  { id: 'assignments', group: 'operations', name: '계획 요청·진행', icon: 'list' },
  { id: 'results', group: 'operations', name: '평가·수료 결과', icon: 'clipboard' },
  { id: 'credentials', group: 'operations', name: '보유 자격 관리', icon: 'award' },
  { id: 'qualifications', group: 'criteria', name: '팀 자격 설정', icon: 'award' },
  { id: 'policies', group: 'criteria', name: '조직 필수 자격 설정', icon: 'users' },
  { id: 'courses', group: 'criteria', name: '인증Set 설정', icon: 'book' },
  { id: 'catalog', group: 'criteria', name: '기준 일괄 편집', icon: 'file' },
  { id: 'notices', group: 'communication', name: '팀 공지 관리', icon: 'notice' },
].map((section) => ({ ...section, path: `/admin/${section.id}` }));

export function managementTitle(id: string) {
  return managementSections.find((section) => section.id === id)?.name || '인증 업무 관리';
}

export function visibleManagementGroups(canManage: (section: string) => boolean) {
  return managementGroups
    .map((group) => ({
      ...group,
      sections: managementSections.filter(
        (section) => section.group === group.id && canManage(section.id),
      ),
    }))
    .filter((group) => group.sections.length);
}
