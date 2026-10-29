import { answerConfirmation } from './fixtures';
import { test, expect, actor } from './fixtures';
import { completePlan, requestPlan, savePlanViaApi } from './workflow-helpers';
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
      headers: {
        'X-Session-Tab': tab!,
        'Idempotency-Key': crypto.randomUUID(),
        'X-EKS-Release-Contract': '3',
      },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
}

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
  await expect(page.getByLabel('완료일', { exact: true })).toBeVisible();
  const request = backend.store.snapshot().planningRequests[0]!;
  let once = true;
  await page.route(`**/api/planning-requests/${request.id}/schedule`, async (r) => {
    if (r.request().method() === 'PUT' && once) {
      once = false;
      await r.fetch();
      await r.abort('failed');
    } else await r.continue();
  });
  await page.getByLabel('완료일', { exact: true }).fill('2027-01-31');
  await expect(page.getByRole('alert')).toContainText('다시 시도');
  await page.getByRole('button', { name: '저장 재시도', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('완료일', { exact: true })).toHaveValue('2027-01-31');
  const plan = backend.store.snapshot().plans[0]!;
  const other = await context.newPage();
  await other.goto('/');
  await actor(other, 'learner-2');
  await other.goto(`/plans/${plan.id}`);
  const save = await apiFor(other),
    latest = backend.store.snapshot().plans[0]!;
  await save(
    `/plans/${plan.id}`,
    { endOn: '2027-02-28', startOn: latest.startOn, goal: latest.goal, revision: latest.revision },
    'PUT',
  );
  await page.getByLabel('완료일', { exact: true }).fill('2027-03-31');
  await expect(page.getByRole('alert')).toContainText('다른 창');
  await page.getByRole('button', { name: '변경된 저장 내용 확인', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(page.getByLabel('완료일', { exact: true })).toHaveValue('2027-03-31');
  await page.setViewportSize({ width: 390, height: 900 });
  await noOverflow(page);
  await page.screenshot({
    path: test.info().outputPath('workflow-plan-mobile.png'),
    fullPage: true,
  });
  expect(backend.store.snapshot().plans).toHaveLength(1);
  for (const field of await page.getByLabel('시작일', { exact: true }).all())
    await field.fill('2026-10-01');
  for (const field of await page.getByLabel('완료일', { exact: true }).all())
    await field.fill('2026-10-15');
  await page.locator('.request-schedule-row summary').click();
  await expect(page.getByLabel('학습 목표(선택)', { exact: true })).toBeVisible();
  for (const field of await page.getByLabel('학습 목표(선택)', { exact: true }).all())
    await field.fill('독립 수행 학습');
  await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
  await page.getByRole('button', { name: '전체 계획 확정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '전체 계획 확정 완료' })).toBeVisible();
  const assignment = backend.store.snapshot().assignments.find((a) => a.planId === plan.id)!;
  await page.goto(`/plans/${plan.id}`);
  await expect(page.getByRole('navigation', { name: '계획 작성 단계' })).toHaveCount(0);
  await expect(page.getByLabel('계획 변경 사유')).toHaveCount(0);
  await savePlanViaApi(page, plan.id, { endOn: '2027-03-31' }, '현장 교육 일정 조정');
  await page.reload();
  await expect(page.locator('.plan-review-summary')).toContainText('2027.03.31');
  await expect.poll(() => backend.store.snapshot().plans[0]!.endOn).toBe('2027-03-31');
  expect(backend.store.snapshot().assignments.find((a) => a.id === assignment.id)).toEqual(
    assignment,
  );
  await other.close();
});
