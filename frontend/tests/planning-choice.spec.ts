import { test, expect, actor, answerConfirmation } from './fixtures';
import { completePlan, requestPlan } from './workflow-helpers';
import { legacyRequestFixture } from '../../server/tests/legacy-request-fixture';
async function start(page: any, backend: any) {
  await legacyRequestFixture(backend.store, 'admin-1', {
    learnerIds: ['learner-2'],
    message: '보존된 선택형 요청 검증',
  });
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.goto('/plans');
}
test('필수 0개 추가 자격·최소 계획·선택과 초안 원자 저장·재시작', async ({ page, backend }) => {
  await start(page, backend);
  await expect(page.locator('.request-schedule-row')).toHaveCount(0);
  await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('최소 1개');
  expect(backend.store.snapshot().plans).toHaveLength(0);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await completePlan(page, '평가 흐름 체험', false);
  expect(backend.store.snapshot().planningRequests[0]!.completion?.evidence).toHaveLength(1);
  await backend.restart();
  await page.reload();
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await expect(page.getByRole('heading', { name: '전체 계획 확정 완료' })).toBeVisible();
});
test('이전 선택만 있는 자격 제외·초안 삭제 취소·삭제 후 다시 추가', async ({ page, backend }) => {
  await start(page, backend);
  await backend.store.transact(
    'learner-2',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      s.planningRequests[0]!.selections = [
        { entityId: q.entityId, qualificationId: q.id, title: q.title, version: q.version! },
      ];
      return {};
    },
  );
  await page.reload();
  await page.getByRole('button', { name: '추가 계획 제외' }).click();
  await answerConfirmation(page, true);
  await expect(page.locator('.request-schedule-row')).toHaveCount(0);
  expect(backend.store.snapshot().planningRequests[0]!.selections).toHaveLength(0);
  await page.getByRole('button', { name: '계획에 추가' }).first().click();
  await expect.poll(() => backend.store.snapshot().plans.length).toBe(1);
  await page.getByRole('button', { name: '추가 계획 제외' }).click();
  await answerConfirmation(page, false);
  await expect(page.locator('.request-schedule-row')).toHaveCount(1);
  await page.getByRole('button', { name: '추가 계획 제외' }).click();
  await answerConfirmation(page, true);
  await expect(page.locator('.request-schedule-row')).toHaveCount(0);
  expect(backend.store.snapshot().plans[0]!.deletedAt).toBeTruthy();
  await page.getByRole('button', { name: '계획에 추가' }).first().click();
  await expect
    .poll(() => backend.store.snapshot().plans.filter((p) => !p.deletedAt).length)
    .toBe(1);
});
test('이미 진행 중인 자격만 있는 요청은 추가 대상 없음 확인으로 완료', async ({
  page,
  backend,
}) => {
  await start(page, backend);
  await completePlan(page, '평가 흐름 체험', false);
  await actor(page, 'admin-1');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
  await page.getByRole('button', { name: '추가 계획 대상 없음 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '전체 계획 확정 완료' })).toBeVisible();
  expect(backend.store.snapshot().plans).toHaveLength(1);
  expect(backend.store.snapshot().planningRequests.at(-1)!.completion).toBeTruthy();
});
test('세부 관리자 선택 사항·검색·빈 저장·다른 조직 노출 제한과 네 화면 폭', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'learner-2')!.organizationAdministration = {
        organizationId: 'org-photo',
        grantedBy: 'admin-1',
        grantedAt: new Date().toISOString(),
      };
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.goto('/admin/organization-settings');
  await expect(page.getByRole('treeitem')).toHaveCount(20);
  await expect(page.getByText('필수 자격 · 선택 사항', { exact: true })).toHaveCount(0);
  await page.getByLabel('조직 설명', { exact: true }).fill('직속 조직 설명');
  await page.getByLabel('담당 업무', { exact: true }).fill('직속 조직 업무');
  await page.getByRole('button', { name: '조직 설정 변경 확인' }).click();
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: test.info().outputPath(`optional-policy-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByLabel('조직 설명', { exact: true }).fill('');
  await page.getByRole('button', { name: '조직 설정 변경 확인' }).click();
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
