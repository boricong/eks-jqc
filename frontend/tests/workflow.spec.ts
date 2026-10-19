import { test, expect, actor } from './fixtures';
import { completePlan, requestPlan } from './workflow-helpers';
import type { Page } from '@playwright/test';

async function refresh(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => innerWidth),
  );
}
async function apiFor(page: Page) {
  const tab = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  return async (path: string, body: unknown, method = 'POST') => {
    const r = await page.request.fetch(`/api${path}`, {
      method,
      data: body,
      headers: { 'X-Session-Tab': tab!, 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
}
test('15종 가져오기부터 김민서 계획·학습·세 유형 평가·박준호 채점·증명서·만료 안내', async ({
  page,
  context,
  backend,
}) => {
  test.setTimeout(120000);
  context.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  await page.getByRole('button', { name: '기본 자격 가져오기', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('checkbox')).toHaveCount(15);
  await page
    .getByRole('dialog')
    .getByRole('checkbox', { name: /설비 Backup 검증 자격/ })
    .check();
  await page.getByRole('button', { name: '선택 자격 가져오기', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: '설비 Backup 검증 자격', exact: true }).click();
  await page.getByRole('button', { name: '사용 등록', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('자격 설명');
  await page.goto('/admin/courses/demo-course-1');
  await page.getByRole('button', { name: '새 버전', exact: true }).click();
  await page.getByLabel('과정명', { exact: true }).fill('종합 평가 과정');
  await page.getByRole('checkbox', { name: '주관식', exact: true }).check();

  await page.getByLabel('교육 종류', { exact: true }).selectOption('ojt');
  await page.getByLabel('학습 항목명', { exact: true }).fill('독립 수행 OJT');
  await page.getByRole('tab', { name: /^주관식/ }).click();
  await page.getByLabel('주관식 합격 기준 (%)', { exact: true }).fill('60');
  await page.getByRole('button', { name: '문항 추가', exact: true }).click();
  await page.getByLabel('문항', { exact: true }).fill('오류 원인과 조치 방법을 설명하세요.');
  await page.getByLabel('배점', { exact: true }).fill('10');
  await page.getByLabel('채점 기준', { exact: true }).fill('원인과 조치 각각 5점');
  await page.getByLabel('모범답안 · 선택').fill('학습자에게 비공개인 모범답안');
  await page.getByRole('button', { name: '사용 등록', exact: true }).click();
  await expect(page.getByRole('button', { name: '새 버전', exact: true })).toBeVisible();
  const course = backend.store.snapshot().courses.find((c) => c.title === '종합 평가 과정')!;
  await page.getByRole('link', { name: '자격 관리', exact: true }).click();
  await page.getByRole('link', { name: '설비 Backup 검증 자격', exact: true }).click();
  await page.getByLabel('자격 설명', { exact: true }).fill('설비 Backup 수행 기준을 검증한다.');
  await page.getByLabel('인증기간', { exact: true }).selectOption('months');
  await page.getByLabel('유효 개월 수', { exact: true }).fill('1');
  await page.getByLabel('만료 전 알림 일수', { exact: true }).fill('7');
  await page.getByRole('checkbox', { name: /종합 평가 과정/ }).check();
  await page.getByRole('button', { name: '사용 등록', exact: true }).click();
  await expect(page.getByRole('button', { name: '새 버전', exact: true })).toBeVisible();
  await requestPlan(page, '김민서');
  const learner = await context.newPage();
  learner.on('pageerror', (e) => errors.push(e.message));
  await learner.goto('/');
  await actor(learner, 'learner-1');
  await expect(learner.getByRole('heading', { name: '다음 할 일과 알림' })).toBeVisible();
  await completePlan(learner, '설비 Backup 검증 자격', false);
  const assignment = backend.store.snapshot().assignments.find((a) => a.planId)!;
  await learner.screenshot({
    path: test.info().outputPath('workflow-learning-1920x900.png'),
    fullPage: true,
  });
  await expect(learner.locator('.course-workspace')).toContainText('필수 학습 기록 대기');
  await learner.getByRole('button', { name: '학습 완료 기록', exact: true }).click();
  await learner
    .getByLabel('완료 내용', { exact: true })
    .fill('OJT를 통해 독립 수행을 연습했습니다.');
  await learner.getByRole('button', { name: '학습 기록 저장', exact: true }).click();
  await expect(learner.locator('.course-workspace')).toContainText('FT 배정 대기');
  await learner
    .locator('.assessment-card')
    .filter({ has: learner.getByRole('heading', { name: '객관식', exact: true }) })
    .getByRole('link', { name: '응시하기', exact: true })
    .click();
  await learner.getByLabel('이름과 버전', { exact: true }).check();
  await learner.getByLabel('기록란', { exact: true }).check();
  await learner.getByRole('button', { name: '답안 확인', exact: true }).click();
  await learner.getByRole('button', { name: '제출', exact: true }).click();
  await learner.goto(`/qualifications/${assignment.id}/courses/${course.id}/subjective`);
  await learner
    .getByLabel('1번 답안', { exact: true })
    .fill('원인을 확인하고 근거에 따라 조치합니다.');
  await expect
    .poll(
      () =>
        backend.store
          .snapshot()
          .attempts.find((t) => t.courseId === course.id && t.kind === 'subjective')
          ?.subjectiveAnswers,
    )
    .toEqual({ [course.subjectiveQuestions[0]!.id]: '원인을 확인하고 근거에 따라 조치합니다.' });
  await learner.reload();
  await expect(learner.getByLabel('1번 답안')).toHaveValue(
    '원인을 확인하고 근거에 따라 조치합니다.',
  );
  await expect(learner.getByRole('button', { name: '답안 확인', exact: true })).toBeDisabled();
  await expect(learner.getByText('학습자에게 비공개인 모범답안')).toHaveCount(0);
  await page.reload();
  // The assignment table follows the target/plan overview.
  const assignmentRow = page
    .locator('tbody tr')
    .filter({ hasText: '설비 Backup 검증 자격' })
    .last();
  await assignmentRow.locator('summary').click();
  await assignmentRow.getByRole('button', { name: 'FT 변경', exact: true }).click();
  await page.getByRole('dialog').getByLabel('담당 FT', { exact: true }).selectOption('ft-1');
  await page.getByLabel('변경 사유').fill('박준호 지정');
  await page.getByRole('dialog').getByRole('button', { name: '변경', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await refresh(learner);
  await expect(learner.getByRole('button', { name: '답안 확인', exact: true })).toBeEnabled();
  await learner.getByRole('button', { name: '답안 확인', exact: true }).click();
  await learner.getByRole('button', { name: '답안 제출', exact: true }).click();
  await expect(learner.getByRole('heading', { name: 'FT 채점 대기', exact: true })).toBeVisible();
  await learner.goto(`/qualifications/${assignment.id}/courses/${course.id}/practical`);
  await learner.getByRole('button', { name: '평가 요청', exact: true }).click();
  const ft = await context.newPage();
  ft.on('pageerror', (e) => errors.push(e.message));
  await ft.goto('/');
  await actor(ft, 'ft-1');
  await ft.getByRole('link', { name: 'FT 평가', exact: true }).click();
  await ft.getByRole('link', { name: '채점하기', exact: true }).click();
  await expect(ft.locator('.goal-note')).toContainText('독립적으로 수행');
  await ft.screenshot({
    path: test.info().outputPath('workflow-ft-grading-1920x900.png'),
    fullPage: true,
  });
  await ft.getByLabel('점수 · 10점 만점', { exact: true }).fill('5');
  await ft.getByLabel('채점 근거 · 학습자에게 비공개').fill('원인 설명 보완 필요');
  await ft.getByLabel('공개 피드백 · 미통과 시 필수').fill('조치의 이유를 보완해 주세요.');
  await ft.getByRole('button', { name: '채점 확인', exact: true }).click();
  await ft.getByRole('button', { name: '채점 확정', exact: true }).click();
  await expect(ft.getByRole('heading', { name: '김민서 님의 주관식 평가 결과' })).toBeVisible();
  await learner.goto(`/qualifications/${assignment.id}/courses/${course.id}/subjective`);
  await learner.getByRole('button', { name: '주관식 다시 응시', exact: true }).click();
  await learner
    .getByLabel('1번 답안')
    .fill('원인을 확인하고 조치의 타당성 및 검증 결과를 기록합니다.');
  await learner.getByRole('button', { name: '답안 확인', exact: true }).click();
  await learner.getByRole('button', { name: '답안 제출', exact: true }).click();
  await ft.goto(`/evaluations/${assignment.id}/${course.id}/subjective`);
  await ft.getByLabel('점수 · 10점 만점').fill('10');
  await ft.getByLabel('채점 근거 · 학습자에게 비공개').fill('원인과 조치 모두 충족');
  await ft.getByRole('button', { name: '채점 확인', exact: true }).click();
  await ft.getByRole('button', { name: '채점 확정', exact: true }).click();
  await expect(ft.locator('main')).toContainText('실기 평가가 남아 있습니다.');
  await ft.goto(`/evaluations/${assignment.id}/${course.id}`);
  await expect(ft.locator('.ft-item')).toHaveCount(course.practicalItems.length);
  for (const item of await ft.locator('.ft-item').all()) {
    await item.getByLabel('통과', { exact: true }).check();
    await item.getByLabel('판정 근거').fill('실제 수행을 확인함.');
  }
  await ft.getByRole('button', { name: '판정 확인', exact: true }).click();
  await ft.getByRole('button', { name: '평가 확정', exact: true }).click();
  await expect(ft.getByText('김민서 님이 이 과정을 수료했습니다.', { exact: true })).toBeVisible();
  await learner.goto(`/qualifications/${assignment.id}`);
  await learner.getByRole('link', { name: '과정 수료증 보기', exact: true }).click();
  await expect(learner.getByRole('heading', { name: '검증용 과정 수료증' })).toBeVisible();
  await learner.getByRole('link', { name: '자격 인증서 보기', exact: true }).click();
  await expect(learner.getByRole('heading', { name: '자격 인증서 · 검증용' })).toBeVisible();
  await expect(learner.locator('.validity-badge')).toHaveText('유효');
  await learner.screenshot({
    path: test.info().outputPath('workflow-certificate-1920x900.png'),
    fullPage: true,
  });
  const cert = backend.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === assignment.id)!;
  // A warning is still a valid qualification until its expiry day ends.
  const warningDate = new Date(Date.parse(cert.expiresOn!) - 7 * 86400000);
  await learner.clock.setFixedTime(warningDate);
  await learner.goto('/qualifications?filter=certified');
  await learner.getByLabel('자격 유효 상태').selectOption('valid');
  await expect(learner.locator('.qualification-row')).toHaveCount(1);
  await expect(learner.locator('.validity-badge')).toHaveText('만료 예정');
  await page.clock.setFixedTime(warningDate);
  await page.goto('/admin/results');
  await page.getByLabel('상태 필터').selectOption('valid');
  await expect(page.locator('.result-details')).toHaveCount(1);
  await backend.store.refreshNotifications(
    new Date(Date.parse(cert.expiresOn!) + 86400000).toISOString(),
  );
  await learner.clock.setFixedTime(new Date(Date.parse(cert.expiresOn!) + 86400000));
  await learner.goto(`/certifications/${assignment.id}`);
  await expect(learner.locator('.validity-badge')).toHaveText('만료');
  await expect(learner.getByText(cert.id, { exact: false })).toBeVisible();
  await learner.goto('/notifications');
  await expect(learner.locator('.notification-list')).toContainText('만료');
  expect(backend.store.snapshot().certifications.find((c) => c.id === cert.id)).toEqual(cert);
  await learner.setViewportSize({ width: 390, height: 900 });
  await noOverflow(learner);
  await learner.screenshot({
    path: test.info().outputPath('workflow-notifications-mobile.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await learner.close();
  await ft.close();
});

test('개인 계획 자동 저장·응답 유실 재시도·충돌 복구·좁은 화면', async ({
  page,
  context,
  backend,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await page.getByLabel('취득할 자격').selectOption('demo-qualification');
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await expect(page.getByLabel('목표 인증일')).toBeVisible();
  const plan = backend.store.snapshot().plans[0]!;
  let once = true;
  await page.route(`**/api/plans/${plan.id}`, async (r) => {
    if (r.request().method() === 'PUT' && once) {
      once = false;
      await r.fetch();
      await r.abort('failed');
    } else await r.continue();
  });
  await page.getByLabel('목표 인증일').fill('2027-01-31');
  await expect(page.getByRole('alert')).toContainText('다시 시도');
  await page.getByRole('button', { name: '저장 다시 시도', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('목표 인증일')).toHaveValue('2027-01-31');
  const other = await context.newPage();
  await other.goto('/');
  await actor(other, 'learner-2');
  await other.goto(`/plans/${plan.id}`);
  const save = await apiFor(other),
    latest = backend.store.snapshot().plans[0]!;
  await save(
    `/plans/${plan.id}`,
    { targetOn: '2027-02-28', schedules: latest.schedules, revision: latest.revision },
    'PUT',
  );
  await page.getByLabel('목표 인증일').fill('2027-03-31');
  await expect(page.getByRole('alert')).toContainText('다른 창');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await expect(page.getByLabel('목표 인증일')).toHaveValue('2027-02-28');
  await page.setViewportSize({ width: 390, height: 900 });
  await noOverflow(page);
  await page.screenshot({
    path: test.info().outputPath('workflow-plan-mobile.png'),
    fullPage: true,
  });
  expect(backend.store.snapshot().plans).toHaveLength(1);
  for (const field of await page.getByLabel('학습 시작 예정일', { exact: true }).all())
    await field.fill('2026-10-01');
  for (const field of await page.getByLabel('학습 완료 예정일', { exact: true }).all())
    await field.fill('2026-10-15');
  for (const field of await page.getByLabel('평가 예정일', { exact: true }).all())
    await field.fill('2026-12-01');
  await page.getByRole('button', { name: '학습 목표 설정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '학습 목표 설정', exact: true })).toBeVisible();
  for (const field of await page.getByRole('textbox').all()) await field.fill('독립 수행 학습');
  await page.getByRole('button', { name: '최종 확인', exact: true }).click();
  await page.getByRole('button', { name: '계획 완료', exact: true }).click();
  await expect(page).toHaveURL(/\/qualifications\/[^/?]+$/);
  const assignment = backend.store.snapshot().assignments.find((a) => a.planId === plan.id)!;
  await page.goto(`/plans/${plan.id}`);
  await page.getByRole('button', { name: '2. 일정 수립', exact: true }).click();
  await page.getByLabel('목표 인증일').fill('2027-03-31');
  await expect(page.getByRole('button', { name: '일정·목표 변경 저장' })).toBeDisabled();
  await page.getByLabel('계획 변경 사유').fill('현장 교육 일정 조정');
  await page.getByRole('button', { name: '일정·목표 변경 저장' }).click();
  await expect.poll(() => backend.store.snapshot().plans[0]!.targetOn).toBe('2027-03-31');
  expect(backend.store.snapshot().assignments.find((a) => a.id === assignment.id)).toEqual(
    assignment,
  );
  await other.close();
});
