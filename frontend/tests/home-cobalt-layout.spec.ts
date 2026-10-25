import { test, expect, actor } from './fixtures';
import { configureDashboardFixture } from '../../server/tests/dashboard-fixtures';
import { carouselContrast } from './carousel-visual-helpers';
import { writeFile } from 'node:fs/promises';

const frame = '.home-qualification-frame';
test('빈 자격 카드의 코발트·두 버튼 좌우/단일 버튼과 320px 조작·합성 대비', async ({
  page,
  backend,
}, info) => {
  await configureDashboardFixture(backend.store);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'empty-learner',
    () => {},
    (s) => {
      s.users.push({
        id: 'empty-learner',
        name: '보유 자격 없는 학습자',
        roles: ['learner'],
        organizationId: 'org-photo',
        revision: 1,
      });
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'alice');
  const before = backend.store.snapshot();
  const card = page.locator(frame);
  await expect(card).toHaveClass(/empty-state/);
  const metrics = [];
  for (const width of [1920, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(card).toHaveCSS('background-color', 'rgb(232, 240, 255)');
    const actions = card.locator('.home-qualification-empty-actions a');
    await expect(actions).toHaveCount(2);
    const boxes = await actions.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(1);
    expect(boxes[1]!.x - boxes[0]!.x - boxes[0]!.width).toBeCloseTo(12, 0);
    expect(boxes.every((b) => b.height >= 44)).toBe(true);
    if (width < 768) expect(Math.abs(boxes[0]!.width - boxes[1]!.width)).toBeLessThan(1);
    await actions.last().focus();
    const contrast = await carouselContrast(page);
    metrics.push({ width, boxes, contrast });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`empty-${width}.png`), fullPage: true });
  }
  await card.getByRole('link', { name: '인증 보기', exact: true }).click();
  await expect(page).toHaveURL(/filter=certified$/);
  await page.goto('/');
  await card.getByRole('link', { name: '내 계획 확인', exact: true }).click();
  await expect(page).toHaveURL(/\/plans$/);
  expect(backend.store.snapshot()).toEqual(before);
  await page.setViewportSize({ width: 1920, height: 900 });
  await actor(page, 'empty-learner');
  await expect(card.locator('.home-qualification-empty-actions a')).toHaveCount(1);
  await expect(card.getByRole('link', { name: '내 계획 확인', exact: true })).toBeVisible();
  await writeFile(info.outputPath('empty-cobalt-metrics.json'), JSON.stringify(metrics, null, 2));
});

test('공지 하단2열·최신3개·제목/날짜 행과 최근5개·모달/초점·네 화면 폭', async ({
  page,
  backend,
}, info) => {
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'home-notice-layout',
    () => {},
    (s) => {
      s.notices = [];
      for (const scope of ['system', 'team'] as const) {
        for (const day of [1, 4, 2, 3])
          s.notices.push({
            id: `${scope}-${day}`,
            ...(scope === 'team'
              ? { scope: 'team' as const, lv1OrganizationId: 'org-photo' }
              : { scope: 'system' as const }),
            title:
              day === 4
                ? `${scope} 최신 공지 ${'긴 공지 제목입니다. '.repeat(12)}`
                : `${scope} 공지 ${day}`,
            body: `${scope} 공지 본문\n상세 내용입니다.`,
            date: `2026-10-0${day}`,
            published: true,
            revision: 1,
          });
      }
      s.notifications = Array.from({ length: 6 }, (_, index) => ({
        id: `recent-${index}`,
        key: `recent-${index}`,
        type: 'result' as const,
        lv1OrganizationId: 'org-photo',
        recipientId: 'learner-1',
        title: `최근 알림 ${index}`,
        body: '홈에 표시하지 않는 본문',
        href: '/qualifications',
        createdAt: new Date(Date.UTC(2026, 9, 23, 0, index)).toISOString(),
      }));
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  const notices = page.getByRole('region', { name: '홈 공지', exact: true });
  const panels = notices.locator(':scope > section');
  await expect(page.locator('.home-secondary > section h2')).toHaveText(['최근 알림']);
  await expect(page.locator('.home-secondary .home-notification-row')).toHaveCount(5);
  await expect(page.locator('.home-shortcuts')).toHaveCount(0);
  for (const scope of ['system', 'team']) {
    const panel = page.getByRole('region', {
      name: scope === 'system' ? '시스템 공지' : '내 팀 공지',
      exact: true,
    });
    await expect(panel.locator('.notice-row time')).toHaveText([
      '2026.10.04',
      '2026.10.03',
      '2026.10.02',
    ]);
    await expect(panel.locator('.notice-audience')).toHaveCount(0);
  }
  const metrics = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom };
      };
      return {
        main: box('.home-columns'),
        notices: box('.home-notices-grid'),
        left: box('.home-notices-grid > section:first-child'),
        right: box('.home-notices-grid > section:nth-child(2)'),
        guide: box('.process-guide'),
      };
    });
    expect(geometry.notices.y - geometry.main.bottom).toBeGreaterThanOrEqual(31);
    if (width > 768) {
      expect(Math.abs(geometry.left.y - geometry.right.y)).toBeLessThan(1);
      expect(Math.abs(geometry.left.width - geometry.right.width)).toBeLessThan(1);
    } else expect(geometry.right.y).toBeGreaterThanOrEqual(geometry.left.bottom);
    const row = panels.first().locator('.notice-row').first();
    await row.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const details = await row.evaluate((el) => {
      const title = el.querySelector('.home-notice-title')!,
        date = el.querySelector('time')!;
      const t = title.getBoundingClientRect(),
        d = date.getBoundingClientRect();
      const luminance = (c: string) =>
        c
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((n) => n / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
          .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const ratio = (c: string) => 1.05 / (luminance(c) + 0.05);
      const style = getComputedStyle(el);
      return {
        height: el.getBoundingClientRect().height,
        titleY: t.y,
        dateY: d.y,
        titleRight: t.right,
        dateX: d.x,
        text: Math.min(ratio(getComputedStyle(title).color), ratio(getComputedStyle(date).color)),
        focus: ratio(style.outlineColor),
        focused: el.matches(':focus-visible'),
      };
    });
    expect(details.height).toBeGreaterThanOrEqual(48);
    expect(details.text).toBeGreaterThanOrEqual(4.5);
    expect(details.focus).toBeGreaterThanOrEqual(3);
    expect(details.focused).toBe(true);
    if (width > 480) expect(details.dateX).toBeGreaterThanOrEqual(details.titleRight);
    else expect(details.dateY).toBeGreaterThan(details.titleY);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`notices-${width}.png`), fullPage: true });
    metrics.push({ width, geometry, details });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  const first = panels.first().locator('.notice-row').first();
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('system 공지 본문');
  await page.keyboard.press('Escape');
  await expect(first).toBeFocused();
  const all = panels.first().getByRole('button', { name: '전체 보기', exact: true });
  await all.click();
  await expect(page.getByRole('dialog')).toContainText('전 조직 공통');
  await expect(page.getByRole('dialog').locator('.notice-row')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(all).toBeFocused();
  const team = panels.nth(1).locator('.notice-row').first();
  await team.click();
  await expect(page.getByRole('dialog')).toContainText('팀 공지 · Foundry Photo');
  await page.keyboard.press('Escape');
  await expect(team).toBeFocused();
  expect(backend.store.snapshot()).toEqual(before);
  await writeFile(
    info.outputPath('home-notice-layout-metrics.json'),
    JSON.stringify(metrics, null, 2),
  );
});
