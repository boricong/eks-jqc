import type { Page } from '@playwright/test';
import { test, expect, actor } from './fixtures';
import { requestPlan } from './workflow-helpers';
async function start(page: Page) {
  await page.goto('/');
  await actor(page, 'admin-1');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await expect(page.getByRole('heading', { name: '자격 일정 수립', exact: true })).toBeVisible();
}
async function singleStyle(page: Page) {
  await expect(page.getByLabel('화면 테마')).toHaveCount(0);
  expect(await page.locator('html').evaluate((e) => getComputedStyle(e).colorScheme)).toBe('light');
  expect(await page.locator('body').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
    'rgb(255, 255, 255)',
  );
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => innerWidth),
  );
}
test('과거 다크 설정·계정 전환·새로고침·다른 탭에도 단일 스타일을 적용한다', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('eks-theme:learner-1', 'dark');
    sessionStorage.setItem('eks-theme-actor', 'learner-1');
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  await singleStyle(page);
  const other = await context.newPage();
  await other.goto('/');
  await actor(other, 'ft-1');
  await singleStyle(other);
  await page.evaluate(() => {
    localStorage.setItem('eks-theme:ft-1', 'dark');
  });
  await singleStyle(other);
  await actor(page, 'admin-1');
  await singleStyle(page);
  await page.reload();
  await singleStyle(page);
  expect(await page.evaluate(() => localStorage.getItem('eks-theme:learner-1'))).toBe('dark');
  await other.close();
});
test('테마 저장소 접근 실패에도 단일 밝은 스타일로 시작한다', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('eks-theme')) throw new DOMException('Blocked', 'SecurityError');
      return get.call(this, key);
    };
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  await singleStyle(page);
  await page.reload();
  await singleStyle(page);
});

test('모든 역할 주요 화면의 단일 디자인·텍스트와 조작 경계 대비', async ({ page }) => {
  await page.goto('/');
  for (const id of ['learner-1', 'ft-1', 'admin-1', 'operator-1']) {
    await actor(page, id);
    for (const theme of ['single'] as const) {
      await singleStyle(page);
      await page.screenshot({ path: test.info().outputPath(`${id}-${theme}-home.png`) });
      await noOverflow(page);
      const checks = await page.evaluate(() => {
        const probe = document.createElement('div');
        document.body.appendChild(probe);
        const color = (token: string) => {
          probe.style.color = `var(${token})`;
          return getComputedStyle(probe).color;
        };
        const l = (value: string) => {
          const a = (value.match(/[\d.]+/g) || [])
            .slice(0, 3)
            .map((n) => Number(n) / 255)
            .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
          return a[0]! * 0.2126 + a[1]! * 0.7152 + a[2]! * 0.0722;
        };
        const ratio = (a: string, b: string) => {
          const x = l(color(a)),
            y = l(color(b));
          return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
        };
        const text = [
          ['--ink', '--canvas'],
          ['--ink', '--surface'],
          ['--ink-secondary', '--surface'],
          ['--link', '--surface'],
          ['--on-primary', '--primary'],
          ['--toast-ink', '--toast-bg'],
          ...['success', 'warning', 'danger', 'info', 'certified'].map((v) => [
            `--${v}`,
            `--${v}-bg`,
          ]),
        ].map(([a, b]) => ({ a, b, ratio: ratio(a!, b!) }));
        const controls = ['--surface', '--canvas', '--tint'].flatMap((b) =>
          ['--control-border', '--selection-border'].map((a) => ({ a, b, ratio: ratio(a, b) })),
        );
        probe.remove();
        return { text, controls };
      });
      for (const result of checks.text)
        expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(4.5);
      for (const result of checks.controls)
        expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(3);
    }
    if (id === 'learner-1') await page.goto('/qualifications/assignment-1');
    if (id === 'ft-1') await page.goto('/evaluations');
    if (id === 'admin-1') await page.goto('/admin/courses/demo-course-1');
    if (id === 'operator-1') await page.goto('/system/users');
    for (const theme of ['single'] as const) {
      await singleStyle(page);
      for (const width of [1920, 1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await noOverflow(page);
      }
    }
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto('/');
  }
});
