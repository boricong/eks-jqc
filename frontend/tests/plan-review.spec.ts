import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { JsonStore } from '../../server/src/storage';
import { test, expect, actor, answerConfirmation } from './fixtures';
import { requestPlan, savePlanViaApi } from './workflow-helpers';
import { linkFixtureTemplates } from '../../server/tests/template-helpers';

const longTitle = '설비 상태와 공정 조건을 점검하고 독립적으로 수행하는 자격 '.repeat(4);
const longDescription =
  '자격의 적용 범위와 확인할 기준입니다.\n현장에서 수행하는 작업과 판단 근거를 함께 확인합니다.\n' +
  '긴설명'.repeat(80);
const longGoal =
  '첫 번째 목표: 점검 항목과 판단 근거를 설명합니다.\n두 번째 목표: 도움 없이 독립적으로 작업합니다.\n' +
  '긴학습목표'.repeat(40);
async function catalog(store: JsonStore, count = 2, long = false) {
  await store.transact(
    'admin-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      const q = structuredClone(s.qualifications.find((q) => q.id === 'demo-qualification')!);
      q.id = 'review-qualification';
      q.entityId = 'review-qualification';
      const source = s.courses.find((c) => c.id === q.courseIds[0])!;
      q.courseIds = Array.from({ length: count }, (_, i) => `review-course-${i + 1}`);
      q.courseIds.forEach((id, i) =>
        s.courses.push({
          ...structuredClone(source),
          id,
          entityId: id,
          title: `${i + 1}번 인증Set${long ? ' · 긴 이름의 설비 점검과 수행 범위 확인 '.repeat(4) : ''}`,
        }),
      );
      if (long) {
        q.title = longTitle;
        q.description = longDescription;
      }
      s.qualifications.push(q);
      linkFixtureTemplates(s);
      return {};
    },
  );
}
async function startReview(page: Page, store: JsonStore, count = 2, long = false) {
  await catalog(store, count, long);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await page.getByLabel('취득할 자격').selectOption('review-qualification');
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await page.getByLabel('종료일', { exact: true }).fill('2029-12-01');
  await expect(page.locator('textarea[data-plan-field]')).toHaveCount(1);
  for (const input of await page.locator('textarea[data-plan-field]').all())
    await input.fill(long ? longGoal : '기준을 확인하고 독립적으로 수행합니다.');
  await page.getByRole('button', { name: '최종 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '계획 최종 확인', exact: true })).toBeVisible();
  return store.snapshot().plans[0]!;
}

async function review(page: Page) {
  await page.getByRole('button', { name: '3. 최종 확인', exact: true }).click();
  await expect(page.locator('.plan-review')).toBeVisible();
}

test('자격별 날짜 두 개와 목표 하나·참고 인증Set·키보드 수정 초점', async ({ page, backend }) => {
  const plan = await startReview(page, backend.store);
  await expect(page.locator('.plan-review-summary')).toContainText('2029.12.01');
  await expect(page.getByRole('region', { name: '포함된 인증Set' }).locator('li')).toHaveCount(2);
  await page.getByRole('button', { name: '일정 수정', exact: true }).click();
  await expect(page.getByLabel('시작일', { exact: true })).toBeFocused();
  await expect(page.locator('input[type="date"]')).toHaveCount(2);
  await expect(page.getByLabel('평가 예정일')).toHaveCount(0);
  await page.getByLabel('종료일', { exact: true }).fill('2030-01-01');
  await review(page);
  await page.getByRole('button', { name: '학습 목표 수정', exact: true }).click();
  await expect(page.getByLabel('학습 목표(선택)')).toBeFocused();
  await page.getByLabel('학습 목표(선택)').fill('변경한 자격 목표\n줄바꿈 유지');
  await review(page);
  await expect(page.locator('.plan-review-goal')).toContainText('변경한 자격 목표');
  const toggle = page.getByRole('button', { name: '요청 기준 펼치기', exact: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.plan-review-request')).toContainText('현재 소속');
  expect(backend.store.snapshot().plans.find((p) => p.id === plan.id)!.endOn).toBe('2030-01-01');
});

test('목표 저장 실패·충돌에서 입력 유지와 재시도·재조회', async ({ page, backend }) => {
  const plan = await startReview(page, backend.store);
  await page.getByRole('button', { name: '학습 목표 수정', exact: true }).click();
  const input = page.getByLabel('학습 목표(선택)');
  await page.route(`**/api/plans/${plan.id}`, (r) =>
    r.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: '저장 실패 시험' }),
    }),
  );
  await input.fill('보존할 목표');
  await page.getByRole('button', { name: '최종 확인', exact: true }).click();
  await expect(input).toHaveValue('보존할 목표');
  await expect(page.locator('.save-error')).toContainText('저장 실패 시험');
  await page.unroute(`**/api/plans/${plan.id}`);
  await page.getByRole('button', { name: '저장 재시도', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('저장됨');
  await page.route(`**/api/plans/${plan.id}`, (r) =>
    r.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ message: '다른 창에서 수정되었습니다.' }),
    }),
  );
  await input.fill('충돌한 목표');
  await page.getByRole('button', { name: '최종 확인', exact: true }).click();
  await expect(input).toHaveValue('충돌한 목표');
  await page.unroute(`**/api/plans/${plan.id}`);
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(input).toHaveValue('보존할 목표');
});
for (const failure of ['response', 'refresh'] as const) {
  test(`최종 완료 ${failure === 'response' ? '응답 유실' : '재조회 실패'} 시 같은 명령 재시도와 단일 배정`, async ({
    page,
    backend,
  }) => {
    const plan = await startReview(page, backend.store, 1);
    const keys: string[] = [];
    await page.route(`**/api/plans/${plan.id}/complete`, async (route) => {
      keys.push(route.request().headers()['idempotency-key']!);
      if (failure === 'response' && keys.length === 1) {
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    let failed = false;
    if (failure === 'refresh')
      await page.route('**/api/workspace**', async (route) => {
        if (keys.length && !failed) {
          failed = true;
          await route.abort('failed');
        } else await route.continue();
      });
    await page.getByRole('button', { name: '계획 완료', exact: true }).click();
    await expect(page.locator('.plan-review-submit-error')).toContainText(
      '서버에 연결할 수 없습니다.',
    );
    await expect(page.locator('.plan-review-submit-error')).toBeFocused();
    await expect(page.locator('.plan-review-submit-error')).toBeInViewport();
    await expect(page.locator('.plan-review')).toBeVisible();
    await page.getByRole('button', { name: '계획 완료', exact: true }).click();
    await expect(page).toHaveURL(/\/qualifications\/[^/?]+$/);
    expect(new Set(keys).size).toBe(1);
    expect(keys.length).toBe(failure === 'response' ? 2 : 1);
    expect(backend.store.snapshot().assignments.filter((a) => a.planId === plan.id)).toHaveLength(
      1,
    );
    expect(backend.store.snapshot().planningRequests[0]!.completion).toBeUndefined();
  });
}

test('확정 계획은 읽기 전용이며 서버 변경을 조회한다', async ({ page, backend }) => {
  const plan = await startReview(page, backend.store, 1);
  await page.getByRole('button', { name: '계획 완료', exact: true }).click();
  await expect(page).toHaveURL(/\/qualifications\/[^/?]+$/);
  await page.goto(`/plans/${plan.id}`);
  await expect(page.locator('input, textarea')).toHaveCount(0);
  await savePlanViaApi(page, plan.id, { endOn: '2030-12-01', goal: '수정 이력' }, '일정 변경');
  await page.reload();
  await expect(page.locator('.plan-review-summary')).toContainText('2030.12.01');
  await expect(page.locator('.plan-review-goal')).toContainText('수정 이력');
  expect(backend.store.snapshot().assignments.filter((a) => a.planId === plan.id)).toHaveLength(1);
});
for (const count of [1, 2, 8])
  test(`${count}개 인증Set은 참고 목록·긴 정보·네 화면 폭·조회 불변`, async ({ page, backend }) => {
    await startReview(page, backend.store, count, true);
    const before = backend.store.snapshot();
    for (const width of [1920, 1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.getByRole('region', { name: '포함된 인증Set' }).locator('li')).toHaveCount(
        count,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.getByRole('button', { name: '계획 완료', exact: true })).toBeEnabled();
      await page.screenshot({
        path: test.info().outputPath(`qualification-plan-${count}-${width}.png`),
        fullPage: true,
      });
    }
    expect(backend.store.snapshot()).toEqual(before);
  });

test('이관된 긴 목표와 인증Set 일정은 읽기 전용 이력으로 보존한다', async ({ page, backend }) => {
  const plan = await startReview(page, backend.store);
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    'legacy-plan-display',
    () => {},
    (s) => {
      const p = s.plans.find((p) => p.id === plan.id)!;
      p.goal = '';
      p.previousSchedule = {
        workflowVersion: 'personal-certification-v5',
        targetOn: '2030-12-31',
        migratedAt: new Date().toISOString(),
        goalNeedsReview: true,
        schedules: s.qualifications
          .find((q) => q.id === p.qualificationId)!
          .courseIds.map((courseId, i) => ({
            courseId,
            learningStart: '2026-10-01',
            learningEnd: '2026-10-22',
            assessmentOn: '2026-10-29',
            goal: `${i + 1}번 원래 목표 ` + '목'.repeat(1900),
          })),
      };
      p.revision++;
      return {};
    },
  );
  await page.reload();
  const before = backend.store.snapshot();
  await page.getByText('이전 계획 이력', { exact: true }).click();
  const history = page.locator('.previous-plan');
  await expect(history).toContainText('2,000자를 넘어');
  await expect(history).toContainText('2030-12-31');
  await expect(history).toContainText('1번 원래 목표');
  await expect(history).toContainText('2번 원래 목표');
  await expect(history.locator('input, textarea')).toHaveCount(0);
  expect(backend.store.snapshot()).toEqual(before);
});
