import { heroContrast } from './home-helpers';
import { test, expect, actor } from './fixtures';
import type { Page } from '@playwright/test';
import { nodeFor } from '../../server/src/organizations';

const widths = [1920, 1440, 768, 390];
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('네 역할 홈 히어로의 현황·KST 날짜·실제 배경 대비와 네 화면 폭', async ({
  page,
  backend,
}, info) => {
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'hero-role',
    () => {},
    (s) => {
      const u = s.users.find((u) => u.id === 'learner-2')!;
      u.organizationAdministration = {
        organizationId: u.organizationId,
        grantedBy: 'operator-1',
        grantedAt: new Date().toISOString(),
      };
      return {};
    },
  );
  const revision = backend.store.snapshot().revision;
  await page.clock.setFixedTime(new Date('2026-10-22T15:05:00Z'));
  await page.goto('/');
  const contrast: unknown[] = [];
  for (const id of ['learner-1', 'admin-1', 'operator-1', 'learner-2']) {
    await actor(page, id);
    const hero = page.locator('.home-hero');
    await expect(hero.locator('a')).toHaveCount(3);
    const values = await hero.locator('.stat-value').allTextContents();
    const links = await hero
      .locator('a')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(links).toHaveLength(3);
    await expect(hero.locator('.home-date')).toHaveText('2026년 10월 23일 금요일');
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
      await expect(hero.locator('h1')).toHaveCSS('font-size', '24px');
      await expect(hero.locator('.organization-path')).toHaveCSS('font-size', '14px');
      for (const value of await hero.locator('.stat-value').all())
        await expect(value).toHaveCSS('font-size', '24px');
      await expect(hero.locator('.stat-value')).toHaveText(values);
      const boxes = await hero.locator('a').evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, height: r.height };
        }),
      );
      expect(boxes.every((b) => b.height >= 44)).toBe(true);
      if (width < 768) expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
      else expect(boxes[0]!.y).toBe(boxes[2]!.y);
      if (width === 1920) {
        expect((await hero.boundingBox())!.height).toBeLessThanOrEqual(
          id === 'learner-2' ? 304 : 264,
        );
        for (const name of ['시스템 공지', '내 팀 공지'])
          await expect(page.getByRole('heading', { name, exact: true })).toBeInViewport();
      }
      contrast.push({ id, width, ...(await heroContrast(page)) });
      if (id === 'learner-1')
        await page.screenshot({ path: info.outputPath(`home-${width}.png`), fullPage: true });
    }
    await hero.locator('a').first().focus();
    await expect(hero.locator('a').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new URL(links[0]!, page.url()).href);
    await page.goto('/');
  }
  await info.attach('rendered-gradient-contrast', {
    body: JSON.stringify(contrast, null, 2),
    contentType: 'application/json',
  });
  expect(backend.store.snapshot().revision).toBe(revision);
});

test('긴 개인·조직 정보와 0건·Hold 상태를 자르지 않고 분리 표시', async ({
  page,
  backend,
}, info) => {
  const user = backend.store.snapshot().users.find((u) => u.id === 'learner-2')!;
  await backend.store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    'hero-long-org',
    () => {},
    (doc) => {
      nodeFor(doc.roots, user.organizationId)!.name =
        '공정 운영과 설비 품질의 최소 직무 요건을 검증하는 상세 조직 '.repeat(4);
      return {};
    },
  );
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'hero-hold',
    () => {},
    (s) => {
      const u = s.users.find((u) => u.id === user.id)!;
      u.name = '긴 이름의 검증 참여자 '.repeat(4);
      u.certificationEligibility = 'hold';
      return {};
    },
  );
  await page.goto('/');
  await actor(page, user.id);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    const hero = page.locator('.home-hero');
    await expect(hero.locator('.stat-value').first()).toHaveText('0');
    await expect(hero).not.toContainText('취득 대상자 Hold');
    const warning = page.getByText('취득 대상자 Hold ·', { exact: false });
    await expect(warning).toBeVisible();
    expect((await warning.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await hero.boundingBox())!.y + (await hero.boundingBox())!.height,
    );
    const title = hero.locator('h1');
    const org = hero.locator('.organization-path');
    expect((await org.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await title.boundingBox())!.y + (await title.boundingBox())!.height,
    );
    if (width === 390)
      await page.screenshot({ path: info.outputPath('long-hold-390.png'), fullPage: true });
  }
});

test('프로세스 검토의 정보 위계·단계 배치·키보드·화면 및 단계 변경 접힘', async ({
  page,
}, info) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  const guide = page.getByTestId('process-guide');
  const toggle = guide.getByRole('button');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#process-guide-content')).toBeVisible();
    await expect(guide.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(guide.locator('[aria-current="step"]')).toContainText('현재');
    await expect(guide.locator('h3')).toHaveCSS('font-size', '18px');
    for (const h of await guide.locator('h4').all()) await expect(h).toHaveCSS('font-size', '16px');
    await expect(guide.locator('.process-current p')).toHaveCSS('font-size', '14px');
    await expect(guide.locator('.process-guide-meta')).toHaveCSS('font-size', '12px');
    await expect(guide.locator('.process-guide-meta')).toContainText('v13 · 2026-10-23');
    const cols = await guide
      .locator('.process-steps')
      .evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(width >= 1024 ? 6 : width >= 768 ? 3 : 2);
    await noOverflow(page);
    await guide.screenshot({ path: info.outputPath(`process-${width}.png`) });
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  }
  await toggle.click();
  await page.getByRole('link', { name: '내 계획', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.goto('/qualifications/assignment-1/courses/demo-course-2/objective');
  await expect(page.locator('.choice input').first()).toBeEnabled();
  for (const radio of await page.locator('.choice input').all()) {
    await radio.check();
    break;
  }
  await page.getByRole('button', { name: '다음 문항', exact: true }).click();
  await page.locator('.choice input').first().check();
  await toggle.click();
  await page.getByRole('button', { name: /^답안 확인(?:으로 돌아가기)?$/ }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await actor(page, 'admin-1');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
