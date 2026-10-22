import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { Notification } from '@eks/contracts';
import type { JsonStore } from '../../server/src/storage';
import { test, expect, actor } from './fixtures';

const longBody = Array.from(
  { length: 42 },
  (_, i) => `${i + 1}. 준비한 내용을 확인하고 관련 업무에서 다음 단계를 진행해 주세요.`,
).join('\n');
function notice(id: string, overrides: Partial<Notification> = {}): Notification {
  return {
    id,
    key: id,
    lv1OrganizationId: 'org-photo',
    recipientId: 'learner-1',
    type: 'result',
    title: `알림 ${id}`,
    body: '확인할 업무 안내입니다.\n읽음 처리와 업무 완료는 별도로 관리됩니다.',
    href: '/qualifications',
    createdAt: '2026-10-23T00:00:00.000Z',
    ...overrides,
  };
}
async function seed(store: JsonStore, notifications: Notification[]) {
  await store.transact(
    'admin-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      s.notifications = notifications;
      return {};
    },
  );
}
function row(page: Page, id: string) {
  return page.locator(`[data-notification-id="${id}"]`);
}
function toggle(page: Page, id: string) {
  return row(page, id).locator('.collapsible-section-toggle');
}
async function hiddenInitially(page: Page) {
  await page.addInitScript(() =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }),
  );
}
async function visibility(page: Page, value: 'visible' | 'hidden') {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}
async function settleObservers(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.waitForTimeout(150);
}
async function enter(page: Page) {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: '내 알림', exact: true })).toBeVisible();
  await expect(page.locator('#main')).toBeFocused();
}
async function refresh(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/workspace') && r.status() === 200,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
}

test('초기 상태·키보드·화면 밖/접힘/백그라운드 제외와 갱신 시 개별 펼침 보존', async ({
  page,
  backend,
}) => {
  await seed(backend.store, [
    notice('first', { body: longBody }),
    notice('below', { createdAt: '2026-10-22T00:00:00.000Z' }),
    notice('read', { readAt: '2026-10-22T01:00:00.000Z', createdAt: '2026-10-21T00:00:00.000Z' }),
  ]);
  await hiddenInitially(page);
  const reads: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/read')) reads.push(r.url());
  });
  await enter(page);
  await expect(toggle(page, 'first')).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page, 'below')).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page, 'read')).toHaveAttribute('aria-expanded', 'false');
  await settleObservers(page);
  expect(reads).toHaveLength(0);
  await toggle(page, 'below').evaluate((el: HTMLButtonElement) => el.click());
  await toggle(page, 'first').focus();
  await page.keyboard.press('Enter');
  await visibility(page, 'visible');
  await settleObservers(page);
  expect(reads).toHaveLength(0);
  await expect(toggle(page, 'first')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(row(page, 'first').locator('.notification-status')).toHaveText('읽음');
  await expect(toggle(page, 'first')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.notifications-count')).toContainText('미읽음 1건');
  expect(reads).toHaveLength(1);
  await toggle(page, 'below').evaluate((el: HTMLButtonElement) => el.click());
  await settleObservers(page);
  expect(reads).toHaveLength(1); // Expanded, but below the viewport.
  await toggle(page, 'first').focus();
  await page.keyboard.press('Enter');
  await expect(row(page, 'below').locator('.notification-status')).toHaveText('읽음');
  await seed(backend.store, [
    ...backend.store.snapshot().notifications,
    notice('new', { createdAt: '2026-10-20T00:00:00.000Z' }),
  ]);
  await visibility(page, 'hidden');
  await refresh(page);
  await expect(toggle(page, 'first')).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle(page, 'below')).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page, 'new')).toHaveAttribute('aria-expanded', 'true');
  expect(reads).toHaveLength(2);
});

