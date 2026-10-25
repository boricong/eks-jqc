<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { recordQualificationType } from '@eks/contracts';
import AppIcon from './AppIcon.vue';
import { managementTitle } from '../management-navigation';
import { learningStage } from '../learner-navigation';
import { useDemo } from '../stores/demo';
import { processContext } from '../composables/useProcessContext';
const route = useRoute(),
  store = useDemo();
const expanded = ref(false);
const auditor = computed(() => {
  const name = String(route.name);
  if (name === 'home') return processContext.value.state === 'home-evaluator';
  if (
    name === 'qualifications' &&
    route.query.filter !== 'certified' &&
    learningStage(route) === 'assessment'
  )
    return false;
  if (name === 'plans') {
    const plan = store.data.plans.find((p) => p.id === route.params.id);
    if (plan) return store.qualificationFor(plan).qualificationType === 'auditor';
    const request = store.data.planningRequests.find((r) => r.id === route.query.request);
    if (request) return request.qualificationType === 'auditor';
  }
  if (['qualification', 'assessment', 'certificate', 'completion'].includes(name)) {
    const assignment = store.data.assignments.find((a) =>
      name === 'completion'
        ? a.enrollments.some((e) => e.completion?.id === route.params.id)
        : a.id === route.params.id,
    );
    if (assignment)
      return (
        recordQualificationType(store.qualification(assignment.qualificationId), assignment) ===
        'auditor'
      );
  }
  if (name === 'admin' && route.params.id) {
    const item = (
      route.params.section === 'courses' ? store.data.courses : store.data.qualifications
    ).find((q) => q.id === route.params.id);
    if (item) return item.qualificationType === 'auditor';
  }
  if (route.query.type === 'auditor') return true;
  return (
    ['plans', 'qualifications'].includes(name) &&
    route.query.filter !== 'certified' &&
    !store.personalTypes.includes('auditee')
  );
});
const personal = computed(
  () =>
    [
      'plans',
      'qualification',
      'qualifications',
      'assessment',
      'certificate',
      'completion',
    ].includes(String(route.name)) ||
    ['home-learner', 'home-evaluator'].includes(processContext.value.state),
);
const steps = computed(() =>
  !personal.value
    ? [
        '조직·유형 준비',
        '필수 기준·계획 요청',
        '개인 계획',
        '유형별 학습',
        '평가 또는 본인 확인 수료',
        '보유 인증·현재 효력',
      ]
    : auditor.value
      ? [
          '조직·기준 준비',
          '평가자 계획 요청',
          '개인 계획',
          '학습·본인 확인',
          '인증Set 수료',
          'Auditor 인증',
        ]
      : [
          '조직·기준 준비',
          '학습자 계획 요청',
          '개인 계획',
          '학습 안내',
          '평가·수료',
          'Auditee 인증·유효기간',
        ],
);
type Guide = {
  step: number;
  title: string;
  purpose: string;
  action: string;
  next: string;
  limits: string[];
  suggestion: string;
};
const guide = computed<Guide>(() => {
  const name = String(route.name),
    section = String(route.params.section || ''),
    state = processContext.value.state,
    typeName = auditor.value ? 'Auditor' : 'Auditee';
  const item = (
    step: number,
    title: string,
    purpose: string,
    action: string,
    next: string,
    limits: string[],
    suggestion: string,
  ) => ({ step, title, purpose, action, next, limits, suggestion });
  if (!store.signedIn)
    return item(
      0,
      '계정 접속',
      '상단 계정 선택기로 검증에 사용할 사용자와 역할을 확인하는 단계입니다.',
      '계정을 선택하고 이름·소속을 확인합니다. 연결에 실패하면 다시 연결한 뒤 접속합니다.',
      '보유 역할에 따라 학습자 인증·평가자 인증·팀 관리·조직 관리·시스템 운영 홈을 이용합니다.',
      [
        '계정 선택은 사내 로그인 인증을 대신하는 MVP 기능입니다. 평가자 역할은 타인 채점·승인 권한을 의미하지 않습니다.',
      ],
      '실제 운영 전 사내 인증, 사용자 등록과 역할 부여 절차를 확정해 주세요.',
    );
  if (name === 'home')
    return item(
      personal.value ? 2 : 0,
      '역할별 업무 확인',
      personal.value
        ? `${typeName} 유형의 본인 계획 요청·진행 자격·수료 및 유효 인증 현황을 확인하는 단계입니다.`
        : '선택한 관리 역할의 범위와 주요 현황, 관리 화면 바로가기를 확인하는 단계입니다.',
      '홈 역할 탭에서 학습자 인증·평가자 인증·팀 관리·조직 관리·시스템 운영을 선택합니다. 오른쪽 최근 알림은 본인에게 제공된 최신 4개이며 시스템·팀 공지는 하단에서 확인합니다.',
      personal.value
        ? auditor.value
          ? '요청받은 계획을 확정한 뒤 학습범위의 필수 항목을 본인이 확인합니다. 모든 필수 인증Set 수료 시 Auditor 인증이 발급됩니다.'
          : '계획을 확정하면 학습자료를 확인하고 평가 탭에서 응시합니다. 요청 전체 완료 확인은 내 계획에서 별도로 진행합니다.'
        : '팀 관리는 Lv1 전체, 조직 관리는 담당 조직의 직속 인원을 확인합니다. 상세 업무는 해당 관리 화면에서 처리합니다.',
      [
        '홈 역할 선택은 권한·관리 조직을 바꾸지 않으며 사용자별 현재 브라우저 탭에서 기억합니다.',
        '계획 작성이 끝나 홈 카드가 사라져도 요청 전체 완료 기록은 자동 생성되지 않습니다. 홈 알림 미리보기는 읽음 처리하지 않습니다.',
      ],
      '선택한 역할과 집계 범위를 확인하고 개인 업무와 조직 관리 업무를 구분해 주세요.',
    );
  if (name === 'notifications')
    return item(
      1,
      '알림 확인',
      '본인에게 제공된 유형별 계획 요청·평가·수료·인증 및 기간 안내를 확인하는 단계입니다.',
      '미읽음은 펼쳐서, 읽은 알림은 접어서 시작합니다. 홈에서 선택한 알림으로 진입하면 해당 알림만 펼칩니다. 본문이 보이는 탭의 화면에 실제 표시될 때 읽음 처리됩니다.',
      '관련 업무로 이동하여 계획 작성·본인 확인·평가 또는 인증 효력 조회를 진행합니다. 읽음 실패는 해당 알림에서 재시도합니다.',
      [
        '읽음은 업무 완료가 아닙니다. 읽은 뒤에도 펼침과 현재 필터 목록을 유지하며 필터 재선택·재진입 때 최신 상태를 반영합니다.',
        '서버가 제공하는 알림 범위를 표시합니다. 신규 안내의 Auditee·Auditor 유형과 대상 업무를 구분합니다.',
      ],
      '알림의 유형과 요청 기한을 확인하고 연결된 화면에서 실제 업무 완료 여부를 확인해 주세요.',
    );
  if (name.includes('subjective') || name === 'evaluation' || name === 'evaluations')
    return item(
      4,
      '종료된 평가 기능 안내',
      '이전 FT 판정·주관식 평가 주소의 종료를 안내하는 화면입니다.',
      '안내된 홈 또는 자격 취득 경로로 이동합니다. 이 화면에는 새 결과를 저장하지 않습니다.',
      'Auditee는 지식·상황 대응 평가, Auditor는 학습범위의 본인 확인으로 진행합니다.',
      [
        '새 평가자 역할은 이전 FT 판정 기능을 다시 활성화하지 않습니다. 타인의 점수 입력·승인 절차는 제공하지 않습니다.',
      ],
      '오래된 즐겨찾기를 현재 유형별 학습·평가 화면으로 교체해 주세요.',
    );
  if (name === 'plans') {
    const titles: Record<string, string> = {
      'plan-1': '자격 선택',
      'plan-2': '일정 수립',
      'plan-3': '학습 목표(선택)',
      'plan-4': '계획 최종 확인',
      'plan-completed': '확정 계획 조회',
    };
    const actions: Record<string, string> = {
      'plan-1':
        '유형과 계획 요청을 선택하고 요청 당시 필수 자격·현재 추가 가능한 자격을 확인해 계획을 시작합니다. 자격별 계획 확정과 요청 전체의 계획 수립 완료는 별개입니다.',
      'plan-2': auditor.value
        ? '목표 인증일과 인증Set별 학습 시작·완료일을 입력합니다. 학습 시작 ≤ 학습 완료 ≤ 목표 인증일 순서를 지키고 최종 확인으로 이동합니다. 평가 예정일은 입력하지 않습니다.'
        : '목표 인증일과 인증Set별 학습 시작·완료일·평가 예정일을 입력합니다. 학습 시작 ≤ 학습 완료 ≤ 평가 예정 ≤ 목표 인증일 순서를 지키고 최종 확인으로 이동합니다.',
      'plan-3':
        '학습 목표는 선택사항입니다. 이 단계를 건너뛰거나 빈 값으로 최종 확인에 갈 수 있고 기존 목표는 보존됩니다. 입력 시 인증Set별 최대 2,000자입니다.',
      'plan-4':
        '자격 요약과 인증Set별 일정·입력한 목표를 확인합니다. 수정은 해당 입력 단계로 이동하고, 저장 상태와 오류를 확인한 뒤 계획 완료를 확정합니다.',
      'plan-completed':
        '완료된 계획의 일정·목표·요청 당시 기준을 읽기 전용으로 조회합니다. 이 화면에서는 수정·변경 저장할 수 없으며 학습으로 이동할 수 있습니다.',
    };
    return item(
      2,
      titles[state] || '내 계획',
      `${typeName} 요청에서 취득할 자격을 선택하고 개인 계획을 수립·조회하는 단계입니다. 학습 목표의 입력과 해당 단계 방문은 선택사항입니다.`,
      actions[state] || actions['plan-1']!,
      auditor.value
        ? '계획 완료로 배정이 생성되면 필수 학습항목을 본인이 확인합니다. 필요한 계획을 모두 확정한 뒤 내 계획에서 요청 전체 완료를 확인합니다.'
        : '계획 완료로 배정이 생성되면 학습·평가를 진행합니다. 필요한 계획을 모두 확정한 뒤 내 계획에서 요청 전체 완료를 확인합니다.',
      [
        '초안은 자동 저장하며 실패·충돌 시 입력을 보존하고 재시도·재확인을 제공합니다. 미완료 계획은 삭제할 수 있습니다.',
        '작성 기한과 목표 인증일은 별개입니다. 미완료 계획은 최신 기준을 확인하며 완료 시 자격 정보·팀 설정을 보존합니다. 이후 팀 설정을 수정해도 완료 계획에 보존된 기준과 기존 발급 기간은 유지됩니다.',
      ],
      '현재 소속 기준과 요청 당시 기준의 차이를 확인하고 날짜·저장 오류를 해결한 뒤 완료해 주세요.',
    );
  }
  if (name === 'qualification') {
    const assessment = !auditor.value && learningStage(route) === 'assessment';
    return item(
      assessment ? 4 : 3,
      assessment
        ? '자격 평가 · 유형 선택'
        : auditor.value
          ? 'Auditor 학습 · 본인 확인'
          : '자격 학습',
      assessment
        ? 'Auditee의 선택 인증Set에 대한 평가 상태와 응시·결과 동선을 확인하는 단계입니다.'
        : `${typeName} 확정 계획의 자격 정보·인증Set 일정·학습범위와 자료를 확인하는 단계입니다.`,
      assessment
        ? '문항 수·합격 기준·현재 상태를 확인하고 응시하기·이어쓰기·재응시 또는 결과 보기를 선택합니다. 이력은 펼쳐 조회하고 자료는 학습 탭에서 확인합니다.'
        : auditor.value
          ? '인증Set과 학습범위·학습자료 탭을 선택합니다. 학습범위에서 실제 확인한 항목을 체크하며 마지막 필수 항목을 확인하면 수료가 확정됩니다.'
          : '자격 정보는 펼쳐 조회하고 인증Set 일정을 확인합니다. 학습범위·학습자료 탭에서 내용을 읽은 뒤 평가 시작으로 같은 인증Set의 평가 선택 화면에 이동합니다.',
      auditor.value
        ? '모든 필수 인증Set을 수료하면 Auditor 자격이 자동 발급됩니다. 수료증에는 확인한 항목·본인·시각을 보존합니다.'
        : '지식 평가 통과 후 상황 대응 평가로 진행합니다. 해당 인증Set의 필수 평가를 모두 통과하면 수료되며 모든 필수 인증Set 수료 시 자격이 발급됩니다.',
      auditor.value
        ? [
            '수료 전 체크 해제는 가능하지만 수료 확정 후에는 변경할 수 없습니다. 실패·충돌은 입력과 오류를 확인한 뒤 재시도합니다.',
            '객관·상황 대응 평가나 타인 승인 단계는 없습니다. 자료 열람 자체는 수료 처리하지 않습니다. Hold·검증 제외 등의 진행 제한은 계속 적용됩니다.',
          ]
        : [
            '자료 열람·읽던 위치는 학습 완료 근거가 아닙니다. 평가 선택 화면을 보는 것만으로 응시 회차를 만들지 않습니다.',
            '계획 일정은 조회 정보이며 학습 화면에서 변경하지 않습니다. 외부 자료의 접근 권한은 해당 서비스에서 관리합니다.',
          ],
      auditor.value
        ? '본인 확인은 실제 확인한 항목에만 표시하고 현장 심사 역량의 추가 증빙은 별도 운영 기준으로 관리해 주세요.'
        : '학습자료와 기준을 확인한 뒤 평가를 시작하고 접근할 수 없는 자료는 관리자에게 알려 주세요.',
    );
  }
  if (name === 'assessment')
    return item(
      4,
      state === 'assessment-result'
        ? '자동 채점 결과'
        : state === 'assessment-review'
          ? '제출 전 답안 확인'
          : '지식·상황 대응 평가',
      'Auditee 학습자 본인이 확정된 인증Set 버전의 문항에 답하고 서버가 자동 채점하는 단계입니다.',
      state === 'assessment-result'
        ? '통과 여부·점수·합격 기준과 다음 행동을 확인합니다. 미통과는 다시 응시하고, 지식 통과 후에는 상황 대응 평가를 시작하며 자격 취득 시 인증서를 확인합니다.'
        : state === 'assessment-review'
          ? '문항 번호·상황·질문·선택 답안을 세로로 검토합니다. 답안 수정은 해당 문항으로 이동하며 돌아오면 이전 페이지·문항·읽던 위치를 복원합니다. 최종 제출 후 해당 회차의 답안은 바꿀 수 없습니다.'
          : '번호 탭으로 문항을 이동하고 상황·문항·보기를 구분해 답합니다. 답안은 자동 저장됩니다. 답안 확인에서 저장·미응답 검사를 거쳐 검토 화면으로 이동합니다.',
      '지식 통과 후 상황 대응에 응시합니다. 필요한 평가 유형을 모두 통과하면 인증Set 수료와 필요한 경우 자격 발급이 자동 처리됩니다. 통과한 다른 유형은 유지됩니다.',
      [
        '저장 실패·충돌·제출 실패 시 답안과 검토 위치를 유지하고 실행 영역에서 복구합니다. 학습 이동도 기존 저장·이탈 보호를 거칩니다.',
        '상황 대응은 선택형 평가이며 현장 수행 관찰이 아닙니다. Auditor는 이 평가를 사용하지 않습니다.',
      ],
      '문항의 타당성을 검토하고 실제 역량 증빙에 필요한 현장 수행 근거를 별도로 확보해 주세요.',
    );
  if (name === 'certificate' || name === 'completion')
    return item(
      5,
      name === 'certificate' ? `${typeName} 자격 인증서 조회` : `${typeName} 인증Set 수료증 조회`,
      '본인 또는 권한 있는 관리자가 발급 당시 보존 정보와 수료 근거, 현재 인증 효력을 구분해 확인하는 단계입니다.',
      name === 'certificate'
        ? '상단의 실제 인증번호·최초 발급 일시·기록 구분과 한글/영문 자격명·취득자·당시 소속·버전을 확인합니다. 수료 근거·취득 및 변경 이력·갱신 근거는 펼쳐 조회합니다.'
        : auditor.value
          ? '인증Set명·버전·수료일·발급번호와 수료 순간 보존된 학습항목 본인 확인 근거를 확인합니다.'
          : '인증Set명·버전·수료일·발급번호와 평가 유형·점수·회차·확정 일시를 확인합니다.',
      auditor.value
        ? '보유 자격의 Auditor 탭으로 돌아가 현재 효력을 확인합니다. Auditor 재인증 시작·완료 절차는 아직 제공하지 않습니다.'
        : '인증서 최하단에서 가능한 재인증을 시작하거나 이어갑니다. 기간 내 본인의 종합평가 완료로 현재 유효기간을 갱신하며 최초 취득 근거는 유지합니다.',
      [
        '취득 사실과 현재 효력은 다릅니다. Hold·Revoke·기간 미설정 안내를 확인하며 UUID는 기록 식별자입니다. 외부 전자서명 검증을 의미하지 않습니다.',
        auditor.value
          ? '본인 확인 근거에는 점수·평가 회차가 없습니다. 사후 기준 수정으로 발급 당시 근거를 바꾸지 않습니다.'
          : 'Auditee 재인증은 현재 실제 문항 대신 종합평가 완료 버튼으로 처리하는 MVP입니다. 기간 미설정은 무기한으로 간주하지 않습니다.',
      ],
      '고객 Audit 자료로 사용할 때 발급 당시 근거와 조회 시점의 효력을 함께 확인해 주세요.',
    );
  if (name === 'qualifications') {
    const certified = route.query.filter === 'certified',
      assessment = !certified && learningStage(route) === 'assessment';
    return item(
      certified ? 5 : assessment ? 4 : 3,
      certified ? `보유 자격 · ${typeName}` : assessment ? '평가 목록' : `${typeName} 학습 목록`,
      certified
        ? '한 사용자가 보유한 Auditee·Auditor 인증을 유형별로 분리해 조회하는 단계입니다.'
        : '현재 유형의 본인 배정과 진행 상태를 확인하는 단계입니다.',
      certified
        ? 'Auditee 인증·Auditor 인증 탭에서 자격명·최초 취득일·현재 만료일·상태를 확인합니다. 검색과 효력 필터를 사용하고 행을 선택해 인증서 상세를 엽니다.'
        : assessment
          ? 'Auditee 자격의 평가 통과 수와 남은 평가를 확인하고 자격을 선택합니다. Auditor의 본인 확인은 학습 메뉴에서 진행합니다.'
          : '진행 중·검증 제외 목록에서 자격을 선택합니다. 신규 취득은 관리자가 보낸 유형별 요청의 내 계획에서 시작합니다.',
      certified
        ? '인증서·수료증을 조회하고 돌아오면 실제 기록에 맞는 원래 유형 탭을 유지합니다.'
        : auditor.value
          ? '학습범위에서 필수 항목을 확인해 수료합니다. 평가 메뉴로 응시하지 않습니다.'
          : '학습자료를 확인하고 같은 자격·인증Set의 평가로 이동합니다.',
      [
        '유형 탭은 사용자 역할 전환이 아닙니다. 보유 건수는 검색·효력 필터 적용 전 기준입니다.',
        '현재 필수 목록에서 제외된 기존 배정도 확정 당시 기준을 보존하며 Hold·검증 제외·효력 제한은 별도로 적용됩니다.',
      ],
      '현재 진행과 보유 인증의 효력을 구분하고 필요한 자격이 없으면 관리자에게 계획 요청을 확인해 주세요.',
    );
  }
  if (name === 'dashboard')
    return item(
      5,
      '조직 인증 현황 조회',
      '팀 전체 또는 담당 조직의 직속 인원에 대한 유형별 필수 충족·계획·인증 상태를 확인하는 단계입니다.',
      '조회 조직·인증 유형·조건을 선택하고 요약 수치에서 명세로 이동합니다. 구성원·자격의 상세에서 Auditee 평가 또는 Auditor 학습 확인 수료 근거를 확인합니다.',
      '요청 이행·현재 필수 충족·인증 효력을 구분하고 변경은 해당 권한의 관리 화면에서 처리합니다.',
      [
        '필수 자격의 분모가 없으면 충족률은 해당 없음입니다. 현재 조직 기준과 요청 당시 기준은 다를 수 있습니다.',
        '대상자 Hold·자격 기준 Hold·개인 인증 Hold는 별개입니다. 조회 수치로 실제 학습 시간이나 현장 역량을 추정하지 않습니다.',
      ],
      '유형·집계 범위·제외 인원을 확인한 뒤 기한 경과와 필수 미충족을 검토해 주세요.',
    );
  if (section === 'targets')
    return item(
      1,
      managementTitle('targets'),
      '권한 있는 관리자가 담당 범위의 구성원을 취득 대상에서 Hold하거나 복귀시키는 단계입니다.',
      '대상 인원과 변경 사유를 입력하고 영향 건수를 검토한 뒤 대상 상태를 저장합니다.',
      'Hold 중 신규 취득·평가·학습 확인·재인증 등 진행이 제한됩니다. 복귀 후 소속 기준과 기한·효력을 다시 확인합니다.',
      [
        '인원 단위 Hold는 개인 인증 효력 Hold와 다르며 기존 기록은 유지합니다.',
        'Hold는 만료 시계를 멈추지 않습니다. 사용자 역할 부여·해제는 시스템 사용자 관리에서 처리합니다.',
      ],
      '조치 범위와 사유를 확인하고 복귀 시점을 관리해 주세요.',
    );
  if (section === 'policies')
    return item(
      1,
      managementTitle('policies'),
      store.fullManagement
        ? '팀 관리자 또는 운영자가 관리 범위 조직의 유형별 필수 자격과 세부 관리자를 설정하는 단계입니다.'
        : '세부 조직 관리자가 담당 조직의 필수 자격과 조직 정보를 설정하는 단계입니다.',
      '왼쪽 조직 트리에서 대상을 선택하고 Auditee·Auditor 탭에서 팀 적용된 자격을 검색·선택합니다. 조직 설정 변경 확인에서 비교 후 저장합니다. 조직 정보와 세부 관리자 지정은 해당 구역을 펼쳐 확인합니다.',
      '팀 관리자 또는 운영자가 계획 요청·진행에서 유형과 대상자를 선택해 별도로 요청합니다. 세부 관리자 지정은 조직 설정과 별도로 저장합니다.',
      [
        '필수 자격을 비울 수 있으며 상위 조직 설정을 자동 상속하지 않습니다. 유형을 바꿔도 다른 유형의 선택을 유지합니다.',
        '세부 관리자는 권한 범위 밖의 조직·팀 기준을 변경하거나 계획을 요청할 수 없습니다. 필수 참조 중인 자격의 팀 적용 제거는 제한됩니다.',
      ],
      '조직의 직속 인원·유형별 대상 역할과 변경 영향을 확인한 뒤 요청해 주세요.',
    );
  if (section === 'assignments')
    return item(
      1,
      managementTitle('assignments'),
      '팀 관리자 또는 운영자가 Auditee·Auditor를 구분해 개인 계획을 요청하고 대상자의 진행을 확인하는 단계입니다.',
      '유형 탭에서 대상자를 확인하고 계획 수립 요청의 유형·인원·작성 기한·메시지를 검토해 전송합니다. 기본 기한은 4주 후이며 수정할 수 있습니다. Auditor 신규 요청은 평가자 역할이 있는 사용자만 가능합니다.',
      '수신자는 유형별 알림과 홈에서 내 계획으로 이동합니다. 계획 확정으로 배정이 생성되며 Auditee는 평가 통과, Auditor는 필수 학습항목 본인 확인으로 수료합니다.',
      [
        '역할이 나중에 해제되어도 이미 받은 Auditor 요청·배정은 본인이 계속할 수 있습니다. 새 요청에는 현재 평가자 역할이 필요합니다.',
        '필수 자격이 없거나 추가 계획 대상이 없어도 요청 상태를 확인할 수 있습니다. 비활성 소속·취득 대상자 Hold는 제한하며 자격별 계획 확정과 요청 전체 완료는 별개입니다.',
      ],
      '선택한 유형·실제 소속·요청 당시 필수 기준·기한을 확인하고 중복 요청 여부를 검토해 주세요.',
    );
  if (section === 'credentials')
    return item(
      5,
      managementTitle('credentials'),
      '팀 관리자 또는 운영자가 개인 보유 인증의 현재 효력과 변경 사유를 관리하는 단계입니다.',
      '대상자를 검색하고 인증서에서 Hold·해제·Revoke 또는 허용된 기간 정정을 검토합니다. 변경 사유·영향·이력을 확인하고 저장합니다.',
      '현재 효력은 보유 목록과 인증서에 반영됩니다. Revoke 후 재취득은 새 요청·계획과 해당 유형의 수료 절차를 거칩니다.',
      [
        '개인 인증 효력 Hold와 인원 단위 취득 대상자 Hold는 별개이며 만료 시계를 멈추지 않습니다.',
        'Auditee 종합평가 완료는 본인만 실행합니다. Auditor 재인증은 아직 제공하지 않습니다.',
      ],
      '개인 인증과 인원 전체 진행 중 어떤 범위를 제어할지 확인하고 사유를 구체적으로 남겨 주세요.',
    );
  if (section === 'results')
    return item(
      4,
      managementTitle('results'),
      '권한 있는 관리자가 대상자의 배정·수료·자격 발급 근거를 읽기 전용으로 확인하는 단계입니다.',
      '대상자·자격과 진행 상태를 확인하고 배정을 펼쳐 인증Set 상태·수료증·인증서를 조회합니다. Auditee는 평가 점수·회차, Auditor는 본인 확인 항목·일시를 확인합니다.',
      '계획 요청은 계획 요청·진행, 현재 인증 효력 조치는 보유 자격 관리에서 처리합니다.',
      [
        '결과 조회는 새로운 응시·수료를 만들지 않습니다. 평가자 역할에도 타인 채점·승인 기능은 없습니다.',
        '삭제·운영 종료·검증 제외 기록의 보존 근거와 현재 진행 가능 상태는 구분합니다.',
      ],
      '발급 당시 버전과 근거를 확인하고 실제 현장 역량에 필요한 추가 자료는 별도로 검토해 주세요.',
    );
  if (name === 'catalog')
    return item(
      0,
      '기준 일괄 작성·검토',
      '등록된 팀 자격과 연결 인증Set을 표·Excel에서 함께 편집하고 변경을 검토하는 단계입니다.',
      state === 'catalog-editing'
        ? '편집 내용은 브라우저에 보관되며 기준 저장 전 변경 비교·오류·제외 항목을 검토합니다. 취소나 복구 시 현재 입력의 보존 여부를 확인합니다.'
        : '대상 자격을 선택하거나 Excel을 가져옵니다. 공통 정보·인증 유형은 참고용이며 새 팀 자격은 기본자격에서 등록합니다. 파일에 포함한 자격 단위의 개정안을 검토합니다.',
      '저장 후 팀 자격 설정의 팀 적용에서 사용할 버전을 확정하고 조직별 필수 자격·유형별 계획 요청을 준비합니다.',
      [
        '유형은 Excel에서 변경할 수 없습니다. Auditor 인증Set의 비활성 평가 데이터도 편집할 수 없습니다. 현재 내보내기 형식은 eks-catalog-v10입니다.',
        '선택하지 않은 자격은 변경하지 않습니다. 개별 팀 자격 저장의 현재/새 버전 선택과 일괄 저장 정책은 구분합니다.',
      ],
      '완전한 개정안에 포함된 자격·인증Set과 오류를 확인하고 현재 파일 형식으로 다시 내보내 주세요.',
    );
  if (['qualifications', 'courses'].includes(section)) {
    const qualification = section === 'qualifications';
    return item(
      0,
      state === 'readonly'
        ? '삭제된 기준 조회'
        : state === 'editing'
          ? `${qualification ? '팀 자격' : '인증Set'} 기준 편집 · ${typeName}`
          : `${managementTitle(section)} · ${typeName}`,
      qualification
        ? '기본자격에서 상속한 유형 안에서 팀의 인증Set 구성·인증기간·재인증 및 알림 설정을 준비하는 단계입니다.'
        : '유형별 인증Set의 학습자료·학습항목과 수료 기준을 준비하는 단계입니다.',
      state === 'readonly'
        ? '삭제된 기준은 읽기 전용으로 확인합니다. 기존 기록을 바꾸지 않고 목록에서 다른 기준을 선택합니다.'
        : qualification
          ? '유형 탭에서 기본자격을 등록하거나 팀 자격을 편집합니다. 저장 검토에서 기간·알림 등 마이너 변경은 현재 버전 저장 또는 새 버전을 선택하고, 인증Set 추가·제거·버전 교체는 새 버전을 생성합니다.'
          : auditor.value
            ? '학습자료와 학습항목을 작성하고 필수 항목을 하나 이상 지정합니다. 객관·상황 대응 평가를 구성하지 않으며 같은 Auditor 유형의 자격에서 연결합니다.'
            : '학습자료·학습항목과 지식·상황 대응 평가의 문항·정답·합격 기준을 작성합니다. 저장 검토와 미완성 항목을 확인합니다.',
      '기준 저장만으로 운영 적용되지 않습니다. 팀 적용에서 사용할 자격 버전을 확정하고 조직 필수 자격과 계획 요청을 설정합니다.',
      qualification
        ? [
            '유형·공통 이름·설명은 기본자격에서 관리하며 팀에서 유형을 바꾸거나 다른 유형 인증Set을 연결할 수 없습니다.',
            '현재 버전 저장도 완료 계획의 보존 설정·발급 기간은 바꾸지 않습니다. 새 버전을 만들어도 기존 팀 적용 선택은 유지하며 미완료 계획은 최신 기준을 확인합니다.',
          ]
        : auditor.value
          ? [
              '필수 학습항목 전체 본인 확인이 수료 조건입니다. 수료 후 근거는 고정되고 타인 승인·점수 평가 단계는 없습니다.',
              '기존 연결 자격의 인증Set 버전을 자동 교체하지 않습니다. 저장 결과와 연결 기준을 확인하고 팀 적용을 별도로 검토합니다.',
            ]
          : [
              'Auditee 학습항목의 필수 표시는 학습 범위이며 체크 수료 조건은 아닙니다. 상황 대응 평가는 지식 통과를 전제로 합니다.',
              '미완성 기준은 저장할 수 있지만 신규 사용에는 운영·필수 값 검증을 통과해야 합니다. 기존 진행과 발급 근거는 당시 버전을 보존합니다.',
            ],
      '유형별 수료 기준·자료 접근 권한·운영 상태와 저장 후 팀 적용 버전을 확인해 주세요.',
    );
  }
  if (section === 'qualification-templates')
    return item(
      0,
      '시스템 공통 기본자격 관리',
      '시스템 운영자가 자격의 원본 유형과 한글명·영문명·설명을 관리하는 단계입니다.',
      '전체·Auditee·Auditor로 조회하고 생성 시 유형을 선택합니다. 어느 팀에도 등록되지 않은 기본자격만 유형을 변경할 수 있습니다.',
      '팀 관리자가 동일 유형으로 등록해 인증Set·기간 등 팀 기준을 작성하고 적용합니다. 한 사용자가 두 유형의 자격을 동시에 보유할 수 있습니다.',
      [
        '삭제된 팀 자격을 포함해 등록 이력이 있으면 유형 변경을 거부합니다. 다른 유형이 필요하면 새 기본자격을 만듭니다.',
        '공통 정보 변경은 현재 기준에 반영되지만 완료 계획과 발급 당시 보존 정보는 유지합니다. 유형은 사용자 역할과 별개의 속성입니다.',
      ],
      '영문명을 포함한 공통 명칭·설명과 유형을 확정한 뒤 팀 등록을 진행해 주세요.',
    );
  if (section === 'organizations')
    return item(
      0,
      '조직 구조 관리',
      '시스템 운영자가 Lv1 업무 경계와 하위 조직 구조·사용 상태를 관리하는 단계입니다.',
      '처음에는 Lv1만 표시합니다. 모두 펼치기·모두 접기·조직명/경로 검색으로 대상을 찾고 선택 조직으로 이동할 수 있습니다. 오른쪽 상세에서 추가·이름·상위 조직·순서·사용 상태를 저장합니다.',
      '조직별 직속 사용자와 관리자를 지정하고 필수 자격·팀 기준을 준비한 뒤 계획을 요청합니다.',
      [
        '하위 조직은 깊이 제한 없이 만들 수 있으나 이동은 같은 Lv1·같은 레벨 범위입니다. 조직 사용 중지와 기존 기록 삭제는 별개입니다.',
        '전체 접기·검색은 상세 입력을 유지합니다. 조직 편집의 신규 변경 이력 생성은 중단했으며 기존 이력은 삭제하지 않습니다.',
      ],
      '조직 이동·중지 전에 소속 사용자와 진행 영향을 확인하고 저장 후 선택 경로를 확인해 주세요.',
    );
  if (section === 'users')
    return item(
      0,
      '사용자 소속·역할 관리',
      '시스템 운영자가 실제 직속 소속과 복수 역할을 관리하는 단계입니다.',
      '사용자 등록·수정에서 소속 조직과 학습자·평가자·관리 역할을 지정합니다. Auditee 신규 요청에는 학습자, Auditor 신규 요청에는 평가자 역할이 필요합니다.',
      '조직별 필수 기준을 확인하고 관리자가 유형별 계획을 요청합니다. 학습자와 평가자를 겸하면 같은 계정에서 두 인증을 각각 진행합니다.',
      [
        '평가자는 Auditor 요청 대상 역할이며 타인 채점·승인 권한이 아닙니다. 세부 조직 관리자 지정은 조직 필수 자격 설정에서 관리합니다.',
        '역할·소속 변경은 기존 확정 배정·인증을 재분류하지 않습니다. 평가자 역할 해제 후에도 기존 Auditor 요청·배정의 본인 진행은 허용합니다.',
      ],
      '역할별 업무 범위와 실제 소속을 확인하고 필요한 권한만 부여해 주세요.',
    );
  if (section === 'overview')
    return item(
      5,
      '전체 업무 조회',
      '시스템 운영자가 전체 또는 선택 Lv1의 업무·기준·공지·변경 기록을 조회하는 단계입니다.',
      'Lv1 조직과 조회 항목을 선택하고 배정·평가 결과, 자격, 인증Set·평가 기준, 공지 또는 변경 이력을 펼쳐 확인합니다.',
      '인증서·수료증에서 발급 근거를 확인하고 수정이 필요하면 해당 팀 관리나 시스템 설정 화면으로 이동합니다.',
      [
        '이 화면은 조회 전용이며 기록을 새로 확정하거나 운영 기준을 변경하지 않습니다.',
        '보존된 과거 근거와 현재 기준·효력을 구분합니다. 변경 이력이 없는 기능의 수행 여부를 이 화면만으로 단정하지 않습니다.',
      ],
      '대상 조직과 기록 시점을 확인하고 유형에 따라 평가 근거와 학습 확인 근거를 구분해 주세요.',
    );
  if (section === 'testing')
    return item(
      0,
      '테스트 초기화와 설정·기준 이전',
      '시스템 운영자가 검증 진행을 초기화하거나 설정·기준을 파일로 이전하는 단계입니다.',
      '진행 초기화는 계획·배정을 남깁니다. 설정·기준만 남기기는 모든 조직의 계획·배정·공지·이력까지 비웁니다. 기본정보 파일은 검사·비교 후 전체 교체 여부를 확인합니다.',
      '미리보기·확인 문구와 업무/조직 백업을 확인한 뒤 실행합니다. 강한 초기화·불러오기 후 계정을 다시 선택하고 새 계획 요청부터 진행합니다.',
      [
        '유형·평가자 역할·기준은 현재 기본정보 형식6으로 이전합니다. 진행 기록과 Auditor 학습 확인 근거는 기본정보 이전 대상이 아닙니다.',
        '현재 Hold·Revoke·운영 종료 상태와 외부 자료 접근 권한을 별도로 확인합니다. 파일에는 사용자 정보와 평가 정답이 포함될 수 있습니다.',
      ],
      '실제 업무 기록을 초기화하지 않도록 환경·범위·백업과 복구 절차를 먼저 확인해 주세요.',
    );
  if (section === 'notices')
    return item(
      1,
      route.path.startsWith('/system') ? '시스템 공지 관리' : '팀 공지 관리',
      route.path.startsWith('/system')
        ? '시스템 운영자가 공통 공지를 게시하는 단계입니다.'
        : '팀 관리자 또는 운영자가 선택 Lv1의 팀 공지를 게시하는 단계입니다.',
      '제목·본문과 게시 상태를 작성하고 저장합니다. 홈 하단의 시스템 공지·내 팀 공지에는 각각 최신 3개가 표시되며 전체 보기와 상세 조회를 제공합니다.',
      '취득 계획이 필요한 인원에게는 계획 요청·진행에서 유형을 선택해 별도로 요청합니다.',
      [
        '공지 게시는 개인 계획 요청·배정 생성·알림 읽음 처리와 별개입니다.',
        '공지·자료 열람은 학습 확인·평가 통과·업무 완료 근거가 아닙니다.',
      ],
      '대상 유형과 조직, 필요한 행동·기한·담당자를 공지에 명확하게 적어 주세요.',
    );
  if (section === 'documents')
    return item(
      0,
      route.params.id ? '운영 문서 읽기' : '운영 문서 목록',
      '시스템 운영자가 저장소에 등록된 보고서와 운영 문서를 읽는 단계입니다.',
      route.params.id
        ? '문서 제목·갱신일을 확인하고 접힌 목차를 펼쳐 본문 위치로 이동합니다. 표·코드는 가로 스크롤하며 문서 목록으로 돌아갈 수 있습니다.'
        : '제목·설명으로 검색하고 등록된 문서를 선택합니다. 문서 추가·수정은 개발자가 Markdown 파일과 등록 목록을 함께 배포하는 방식입니다.',
      '보고서의 기준일·적용 범위·근거를 확인하고 필요한 개선사항은 별도 검토·구현 절차로 연결합니다.',
      [
        '시스템 운영자 전용 읽기 기능이며 웹 업로드·편집은 제공하지 않습니다. 미등록 파일과 로컬 소스 경로는 클릭되지 않는 참고 텍스트입니다.',
        '일반 Markdown을 지원하며 원시 HTML 실행·Mermaid·수식·첨부파일 제공은 포함하지 않습니다. 문서 열람은 인증 적합성 판정이나 업무 완료가 아닙니다.',
      ],
      '문서 책임자와 갱신 주기를 정하고 실제 운영 변경 시 등록 문서를 함께 갱신해 주세요.',
    );
  return item(
    0,
    '화면 접근 확인',
    '현재 계정과 접근 가능한 화면을 확인하는 단계입니다.',
    '메뉴에서 권한에 맞는 화면을 선택합니다. 조회 실패나 없는 기록 안내가 있으면 대상과 접속 계정을 확인합니다.',
    '해당 업무 화면의 절차와 저장 상태를 확인한 뒤 진행합니다.',
    ['이 안내는 조회 성공·업무 완료·권한 부여를 의미하지 않습니다.'],
    '계속 접근할 수 없으면 담당 관리자에게 확인해 주세요.',
  );
});
watch(
  () =>
    `${route.fullPath}:${store.actorId}:${store.managementLv1}:${processContext.value.state}:${auditor.value}:${guide.value.title}`,
  () => {
    expanded.value = false;
  },
);
</script>
<template>
  <aside
    class="container process-guide"
    aria-labelledby="process-guide-title"
    data-testid="process-guide"
  >
    <h2 class="process-guide-heading">
      <button
        id="process-guide-title"
        class="process-guide-toggle"
        :aria-expanded="expanded"
        aria-controls="process-guide-content"
        @click="expanded = !expanded"
      >
        <span class="process-guide-label">MVP 프로세스 검토</span>
        <span class="process-guide-context">현재 단계 · {{ guide.title }}</span>
        <span class="process-guide-action"
          >{{ expanded ? '접기' : '검토 내용 펼치기' }}
          <AppIcon name="down" :size="16" />
        </span>
      </button>
    </h2>
    <div v-show="expanded" id="process-guide-content" class="process-guide-content">
      <ol class="process-steps" aria-label="전체 인증 절차">
        <li v-for="(s, i) in steps" :key="s" :aria-current="i === guide.step ? 'step' : undefined">
          <span class="process-step-number">{{ i + 1 }}</span>
          <span>{{ s }}</span
          ><span v-if="i === guide.step" class="process-step-current">현재</span>
        </li>
      </ol>
      <div class="process-current">
        <h3>현재 단계 · {{ guide.title }}</h3>
        <p>{{ guide.purpose }}</p>
      </div>
      <div class="process-guide-columns">
        <section class="process-work" aria-label="업무 안내">
          <div>
            <h4>이 화면에서 할 일</h4>
            <p>{{ guide.action }}</p>
          </div>
          <div>
            <h4>이후 흐름</h4>
            <p>{{ guide.next }}</p>
          </div>
        </section>
        <section class="process-review" aria-label="AI 검수 항목">
          <h4>AI 검수 항목</h4>
          <p class="process-review-note">
            코드·업무 규칙을 검토해 작성한 정적 설명입니다. 현재 데이터를 실시간 AI로 검수한 결과가
            아닙니다.
          </p>
          <div class="process-review-group">
            <h5>설계상 제약·확인 사항</h5>
            <ul>
              <li v-for="text in guide.limits" :key="text">{{ text }}</li>
            </ul>
          </div>
          <div class="process-review-group">
            <h5>개선 제안</h5>
            <p>{{ guide.suggestion }}</p>
          </div>
        </section>
      </div>
      <p class="process-guide-meta">업무 처리와 별도의 검토 안내 · 검토 기준 v14 · 2026-10-26</p>
    </div>
  </aside>
</template>
