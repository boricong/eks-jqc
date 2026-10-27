export const systemSections = [
  { id: 'qualification-templates', name: '기본자격 관리' },
  { id: 'common-courses', name: '공통인증Set 관리' },
  { id: 'organizations', name: '조직 관리' },
  { id: 'users', name: '사용자 관리' },
  { id: 'overview', name: '전체 업무 조회' },
  { id: 'notices', name: '시스템 공지 관리' },
  { id: 'documents', name: '문서 조회' },
].map((section) => ({ ...section, path: `/system/${section.id}` }));
