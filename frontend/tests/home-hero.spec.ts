import { test, expect, actor } from './fixtures';
import type { Page } from '@playwright/test';
import { nodeFor } from '../../server/src/organizations';

const widths = [1920, 1440, 768, 390];
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

// Sample the rendered SVG behind every text run, rather than assuming a solid background.
async function heroContrast(page: Page) {
  const hero = page.locator('.home-hero');
  await page.evaluate(() => document.fonts.ready);
  const samples = await hero.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    const result: { x: number; y: number; color: string; minimum: number }[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const color = getComputedStyle(node.parentElement!).color;
      for (const r of range.getClientRects()) {
        for (let y = r.top + 1; y < r.bottom; y += 3)
          for (let x = r.left + 1; x < r.right; x += 3)
            result.push({ x: x - bounds.x, y: y - bounds.y, color, minimum: 4.5 });
      }
    }
    for (const a of el.querySelectorAll<HTMLElement>('.stat-item')) {
      const r = a.getBoundingClientRect();
      const color = getComputedStyle(el).getPropertyValue('--primary-press').trim();
      for (let x = r.left - 4; x <= r.right + 4; x += 4)
        for (const y of [r.top - 4, r.bottom + 4])
          result.push({ x: x - bounds.x, y: y - bounds.y, color, minimum: 3 });
    }
    return result;
  });
  const hide = await page.addStyleTag({
    content:
      '.home-hero * { color: transparent !important; text-shadow: none !important; outline: none !important; } .home-hero svg { visibility: hidden !important; }',
  });
  let png: Buffer;
  try {
    png = await hero.screenshot();
  } finally {
    await hide.evaluate((el) => el.parentNode?.removeChild(el));
  }
  const ratios = await page.evaluate(
    async ({ image, samples }) => {
      const img = new Image();
      img.src = image;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
      const luminance = (rgb: number[]) =>
        rgb
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const minima = { text: 100, focus: 100 };
      for (const s of samples) {
        const x = Math.max(0, Math.min(img.width - 1, Math.round(s.x)));
        const y = Math.max(0, Math.min(img.height - 1, Math.round(s.y)));
        const i = (y * img.width + x) * 4;
        const bg = luminance([pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]);
        const rgb = s.color.startsWith('#')
          ? s.color
              .slice(1)
              .match(/../g)!
              .map((v) => parseInt(v, 16))
          : s.color
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number);
        const fg = luminance(rgb);
        const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        const key = s.minimum === 4.5 ? 'text' : 'focus';
        minima[key] = Math.min(minima[key], ratio);
      }
      return minima;
    },
    { image: `data:image/png;base64,${png!.toString('base64')}`, samples },
  );
  expect(ratios.text).toBeGreaterThanOrEqual(4.5);
  expect(ratios.focus).toBeGreaterThanOrEqual(3);
  return ratios;
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
        expect((await hero.boundingBox())!.height).toBeLessThanOrEqual(240);
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
    await expect(page).toHaveURL(new RegExp(links[0]!.replaceAll('/', '\\/')));
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
  await page.getByRole('button', { name: '제출', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await actor(page, 'admin-1');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
