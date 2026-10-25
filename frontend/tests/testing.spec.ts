import { configureTestPolicies } from '../../server/tests/policy-helpers';
import { test, expect, actor } from './fixtures';
import { completePlan } from './workflow-helpers';
import { defaultPlanningDueOn, type Course, type Kind } from '../../shared/src/index';
import type { Page } from '@playwright/test';

async function respond(page: Page, course: Course, kind: Kind, pass = true) {
  const questions = kind === 'objective' ? course.questions : course.practicalQuestions;
  const tabs = page.getByRole('tablist', { name: '응시 문항', exact: true });
  await expect(tabs).toHaveAttribute('aria-orientation', 'vertical');
  for (let i = 0; i < questions.length; i++) {
    await tabs.getByRole('tab').nth(i).click();
    const q = questions[i]!;
    await page
      .getByRole('radio')
      .nth(pass ? q.correct! : (q.correct! + 1) % q.choices.length)
      .check();
  }
  await page.getByRole('button', { name: /^답안 확인(?:으로 돌아가기)?$/ }).click();
  await expect(page.getByRole('heading', { name: '제출 전 답안 확인', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '최종 제출', exact: true }).click();
  await expect(page.locator('.result-panel')).toContainText(pass ? '평가 통과' : '미통과');
}

test('계획 요청 기본 기한 → 전 FT 학습자의 학습·독립 평가·재응시·수료·인증', async ({
  page,
  backend,
}) => {
  test.setTimeout(60000);
  await configureTestPolicies(backend.store);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('계획 작성 기한')).toHaveValue(defaultPlanningDueOn());
  await expect(dialog.getByLabel(/담당 FT/)).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: '박준호', exact: true }).check();
  await dialog.getByRole('button', { name: '대상자에게 요청' }).click();
  await expect(dialog).toHaveCount(0);
  expect(backend.store.snapshot().planningRequests.at(-1)!.dueOn).toBe(defaultPlanningDueOn());
  await actor(page, 'ft-1');
  await expect(page.getByRole('link', { name: 'FT 평가' })).toHaveCount(0);
  await completePlan(page, '평가 흐름 체험');
  const state = backend.store.snapshot();
  const assignment = state.assignments.find((a) => a.learnerId === 'ft-1')!;
  expect(assignment).not.toHaveProperty('ftId');
  const courses = state.qualifications
    .find((q) => q.id === assignment.qualificationId)!
    .courseIds.map((id) => state.courses.find((c) => c.id === id)!);
  for (const [i, course] of courses.entries()) {
    await page.goto(`/qualifications/${assignment.id}/courses/${course.id}/practical`);
    await expect(
      page.getByRole('heading', { name: '지식 평가를 먼저 통과해 주세요', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('radio').first()).toBeDisabled();
    await page.goto(`/qualifications/${assignment.id}/courses/${course.id}/objective`);
    if (i === 0) {
      await respond(page, course, 'objective', false);
      await page.getByRole('button', { name: '다시 응시', exact: true }).click();
    }
    await respond(page, course, 'objective');
    await page.getByRole('link', { name: '상황 대응 평가 시작', exact: true }).click();
    await respond(page, course, 'practical');
    await expect(
      page.locator('.result-panel').getByText('인증Set 수료', { exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('link', { name: '인증서 보기' }).click();
  await expect(page.locator('.certificate-recipient')).toHaveText('박준호');
  expect(
    backend.store.snapshot().certifications.filter((c) => c.assignmentId === assignment.id),
  ).toHaveLength(1);
  expect(
    backend.store.snapshot().completions.filter((c) => c.learnerId === assignment.learnerId),
  ).toHaveLength(2);
});

test('전 FT 계정·여러 탭 격리와 폐지된 평가 화면 안내', async ({ page, context }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  const other = await context.newPage();
  await other.goto('/');
  await actor(other, 'ft-1');
  await page.goto('/qualifications/assignment-1/courses/demo-course-1/practical');
  await expect(page.getByRole('heading', { name: '상황 대응 평가', exact: true })).toBeVisible();
  await page.getByRole('radio').first().check();
  await expect(page.locator('.save-status')).toHaveText('저장됨');
  await expect(other.getByRole('heading', { name: '박준호 님', exact: true })).toBeVisible();
  await other.goto('/evaluations');
  await expect(other.getByRole('heading', { name: /종료/, level: 1 })).toBeVisible();
  await page.goto('/qualifications/assignment-1/courses/demo-course-2/subjective');
  await expect(page.getByRole('heading', { name: /종료/, level: 1 })).toBeVisible();
  await other.close();
});

test('계획 요청의 수동 기한과 빈 날짜 오류를 유지한다', async ({ page, backend }) => {
  await configureTestPolicies(backend.store);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: '정하린', exact: true }).check();
  await dialog.getByLabel('계획 작성 기한').fill('');
  await expect(dialog.locator('.field-error')).toContainText('기한을 입력');
  await expect(dialog.getByRole('button', { name: '대상자에게 요청' })).toBeDisabled();
  await dialog.getByLabel('계획 작성 기한').fill('2027-03-31');
  await dialog.getByRole('button', { name: '대상자에게 요청' }).click();
  await expect(dialog).toHaveCount(0);
  expect(backend.store.snapshot().planningRequests.at(-1)!.dueOn).toBe('2027-03-31');
});
