import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { Workspace } from '@eks/contracts';
import { actor, expect, test } from './fixtures';
import { carouselContrast } from './carousel-visual-helpers';

type Display = {
  count: number;
  kind: 'qualification' | 'multiple' | 'planning' | 'empty';
  long?: boolean;
};
async function mock(page: Page, display: Display) {
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch(),
      view = (await response.json()) as Workspace;
    if (view.actor.id === 'learner-1') {
      view.notifications = Array.from({ length: display.count }, (_, index) => ({
        id: `height-note-${index}`,
        key: `height-note-${index}`,
        recipientId: view.actor.id,
        lv1OrganizationId: view.actor.lv1OrganizationId,
        type: 'result',
        title: display.long
          ? '긴 알림 제목의 자연스러운 두 줄 표시와 날짜를 확인합니다. '.repeat(8)
          : [
              '평가 결과가 도착했습니다',
              '자격 취득 계획의 확인 안내가 도착했습니다',
              '인증Set 수료 안내입니다',
              '계획 수립을 완료했습니다',
              '다음 평가 안내입니다',
            ][index]!,
        body: '표시 기반 읽음 정책을 유지합니다.',
        href: '/qualifications',
        createdAt: new Date(Date.UTC(2026, 9, 25, 0, index)).toISOString(),
      }));
      const base = view.assignments[0]!;
      if (display.long && display.kind !== 'empty')
        base.qualificationMetadata = {
          ...base.qualificationMetadata!,
          title: '긴 자격 이름과 공백없는문자열을 확인합니다. '.repeat(12),
          description: '자격 설명은 기존 두 줄 표시를 유지합니다. '.repeat(30),
        };
      if (display.kind === 'multiple')
        view.assignments.push({ ...structuredClone(base), id: 'height-other' });
      if (display.kind === 'empty') view.assignments = [];
      view.planningRequests =
        display.kind === 'planning'
          ? [
              {
                qualificationType: 'auditee',
                id: 'height-request',
                learnerId: view.actor.id,
                lv1OrganizationId: view.actor.lv1OrganizationId,
                organizationId: view.actor.organizationId,
                requestedBy: 'admin-1',
                dueOn: '2027-01-01',
                message: '계획 요청 안내문 '.repeat(40),
                createdAt: '2026-10-25T00:00:00Z',
                revision: 1,
                mode: 'learner_choice',
                targets: [],
                selections: [],
              },
            ]
          : [];
      view.planningOptions = view.planningRequests.map((request) => ({
        requestId: request.id,
        revision: 1,
        candidates: [],
        errors: [],
        canComplete: false,
        noAdditional: false,
        stage: '미착수',
      }));
    }
    await route.fulfill({ response, json: view });
  });
}
async function refresh(page: Page) {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/workspace');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
}
async function geometry(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return page.locator('.home-columns').evaluate((columns) => {
    const box = (selector: string) => {
      const element = columns.querySelector<HTMLElement>(selector)!,
        r = element.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    };
    return {
      card: box('.home-qualification-frame'),
      list: box('.home-notification-list'),
      leftHeading: box('.home-primary .section-heading'),
      rightHeading: box('.home-secondary .section-heading'),
      rows: [...columns.querySelectorAll('.home-notification-row')].map(
        (element) => element.getBoundingClientRect().height,
      ),
      alignment: getComputedStyle(columns).alignItems,
      pageWidth: document.documentElement.scrollWidth,
    };
  });
}
function equalAreas(value: Awaited<ReturnType<typeof geometry>>) {
  expect(Math.abs(value.card.top - value.list.top)).toBeLessThanOrEqual(2);
  expect(Math.abs(value.card.bottom - value.list.bottom)).toBeLessThanOrEqual(2);
  expect(value.leftHeading.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(value.leftHeading.top - value.rightHeading.top)).toBeLessThanOrEqual(2);
  expect(Math.abs(value.leftHeading.height - value.rightHeading.height)).toBeLessThanOrEqual(2);
}