test('자동 읽음 뒤 필터의 본문·위치를 유지하고 필터 재선택·재방문에 최신 상태 적용', async ({
  page,
  backend,
}) => {
  await seed(backend.store, [
    notice('first', { body: longBody }),
    notice('below', { createdAt: '2026-10-22T00:00:00.000Z' }),
    notice('read', { readAt: '2026-10-22T00:00:00.000Z' }),
  ]);
  await hiddenInitially(page);
  await enter(page);
  await page.getByRole('checkbox', { name: '읽지 않은 알림만' }).check();
  await expect(page.getByText('이 화면에서 확인한 알림은 목록에 유지됩니다.')).toBeVisible();
  const before = await row(page, 'first').boundingBox();
  await visibility(page, 'visible');
  await expect(row(page, 'first').locator('.notification-status')).toHaveText('읽음');
  await expect(page.locator('.notification-row')).toHaveCount(2);
  await expect(toggle(page, 'first')).toHaveAttribute('aria-expanded', 'true');
  expect((await row(page, 'first').boundingBox())!.y).toBe(before!.y);
  await expect(page.locator('.notifications-count')).toContainText('미읽음 1건');
  await visibility(page, 'hidden');
  await page.getByRole('checkbox', { name: '읽지 않은 알림만' }).uncheck();
  await expect(toggle(page, 'first')).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('checkbox', { name: '읽지 않은 알림만' }).check();
  await expect(row(page, 'first')).toHaveCount(0);
  await page.goto('/qualifications');
  await page.goto('/notifications');
  await expect(toggle(page, 'first')).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle(page, 'below')).toHaveAttribute('aria-expanded', 'true');
});

