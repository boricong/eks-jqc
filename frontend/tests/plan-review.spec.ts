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
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  const row = page
    .locator('.request-schedule-row')
    .filter({ has: page.locator('#request-schedule-review-qualification-endOn') });
  await row.getByLabel('완료일', { exact: true }).fill('2027-02-01');
  await row.locator('summary').click();
  await row
    .getByLabel('학습 목표(선택)')
    .fill(long ? longGoal : '기준을 확인하고 독립적으로 수행합니다.');
  await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '전체 계획 최종 확인', exact: true }),
  ).toBeVisible();
  return store.snapshot().plans.find((p) => p.qualificationId === 'review-qualification')!;
}
for (const failure of ['response', 'refresh'] as const)
  test(
    '전체 확정 ' + failure + ' 유실 시 같은 키 재시도·자격별 단일 배정',
    async ({ page, backend }) => {
      const plan = await startReview(page, backend.store, 1),
        request = backend.store.snapshot().planningRequests[0]!,
        keys: string[] = [];
      await page.route(
        '**/api/planning-requests/' + request.id + '/schedule/complete',
        async (r) => {
          keys.push(r.request().headers()['idempotency-key']!);
          if (failure === 'response' && keys.length === 1) {
            await r.fetch();
            await r.abort('failed');
          } else await r.continue();
        },
      );
      let failed = false;
      if (failure === 'refresh')
        await page.route('**/api/workspace**', async (r) => {
          if (keys.length && !failed) {
            failed = true;
            await r.abort('failed');
          } else await r.continue();
        });
      await page.getByRole('button', { name: '전체 계획 확정', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('서버에 연결할 수 없습니다.');
      await page.getByRole('button', { name: '전체 확정 재시도', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: '전체 계획 확정 완료', exact: true }),
      ).toBeVisible();
      expect(new Set(keys).size).toBe(1);
      expect(backend.store.snapshot().assignments.filter((a) => a.planId === plan.id)).toHaveLength(
        1,
      );
      expect(backend.store.snapshot().planningRequests[0]!.completion).toBeDefined();
    },
  );
test('확정 계획 읽기 전용·허용 기한 안에서 변경한 서버 이력 조회', async ({ page, backend }) => {
  const plan = await startReview(page, backend.store, 1);
  await page.getByRole('button', { name: '전체 계획 확정', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '전체 계획 확정 완료', exact: true }),
  ).toBeVisible();
  await page.goto('/plans/' + plan.id);
  await expect(page.locator('input, textarea')).toHaveCount(0);
  await savePlanViaApi(page, plan.id, { endOn: '2027-03-01', goal: '수정 이력' }, '일정 변경');
  await page.reload();
  await expect(page.locator('.plan-review-summary')).toContainText('2027.03.01');
  await expect(page.locator('.plan-review-goal')).toContainText('수정 이력');
  expect(backend.store.snapshot().assignments.filter((a) => a.planId === plan.id)).toHaveLength(1);
});
for (const count of [1, 2, 8])
  test(count + '개 인증Set·긴 정보·4개 화면 폭·조회 불변', async ({ page, backend }) => {
    await startReview(page, backend.store, count, true);
    await page.getByRole('button', { name: '일정 수정', exact: true }).click();
    const row = page.locator('#request-schedule-review-qualification');
    await row.locator('summary').click();
    const before = backend.store.snapshot();
    for (const width of [1920, 1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(row.locator('li')).toHaveCount(count);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.getByRole('button', { name: '전체 계획 확인', exact: true })).toBeEnabled();
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