test('김민서 1자격·4알림의 5폭 전후 높이/행 밀도·이미지 대비와 모바일 자연 높이', async ({
  page,
  backend,
}, info) => {
  await mock(page, { kind: 'qualification', count: 4 });
  await page.goto('/');
  await actor(page, 'learner-1');
  const beforeState = backend.store.snapshot();
  const metrics = [];
  for (const width of [1920, 1440, 769, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .locator('.home-columns')
      .evaluate((el) => el.classList.remove('home-columns--learning'));
    const before = await geometry(page);
    if (width === 1920)
      await page.screenshot({ path: info.outputPath('height-before-1920.png'), fullPage: true });
    await page
      .locator('.home-columns')
      .evaluate((el) => el.classList.add('home-columns--learning'));
    const after = await geometry(page);
    expect(after.pageWidth).toBeLessThanOrEqual(width);
    expect(after.rows).toEqual(before.rows);
    if (width > 768) equalAreas(after);
    else {
      expect(after.card.height).toBe(before.card.height);
      expect(after.list.height).toBe(before.list.height);
      expect(after.alignment).toBe('start');
    }
    await page.locator('.home-qualification-action a').focus();
    const contrast = await carouselContrast(page);
    metrics.push({ width, before, after, contrast });
    await page.screenshot({ path: info.outputPath(`height-after-${width}.png`), fullPage: true });
  }
  expect(backend.store.snapshot()).toEqual(beforeState);
  await writeFile(info.outputPath('home-height-metrics.json'), JSON.stringify(metrics, null, 2));
});

test('0/1/4/5알림·긴 이름·다중/계획/빈 카드의 자동 높이와 탐색/계정/역할 유지', async ({
  page,
}, info) => {
  const display: Display = { kind: 'qualification', count: 5 };
  await mock(page, display);
  await page.goto('/');
  await actor(page, 'learner-1');
  const metrics = [];
  for (const kind of ['qualification', 'multiple', 'planning', 'empty'] as const) {
    display.kind = kind;
    display.long = true;
    for (const count of [0, 1, 4, 5]) {
      display.count = count;
      await refresh(page);
      await page.setViewportSize({ width: 1920, height: 900 });
      await expect(page.locator('.home-notification-row')).toHaveCount(Math.min(count, 4));
      const desktop = await geometry(page);
      equalAreas(desktop);
      expect(desktop.rows.every((height) => height < 100)).toBe(true);
      const action = page
        .locator('.home-qualification-frame .button.primary')
        .filter({ visible: true })
        .first();
      const box = (await action.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(desktop.card.bottom + 1);
      if (kind === 'multiple' && count === 5) {
        await page.getByRole('button', { name: '다음 항목', exact: true }).click();
        await expect(page.locator('.home-qualification-slide:not([inert])')).toHaveAttribute(
          'data-assignment-id',
          'height-other',
        );
        equalAreas(await geometry(page));
        await page.screenshot({
          path: info.outputPath('height-multiple-1920.png'),
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 390, height: 900 });
      const mobile = await geometry(page);
      expect(mobile.alignment).toBe('start');
      expect(mobile.pageWidth).toBeLessThanOrEqual(390);
      metrics.push({ kind, count, desktop, mobile });
    }
  }
  display.kind = 'qualification';
  display.long = false;
  display.count = 5;
  await refresh(page);
  await page.setViewportSize({ width: 1920, height: 900 });
  equalAreas(await geometry(page));
  await actor(page, 'admin-1');
  await expect(page.locator('.home-columns--learning')).toHaveCount(0);
  await expect(page.locator('.home-columns')).toHaveCSS('align-items', 'start');
  await actor(page, 'operator-1');
  await expect(page.locator('.home-columns--learning')).toHaveCount(0);
  await actor(page, 'learner-1');
  equalAreas(await geometry(page));
  await writeFile(info.outputPath('home-height-variants.json'), JSON.stringify(metrics, null, 2));
});
