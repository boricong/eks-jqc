import { requestPlan, completePlan, practicalOnly, qualificationPolicy } from './workflow-helpers';
import type { Page } from '@playwright/test';
import { test, expect, actor } from './fixtures';
import path from 'node:path';
const imagePath = (name: string) => test.info().outputPath(`${name}-1920x900.png`);
async function navigate(page: Page, href: string) {
  await page.evaluate((href) => {
    const a = document.createElement('a');
    a.href = href;
    a.id = 'test-navigation';
    document.body.appendChild(a);
  }, href);
  await page.locator('#test-navigation').evaluate((el) => {
    history.pushState({}, '', (el as HTMLAnchorElement).href);
    window.dispatchEvent(new PopStateEvent('popstate'));
    el.remove();
  });
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(10, 10);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: imagePath(name), fullPage: false });
}
async function noOverflow(page: Page) {
  const audit = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 15)
      .map((el) => ({
        tag: el.tagName,
        cls: el.className,
        right: el.getBoundingClientRect().right,
      })),
  }));
  expect(audit.scroll, JSON.stringify(audit)).toBeLessThanOrEqual(audit.width);
}

test('1920×900 화면 구성과 독립 메뉴', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await actor(page, 'learner-1');
  await expect(page.getByRole('heading', { name: '김민서 님', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '시스템 공지', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '내 팀 공지', exact: true })).toBeVisible();
  await expect(page.getByTestId('process-guide')).toBeVisible();
  await noOverflow(page);
  await screenshot(page, 'home');
  await page.getByRole('button', { name: '검증용 인증 안내' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: '상세정보 보기' }).click();
  await expect(page.getByRole('region', { name: '학습 안내' })).toBeVisible();
  await page.getByRole('link', { name: '평가하기', exact: true }).click();
  await expect(page.locator('.course-workspace')).toContainText('통과 유지');
  await expect(page.getByRole('link', { name: '다시 응시' })).toBeVisible();
  await screenshot(page, 'qualification');
  await page.getByRole('button', { name: /02 기록 작성/ }).click();
  await page.getByRole('link', { name: '평가하기', exact: true }).click();
  await page.getByRole('link', { name: '응시하기', exact: true }).first().click();
  await screenshot(page, 'objective');
  await actor(page, 'admin-1');
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '인증 현황', exact: true })).toBeVisible();
  await screenshot(page, 'admin');
  await page.getByRole('link', { name: '인증Set 관리', exact: true }).click();
  await screenshot(page, 'admin-courses');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('작은 화면과 키보드 접근', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    await expect(page.getByRole('heading', { name: '시스템 공지', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '내 팀 공지', exact: true })).toBeVisible();
  }
  await page.getByRole('link', { name: '상세정보 보기' }).click();
  await expect(page.getByRole('region', { name: '학습 안내' })).toBeVisible();
  await page.getByRole('link', { name: '평가하기', exact: true }).click();
  await noOverflow(page);
  await page.getByRole('link', { name: '다시 응시' }).click();
  await noOverflow(page);
  await page.getByRole('button', { name: '학습자료', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await actor(page, 'admin-1');
  await page.getByRole('button', { name: '메뉴', exact: true }).click();
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  await noOverflow(page);
  await page.setViewportSize({ width: 1920, height: 900 });
  await actor(page, 'learner-1');
  await navigate(page, '/admin/qualifications');
  await expect(page.getByRole('heading', { name: '김민서 님', exact: true })).toBeVisible();
});
