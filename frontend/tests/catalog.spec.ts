import { answerConfirmation } from './fixtures';
import { test, expect, actor } from './fixtures';
import { exportCatalog } from '../../server/src/catalog';
import { writeCatalogWorkbook, readCatalogWorkbook } from '../../server/src/catalog-workbook';
import { readFile } from 'node:fs/promises';
import type { CatalogWorkbook } from '@eks/contracts';
async function overflow(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => innerWidth),
  );
}

test('밝은 역할별 홈·관리 목록 밀도·오른쪽 사용자 패널·반응형', async ({ page, backend }) => {
  await backend.store.transact(
    'operator-1',
    'density-fixture',
    'density-fixture',
    () => {},
    (s) => {
      const c = s.courses[0]!;
      for (let i = 0; i < 75; i++)
        s.courses.push({
          ...c,
          id: `density-${i}`,
          entityId: `density-${i}`,
          title: `밀도 확인 ${i}`,
        });
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  await expect(page.locator('.home-columns')).toBeVisible();
  expect(await page.locator('body').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
    'rgb(255, 255, 255)',
  );
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await overflow(page);
    await expect(page.getByRole('link', { name: '상세정보 보기', exact: true })).toBeVisible();
    if (width === 1920)
      await page.screenshot({ path: test.info().outputPath('light-learner-home.png') });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  await actor(page, 'admin-1');
  await page.goto('/admin/courses');
  const height = await page
    .locator('.table-panel tbody tr')
    .first()
    .evaluate((e) => e.getBoundingClientRect().height);
  expect(height).toBe(40);
  expect(
    await page.locator('.table-panel tbody tr').evaluateAll(
      (rows) =>
        rows.filter((r) => {
          const b = r.getBoundingClientRect();
          return b.top > 0 && b.bottom < innerHeight;
        }).length,
    ),
  ).toBeGreaterThanOrEqual(14);
  await page.getByLabel('목록 밀도').selectOption('roomy');
  expect(
    await page
      .locator('.table-panel tbody tr')
      .first()
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBe(48);
  await page.reload();
  await expect(page.getByLabel('목록 밀도')).toHaveValue('roomy');
  await actor(page, 'operator-1');
  await page.goto('/system/users');
  await page.getByRole('button', { name: '김민서 수정', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const drawer = await page.getByRole('dialog').boundingBox();
  expect(drawer!.x).toBeGreaterThan(1300);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('평가 10,000행 표는 가상 렌더링하고 편집에 응답한다', async ({ page, backend }) => {
  const data = exportCatalog(backend.store.snapshot(), 'org-photo', ['demo-qualification']),
    sheet = data.sheets[0]!;
  const c = sheet.tables.courses[0]!,
    q = sheet.tables.objective[0]!;
  sheet.tables.courses = Array.from({ length: 20 }, (_, i) => ({
    ...c,
    code: `C${i}`,
    order: i + 1,
    sourceId: '',
    sourceRevision: null,
    kinds: 'objective',
  }));
  sheet.tables.learning = sheet.tables.courses.map((c) => ({
    courseCode: c.code,
    code: 'L1',
    order: 1,
    type: 'ojt',
    title: '학습',
    required: true,
  }));
  sheet.tables.practical = [];
  sheet.tables.materials = [];
  sheet.tables.objective = sheet.tables.courses.flatMap((c) =>
    Array.from({ length: 500 }, (_, i) => ({
      ...q,
      courseCode: c.code,
      code: `Q${i}`,
      order: i + 1,
    })),
  );
  const buffer = await writeCatalogWorkbook(data);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/catalog');
  await page.locator('input[type=file]').setInputFiles({
    name: 'large.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });
  await page.getByRole('button', { name: '전체 인증Set 표 보기', exact: true }).click();
  await expect(page.getByRole('tab', { name: '지식 평가 10000', exact: true })).toBeVisible();
  const at = Date.now();
  await page.getByRole('tab', { name: '지식 평가 10000', exact: true }).click();
  await expect(page.locator('.tabulator-row').first()).toBeVisible();
  expect(Date.now() - at).toBeLessThan(5000);
  expect(await page.locator('.tabulator-row').count()).toBeLessThan(150);
  const cell = page.locator('.tabulator-row').first().locator('[tabulator-field=points]');
  await cell.scrollIntoViewIfNeeded();
  await cell.dblclick();
  await cell.locator('input').fill('2');
  await cell.locator('input').press('Enter');
  await expect(cell).toHaveText('2');
});
test('Excel 가져오기→표 셀 편집→변경 비교→선택 기준 저장→다운로드 왕복', async ({
  page,
  backend,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await actor(page, 'admin-1');
  const data = exportCatalog(backend.store.snapshot(), 'org-photo', ['demo-qualification']);
  data.sheets[0]!.renewalLeadMonths = 4;
  const buffer = await writeCatalogWorkbook(data);
  await page.goto('/admin/catalog');
  await page.locator('input[type=file]').setInputFiles({
    name: 'catalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });
  await page.getByRole('button', { name: '전체 인증Set 표 보기', exact: true }).click();
  await expect(page.locator('.tabulator')).toBeVisible();
  const cell = page.locator('.tabulator-row').first().locator('[tabulator-field=title]');
  await cell.dblclick();
  await cell.locator('input').fill('엑셀 수정 인증Set');
  await cell.locator('input').press('Enter');
  await expect(
    page.getByText('서버 저장 전 수정 내용이 있습니다.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: '변경 검토 후 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('개정');
  await page.getByRole('button', { name: '선택 기준 저장', exact: true }).click();
  await expect(page.locator('.catalog-history')).toContainText('기준 저장');
  const draft = backend.store
    .snapshot()
    .qualifications.find((q) => q.entityId === 'demo-qualification' && q.version === 2)!;
  expect('status' in draft).toBe(false);
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '작업 파일 다운로드', exact: true }).last().click();
  const download = await downloadPromise;
  const path = await download.path();
  const parsed = await readCatalogWorkbook(await readFile(path!));
  expect(parsed.workbook.sheets.some((q) => q.renewalLeadMonths === 4)).toBe(true);
  expect(errors).toEqual([]);
});
test('표 범위 붙여넣기·오류 이동·미저장 전환 보호와 좁은 화면', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/catalog');
  await page.getByTestId('catalog-qualification-demo-qualification').getByRole('button').click();
  await page.getByRole('button', { name: '전체 인증Set 표 보기', exact: true }).click();
  const grid = page.locator('.tabulator');
  await expect(grid).toBeVisible();
  const cell = grid.locator('.tabulator-row').first().locator('[tabulator-field=title]');
  await cell.click();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('붙여넣은 인증Set명'));
  await page.keyboard.press('ControlOrMeta+V');
  await expect(cell).toContainText('붙여넣은 인증Set명');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(cell).toContainText('자료 확인');
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect(cell).toContainText('붙여넣은 인증Set명');
  await grid.locator('.tabulator-row').first().locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: '선택 항목 제외', exact: true }).click();
  await page.getByRole('button', { name: '함께 제외', exact: true }).click();
  await expect(page.getByRole('tab', { name: '지식 평가 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.getByRole('tab', { name: '지식 평가 4', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '개별 기준 관리', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(page).toHaveURL(/admin\/catalog/);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await overflow(page);
    await expect(
      page.getByRole('button', { name: '변경 검토 후 저장', exact: true }),
    ).toBeVisible();
    if (width === 1920) await page.screenshot({ path: test.info().outputPath('catalog-grid.png') });
  }
  await page.getByRole('tab', { name: /지식 평가/ }).click();
  await expect(page.locator('[tabulator-field=prompt]').first()).toBeVisible();
  await page.setViewportSize({ width: 1920, height: 900 });
  const correct = page.locator('.tabulator-row').first().locator('[tabulator-field=correct]');
  await correct.scrollIntoViewIfNeeded();
  await correct.dblclick();
  await correct.locator('input').fill('99');
  await correct.locator('input').press('Enter');
  await page.getByRole('button', { name: '변경 검토 후 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '선택 기준 저장', exact: true })).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await page
    .locator('.bulk-issues button')
    .filter({ hasText: '정답 번호를 입력된 선택지 범위로' })
    .first()
    .click();
  await expect(page.locator('.catalog-error-cell')).toBeFocused();
});
