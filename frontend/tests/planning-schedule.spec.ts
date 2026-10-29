import { test, expect, actor, answerConfirmation } from './fixtures';
import { requestPlan } from './workflow-helpers';
import { linkFixtureTemplates } from '../../server/tests/template-helpers';
import { appendQualification } from '../../server/src/releases';
import type { Page } from '@playwright/test';
import type { JsonStore } from '../../server/src/storage';

async function start(
  page: Page,
  backend: { store: JsonStore; setClock: (v: string) => void },
  count = 2,
) {
  backend.setClock('2026-10-26T01:00:00.000Z');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      for (let i = 1; i < count; i++)
        s.qualifications.push({
          ...structuredClone(q),
          id: `request-schedule-${i}`,
          entityId: `request-schedule-${i}`,
          title: `일정 자격 ${i}${count > 2 ? ' 긴 이름을 가진 설비 운영 자격'.repeat(4) : ''}`,
          planningDeadlineMonths: 1,
        });
      linkFixtureTemplates(s);
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await expect(page.getByRole('heading', { name: '자격 일정 수립', exact: true })).toBeVisible();
  await expect(page.locator('.request-schedule-row')).toHaveCount(count);
}
const row = (page: Page, index = 0) => page.locator('.request-schedule-row').nth(index);
async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: '저장됨' })).toBeVisible();
}

test('필요자격 전체·조회 무변경·일괄 초과 보류/취소·개별 수정·전체 확정', async ({
  page,
  backend,
}) => {
  await start(page, backend);
  expect(backend.store.snapshot().plans).toHaveLength(0);
  await page.getByLabel('일괄 시작일', { exact: true }).fill('2026-11-01');
  await page.getByLabel('일괄 완료일', { exact: true }).fill('2026-11-27');
  await page.getByRole('button', { name: '전체 적용', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('2026-11-26');
  expect(backend.store.snapshot().plans).toHaveLength(0);
  await expect(row(page).getByLabel('완료일', { exact: true })).toHaveValue('2026-11-23');
  await page.getByLabel('일괄 완료일', { exact: true }).fill('2026-11-26');
  await page.getByRole('button', { name: '전체 적용', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(row(page).getByLabel('완료일', { exact: true })).toHaveValue('2026-11-23');
  await page.getByRole('button', { name: '전체 적용', exact: true }).click();
  await answerConfirmation(page, true);
  await saved(page);
  await expect.poll(() => backend.store.snapshot().plans.length).toBe(2);
  await row(page).getByLabel('완료일', { exact: true }).fill('2026-12-01');
  await row(page).locator('summary').click();
  await row(page).getByLabel('학습 목표(선택)').fill('개별 목표 유지');
  await saved(page);
  await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '전체 계획 최종 확인', exact: true }),
  ).toBeFocused();
  await expect(page.locator('.request-schedule-review')).toContainText('개별 목표 유지');
  await page.getByRole('button', { name: '전체 계획 확정', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '전체 계획 확정 완료', exact: true }),
  ).toBeVisible();
  const s = backend.store.snapshot();
  expect(s.plans.every((p) => p.status === 'completed')).toBeTruthy();
  expect(s.planningRequests[0]!.completion!.evidence).toHaveLength(2);
  await page.getByRole('link', { name: '계획 상세', exact: true }).first().click();
  await expect(page.locator('.plan-review-summary')).toContainText('2026.12.01');
});

test('미완성 저장·오류 초점·재접속·초안 링크와 최신 기준 재확인', async ({ page, backend }) => {
  await start(page, backend);
  await row(page).getByLabel('완료일', { exact: true }).fill('');
  await saved(page);
  await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
  await expect(row(page).getByLabel('완료일', { exact: true })).toBeFocused();
  const p = backend.store.snapshot().plans[0]!;
  await page.goto(`/plans/${p.id}`);
  await expect(page).toHaveURL(/\/plans\?request=/);
  await expect(row(page).getByLabel('완료일', { exact: true })).toHaveValue('');
  await row(page).getByLabel('완료일', { exact: true }).fill('2026-12-01');
  await saved(page);
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      appendQualification(s, q, { ...q, planningDeadlineMonths: 1 }, 'admin-1', '기한 변경');
      return {};
    },
  );
  await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '최신 기준 확인' })).toBeVisible();
  await page.getByRole('button', { name: '최신 기준 확인' }).click();
  await answerConfirmation(page, false);
  await expect(row(page).getByLabel('완료일', { exact: true })).toHaveValue('2026-12-01');
  await page.getByRole('button', { name: '최신 기준 확인' }).click();
  await answerConfirmation(page, true);
  await saved(page);
  await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
  await expect(row(page).getByLabel('완료일', { exact: true })).toBeFocused();
  await expect(row(page)).toContainText('2026-11-26 이내');
});

