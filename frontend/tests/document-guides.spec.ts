import { test, actor, expect } from './fixtures';

test('학습자·운영 상세 안내, 독립 헤더와 옛 주소, 네 폭·그림·목차·읽기 전용', async ({
  page,
  backend,
}, info) => {
  test.setTimeout(90000);
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  const org = backend.store.organizations.snapshot();
  const writes: string[] = [],
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().includes('/api/') && !['GET', 'HEAD'].includes(r.method())) writes.push(r.url());
  });
  await page.getByRole('link', { name: '문서 조회', exact: true }).click();
  await expect(page.locator('.document-row')).toHaveCount(4);
  await expect(page.locator('.admin-sidebar')).toHaveCount(0);
  await page.goto('/system/documents/learner-certification-guide?q=학습자#doc-1-먼저-알아둘-기준');
  await expect(page).toHaveURL(/\/documents\/learner-certification-guide\?q=.*#doc-1-/);
  await expect(page.locator('#doc-1-먼저-알아둘-기준')).toBeFocused();
  for (const [id, count, text] of [
    ['learner-certification-guide', 1, '마지막 필수 평가를 통과하기 전에'],
    ['system-operations-guide', 2, 'deactive 기간만큼 인증 유효기간을 늘리지 않는다.'],
  ] as const) {
    await page.goto(`/documents/${id}`);
    await expect(page.locator('.document-diagram-canvas svg')).toHaveCount(count, {
      timeout: 30000,
    });
    await expect(page.locator('.document-diagram-error')).toHaveCount(0);
    await expect(page.locator('.document-markdown')).toContainText(text);
    await expect(page.locator('.admin-sidebar, #system-navigation')).toHaveCount(0);
    for (const width of [1920, 1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const contents = page.getByRole('button', { name: /목차/ });
      await contents.focus();
      await page.keyboard.press('Enter');
      await expect(contents).toHaveAttribute('aria-expanded', 'true');
      await page.getByRole('navigation', { name: '문서 목차' }).getByRole('link').first().click();
      await expect(page.locator('.document-markdown h2').first()).toBeFocused();
      await page.screenshot({ path: info.outputPath(`${id}-${width}.png`) });
      await contents.click();
      await expect(contents).toHaveAttribute('aria-expanded', 'false');
    }
    const source = page.locator('.document-diagram summary').first();
    await source.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.document-diagram details').first()).toHaveAttribute('open', '');
  }
  await page
    .locator('.document-markdown')
    .getByRole('link', { name: '계획 알림부터 자격 인증서까지' })
    .click();
  await expect(page).toHaveURL(/\/documents\/learner-certification-guide$/);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  expect(backend.store.snapshot()).toEqual(before);
  expect(backend.store.organizations.snapshot()).toEqual(org);
});
