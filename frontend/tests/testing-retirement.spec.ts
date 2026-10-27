import { test, expect, actor } from './fixtures';
import { readFile } from 'node:fs/promises';

test('테스트·데이터 메뉴와 실행 복구가 없고 기존 주소·계정·초안·네 폭 탐색을 유지한다', async ({
  page,
  backend,
}, info) => {
  const state = backend.store.snapshot(),
    org = backend.store.organizations.snapshot();
  const before = await Promise.all(
    [backend.store.file, backend.store.organizations.file, backend.store.maintenanceFile].map((p) =>
      readFile(p),
    ),
  );
  const requests: string[] = [],
    errors: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/(testing|system\/master-data)(\/|\?|$)/.test(r.url())) requests.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    sessionStorage.setItem('eks-maintenance-pending', 'old-operation');
    sessionStorage.setItem('ordinary-edit-draft', 'keep-this-input');
  });
  await page.goto('/');
  await actor(page, 'operator-1');
  expect(await page.evaluate(() => sessionStorage.getItem('eks-maintenance-pending'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('ordinary-edit-draft'))).toBe(
    'keep-this-input',
  );
  for (const old of ['/system/testing', '/system/data']) {
    await page.goto(old);
    await expect(page).toHaveURL(/\/system\/organizations$/);
    await expect(page.getByRole('link', { name: '테스트 관리', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '데이터 관리', exact: true })).toHaveCount(0);
    await expect(
      page.locator('input[type=file],.test-environment-banner,.maintenance-result'),
    ).toHaveCount(0);
  }
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.getByLabel('조직 검색').focus();
    await expect(page.getByLabel('조직 검색')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`retired-${width}.png`), fullPage: true });
  }
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  expect(backend.store.snapshot()).toEqual(state);
  expect(backend.store.organizations.snapshot()).toEqual(org);
  expect(
    await Promise.all(
      [backend.store.file, backend.store.organizations.file, backend.store.maintenanceFile].map(
        (p) => readFile(p),
      ),
    ),
  ).toEqual(before);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await actor(page, 'admin-1');
  await page.goto('/system/testing');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel('접속 계정')).toHaveValue('admin-1');
});

test('과거 브라우저 요청은410이며 기존 계정으로 일반 업무를 계속한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  const before = backend.store.snapshot();
  const results = await page.evaluate(async () => {
    const headers = {
      'X-Session-Tab': sessionStorage.getItem('eks-session-tab')!,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'retired-operation',
    };
    return Promise.all(
      [
        '/api/testing/environment/apply',
        '/api/testing/progress/reset',
        '/api/testing/master-reset',
        '/api/system/master-data/import',
      ].map(async (url) => {
        const r = await fetch(url, { method: 'POST', headers, body: '{invalid JSON' });
        return { status: r.status, ...(await r.json()) };
      }),
    );
  });
  expect(results.every((r) => r.status === 410 && r.code === 'FEATURE_REMOVED')).toBeTruthy();
  expect(backend.store.snapshot()).toEqual(before);
  await page.goto('/system/users');
  await expect(page.getByRole('heading', { name: '사용자 관리', exact: true })).toBeVisible();
  await actor(page, 'learner-1');
  await page.goto('/qualifications');
  await expect(page.getByRole('heading', { name: '학습', exact: true })).toBeVisible();
  await expect(page.locator('.test-environment-banner,.maintenance-result')).toHaveCount(0);
});