test('읽음 요청을 순차 처리하고 업무 이동이 진행 중 요청을 공유한다', async ({ page, backend }) => {
  await seed(backend.store, [notice('first'), notice('second'), notice('third')]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reads: string[] = [];
  await page.route('**/api/notifications/*/read', async (route) => {
    reads.push(route.request().url());
    if (reads.length === 1) await gate;
    await route.continue();
  });
  await enter(page);
  await expect.poll(() => reads.length).toBe(1);
  await settleObservers(page);
  expect(reads).toHaveLength(1);
  await row(page, 'first').getByRole('button', { name: '관련 업무로 이동' }).click();
  await settleObservers(page);
  expect(reads).toHaveLength(1);
  release();
  await expect(page).toHaveURL(/\/qualifications$/);
  expect(reads.filter((url) => url.includes('/first/'))).toHaveLength(1);
  await expect
    .poll(() => backend.store.snapshot().notifications.find((n) => n.id === 'first')?.readAt)
    .toBeTruthy();
});

for (const lostResponse of [false, true]) {
  test(`${lostResponse ? '응답 유실' : '읽음 실패'} 시 본문·오류 유지, 업무 이동 차단과 같은 요청 키로 재시도`, async ({
    page,
    backend,
  }) => {
    await seed(backend.store, [notice('failure')]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const keys: string[] = [];
    await page.route('**/api/notifications/*/read', async (route) => {
      keys.push(route.request().headers()['idempotency-key']!);
      if (keys.length === 1) {
        await gate;
        if (lostResponse) await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await enter(page);
    await expect.poll(() => keys.length).toBe(1);
    await row(page, 'failure').getByRole('button', { name: '관련 업무로 이동' }).click();
    release();
    await expect(row(page, 'failure').getByRole('alert')).toContainText(
      '읽음 처리에 실패했습니다.',
    );
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(toggle(page, 'failure')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.notifications-count')).toContainText('미읽음 1건');
    await visibility(page, 'hidden');
    await visibility(page, 'visible');
    await settleObservers(page);
    expect(keys).toHaveLength(1);
    const readAt = backend.store.snapshot().notifications[0]!.readAt;
    expect(!!readAt).toBe(lostResponse);
    await row(page, 'failure').getByRole('button', { name: '읽음 처리 재시도' }).click();
    await expect(row(page, 'failure').locator('.notification-status')).toHaveText('읽음');
    await expect(row(page, 'failure').getByRole('alert')).toHaveCount(0);
    expect(keys).toEqual([keys[0], keys[0]]);
    if (lostResponse) expect(backend.store.snapshot().notifications[0]!.readAt).toBe(readAt);
    await row(page, 'failure').getByRole('button', { name: '관련 업무로 이동' }).click();
    await expect(page).toHaveURL(/\/qualifications$/);
    expect(keys).toHaveLength(2);
  });
}

test('서버 성공 후 재조회 실패는 변경 요청을 반복하지 않고 재조회만 재시도', async ({
  page,
  backend,
}) => {
  await seed(backend.store, [notice('refresh')]);
  let reads = 0,
    failRefresh = true;
  page.on('request', (r) => {
    if (r.url().endsWith('/read')) reads++;
  });
  await page.route('**/api/workspace**', async (route) => {
    if (reads && failRefresh) {
      failRefresh = false;
      await route.abort('failed');
    } else await route.continue();
  });
  await enter(page);
  await expect(row(page, 'refresh').getByRole('alert')).toContainText('읽음 처리에 실패했습니다.');
  await expect(page.locator('.notifications-count')).toContainText('미읽음 1건');
  expect(backend.store.snapshot().notifications[0]!.readAt).toBeTruthy();
  await row(page, 'refresh').getByRole('button', { name: '읽음 처리 재시도' }).click();
  await expect(row(page, 'refresh').locator('.notification-status')).toHaveText('읽음');
  expect(reads).toBe(1);
});

test('화면 이탈 시 대기 요청·늦은 업무 이동 취소와 계정별 초기화', async ({ page, backend }) => {
  await seed(backend.store, [
    notice('old'),
    notice('queued'),
    notice('other', { recipientId: 'learner-2' }),
  ]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reads: string[] = [];
  await page.route('**/api/notifications/*/read', async (route) => {
    reads.push(route.request().url());
    if (reads.length === 1) await gate;
    await route.continue();
  });
  await enter(page);
  await expect.poll(() => reads.length).toBe(1);
  await row(page, 'old').getByRole('button', { name: '관련 업무로 이동' }).click();
  await page.getByRole('link', { name: '홈', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  release();
  await expect(page.getByLabel('접속 계정')).toBeEnabled();
  await settleObservers(page);
  await expect(page).toHaveURL(/\/$/);
  expect(reads).toHaveLength(1);
  expect(
    backend.store.snapshot().notifications.find((n) => n.id === 'queued')!.readAt,
  ).toBeUndefined();
  await actor(page, 'learner-2');
  await page.goto('/notifications');
  await expect(row(page, 'old')).toHaveCount(0);
  await expect(toggle(page, 'other')).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, 'other').locator('.notification-status')).toHaveText('읽음');
});

test('대기 중 접힘·백그라운드 전환은 다음 읽음 요청을 취소하고 다시 노출되면 처리', async ({
  page,
  backend,
}) => {
  await seed(backend.store, [notice('first'), notice('closed'), notice('background')]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reads: string[] = [];
  await page.route('**/api/notifications/*/read', async (route) => {
    reads.push(route.request().url());
    if (reads.length === 1) await gate;
    await route.continue();
  });
  await enter(page);
  await expect.poll(() => reads.length).toBe(1);
  await toggle(page, 'closed').click();
  await visibility(page, 'hidden');
  release();
  await expect(row(page, 'first').locator('.notification-status')).toHaveText('읽음');
  await settleObservers(page);
  expect(reads).toHaveLength(1);
  await visibility(page, 'visible');
  await expect(row(page, 'background').locator('.notification-status')).toHaveText('읽음');
  expect(reads).toHaveLength(2);
  expect(
    backend.store.snapshot().notifications.find((n) => n.id === 'closed')!.readAt,
  ).toBeUndefined();
});

test('읽음 요청 중 화면을 나갔다 바로 재진입해도 요청을 공유하고 이전 이동을 적용하지 않는다', async ({
  page,
  backend,
}) => {
  await seed(backend.store, [notice('return')]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  await page.route('**/api/notifications/*/read', async (route) => {
    reads++;
    await gate;
    await route.continue();
  });
  await enter(page);
  await expect.poll(() => reads).toBe(1);
  await row(page, 'return').getByRole('button', { name: '관련 업무로 이동' }).click();
  await page.getByRole('link', { name: '홈', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: /^알림/ })
    .click();
  await expect(toggle(page, 'return')).toHaveAttribute('aria-expanded', 'true');
  await settleObservers(page);
  expect(reads).toBe(1);
  release();
  await expect(row(page, 'return').locator('.notification-status')).toHaveText('읽음');
  await expect(toggle(page, 'return')).toHaveAttribute('aria-expanded', 'true');
  await expect(page).toHaveURL(/\/notifications$/);
  expect(reads).toBe(1);
});

for (const width of [1920, 1440, 768, 390]) {
  test(`${width}px 긴 알림·타이포그래피·초점·대비·빈 상태`, async ({ page, backend }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(backend.store, [
      notice('long', {
        title:
          '긴 제목에서도 업무 맥락을 잃지 않도록 알림 안내를 정돈합니다. '.repeat(5) +
          '\n줄바꿈을 보존한 제목',
        body: longBody,
      }),
      notice('read', { readAt: '2026-10-23T01:00:00.000Z' }),
    ]);
    await hiddenInitially(page);
    await enter(page);
    await page.keyboard.press('Tab');
    await toggle(page, 'long').focus();
    await expect(toggle(page, 'long')).toBeFocused();
    const metrics = await page.evaluate(() => {
      const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      const luminance = (color: string) => {
        const c = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map((v) => Number(v) / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
      };
      const contrast = (selector: string, background: string) => {
        const a = luminance(style(selector).color),
          b = luminance(style(background).backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        font: style('.notification-body').fontFamily,
        h1: style('.notifications-page h1').fontSize,
        title: style('.notifications-page .collapsible-section-title').fontSize,
        weight: style('.notifications-page .collapsible-section-title').fontWeight,
        body: style('.notification-body').fontSize,
        leading: style('.notification-body').lineHeight,
        meta: style('.notification-status').fontSize,
        contrasts: [
          contrast('.notification-body', '.notification-row'),
          contrast('.notification-status', '.collapsible-section-toggle'),
          contrast('.notification-meta time', '.collapsible-section-toggle'),
        ],
        targets: [
          ...document.querySelectorAll<HTMLElement>(
            '.notifications-page button, .notifications-filter',
          ),
        ]
          .filter((el) => el.getBoundingClientRect().height)
          .map((el) => el.getBoundingClientRect().height),
        outline: style('.notifications-page .collapsible-section-toggle').outlineStyle,
      };
    });
    expect(metrics.overflow).toBe(false);
    expect(metrics.font).toContain('Pretendard');
    expect({
      h1: metrics.h1,
      title: metrics.title,
      weight: metrics.weight,
      body: metrics.body,
      leading: metrics.leading,
      meta: metrics.meta,
    }).toEqual({
      h1: '24px',
      title: '16px',
      weight: '500',
      body: '15px',
      leading: '24.75px',
      meta: '13px',
    });
    expect(Math.min(...metrics.contrasts)).toBeGreaterThanOrEqual(4.5);
    if (width <= 768) expect(Math.min(...metrics.targets)).toBeGreaterThanOrEqual(44);
    expect(metrics.outline).not.toBe('none');
    await page.screenshot({ path: info.outputPath(`notifications-${width}.png`), fullPage: true });
    await seed(backend.store, [notice('read', { readAt: '2026-10-23T01:00:00.000Z' })]);
    await refresh(page);
    await page.getByRole('checkbox', { name: '읽지 않은 알림만' }).check();
    await expect(page.getByText('읽지 않은 알림이 없습니다.')).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`notifications-filter-empty-${width}.png`),
      fullPage: true,
    });
    await seed(backend.store, []);
    await refresh(page);
    await expect(page.getByText('아직 받은 알림이 없습니다.')).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`notifications-empty-${width}.png`),
      fullPage: true,
    });
  });
}