test('응답 유실 재시도·동시 수정의 내 입력 유지·확정 실패 후 중복 없음', async ({
  page,
  backend,
}) => {
  await start(page, backend);
  const request = backend.store.snapshot().planningRequests[0]!;
  let once = true;
  await page.route(`**/api/planning-requests/${request.id}/schedule`, async (r) => {
    if (r.request().method() === 'PUT' && once) {
      once = false;
      await r.fetch();
      await r.abort('failed');
    } else await r.continue();
  });
  await row(page).getByLabel('완료일', { exact: true }).fill('2026-12-01');
  await expect(page.getByRole('button', { name: '저장 재시도', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '저장 재시도', exact: true }).click();
  await saved(page);
  expect(backend.store.snapshot().plans).toHaveLength(1);
  await backend.store.transact(
    'learner-2',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      s.plans[0]!.endOn = '2026-12-02';
      s.plans[0]!.revision++;
      return {};
    },
  );
  await row(page).getByLabel('완료일', { exact: true }).fill('2026-12-03');
  await expect(page.getByRole('button', { name: '변경된 저장 내용 확인' })).toBeVisible();
  await page.getByRole('button', { name: '변경된 저장 내용 확인' }).click();
  await expect(page.getByTestId('app-confirmation')).toContainText('2026-12-02');
  await answerConfirmation(page, true);
  await expect(row(page).getByLabel('완료일', { exact: true })).toHaveValue('2026-12-03');
  await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '전체 계획 최종 확인', exact: true }),
  ).toBeVisible();
  backend.store.beforeReplace = async () => {
    throw Error('forced failure');
  };
  await page.getByRole('button', { name: '전체 계획 확정', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('저장하지 못');
  expect(backend.store.snapshot().plans.every((p) => p.status === 'draft')).toBeTruthy();
  backend.store.beforeReplace = undefined;
  await page.getByRole('button', { name: '전체 확정 재시도', exact: true }).click();
  await expect(page.getByRole('heading', { name: '전체 계획 확정 완료' })).toBeVisible();
  expect(backend.store.snapshot().plans).toHaveLength(2);
});

test('여러 자격과 긴 이름·네 해상도·키보드·가로 넘침 없음', async ({ page, backend }) => {
  await start(page, backend, 12);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.request-schedule-row')).toHaveCount(12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({
      path: test.info().outputPath(`request-schedule-${width}.png`),
      fullPage: true,
    });
  }
  await row(page).getByLabel('시작일', { exact: true }).focus();
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => document.activeElement?.closest('.request-schedule-row') !== null),
  ).toBeTruthy();
  expect(backend.store.snapshot().plans).toHaveLength(0);
});

test('자격 최대 개월 필수·상한·마이너 저장·상세 조회와 학습자 기한', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification/edit');
  const months = page.getByLabel('계획 확정 후 최대 완료 개월', { exact: true });
  await expect(months).toHaveValue('6');
  for (const value of ['', '0', '1201', '1.5']) {
    await months.fill(value);
    await expect(page.getByRole('button', { name: '저장', exact: true })).toBeDisabled();
  }
  await months.fill('1');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '기준 저장 확인' });
  await expect(dialog).toContainText('v1.0 → v1.1');
  await expect(dialog).toContainText('계획 최대 완료');
  await dialog.getByRole('button', { name: '새 버전 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '팀 자격 설정', exact: true })).toBeVisible();
  const latest = backend.store
    .snapshot()
    .qualifications.filter((q) => q.entityId === 'demo-qualification')
    .at(-1)!;
  expect(latest.planningDeadlineMonths).toBe(1);
  await page.goto('/admin/qualifications/' + latest.id);
  await expect(page.getByText('계획 확정 후 최대 완료 개월: 1개월')).toBeVisible();
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await expect(page.locator('.request-schedule-window')).toContainText('최대 1개월');
});
