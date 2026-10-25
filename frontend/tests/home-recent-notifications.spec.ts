import { test, expect, actor } from './fixtures';
import type { Notification } from '@eks/contracts';
import type { Page } from '@playwright/test';
import type { JsonStore } from '../../server/src/storage';
import { writeFile } from 'node:fs/promises';

function notice(id: string, fields: Partial<Notification> = {}): Notification {
  return {
    id,
    key: id,
    lv1OrganizationId: 'org-photo',
    recipientId: 'learner-1',
    type: 'result',
    title: `알림 제목 ${id}`,
    body: '홈에는 표시하지 않는 본문입니다.',
    href: '/qualifications',
    createdAt: '2026-10-23T00:00:00.000Z',
    ...fields,
  };
}
async function seed(store: JsonStore, notifications: Notification[]) {
  await store.transact(
    'admin-1',
    crypto.randomUUID(),
    'recent-notification-fixture',
    () => {},
    (s) => {
      s.notifications = notifications;
      return {};
    },
  );
}
const recent = (page: Page) => page.getByRole('region', { name: '최근 알림', exact: true });
const row = (page: Page, id: string) =>
  page.locator(`.notification-row[data-notification-id="${id}"]`);
const toggle = (page: Page, id: string) => row(page, id).locator('.collapsible-section-toggle');
async function navigate(page: Page, url: string) {
  await page.evaluate((url) => {
    history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);
}
async function refresh(page: Page) {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/workspace' && r.ok(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
}

test('홈은 본인 최신 네 건·안정된 동률 순서·서버 조회 범위와 0/1개를 유지하며 읽음 요청을 보내지 않는다', async ({
  page,
  backend,
}) => {
  await seed(backend.store, [
    notice('old', { createdAt: '2026-10-21T00:00:00.000Z' }),
    notice('c', { createdAt: '2026-10-22T00:00:00.000Z' }),
    notice('d', { createdAt: '2026-10-20T00:00:00.000Z' }),
    notice('e', { createdAt: '2026-10-19T00:00:00.000Z' }),
    notice('b'),
    notice('a', { readAt: '2026-10-23T01:00:00.000Z' }),
    notice('resolved', {
      resolvedAt: '2026-10-24T00:00:00.000Z',
      createdAt: '2026-10-24T00:00:00.000Z',
    }),
    notice('other', { recipientId: 'learner-2', createdAt: '2026-10-25T00:00:00.000Z' }),
  ]);
  const reads: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/read')) reads.push(r.url());
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  const links = recent(page).locator('.home-notification-row');
  await expect(links).toHaveCount(4);
  await expect(links.first()).toHaveAttribute('href', /notification=/);
  expect(
    await links.evaluateAll((els) => els.map((e) => e.getAttribute('data-notification-id'))),
  ).toEqual(['a', 'b', 'c', 'old']);
  await expect(links.first().locator('time')).toHaveText('2026.10.23 09:00');
  await expect(links.first()).toHaveAttribute('aria-label', /^읽음/);
  await expect(links.nth(1)).toHaveAttribute('aria-label', /^미읽음/);
  await expect(recent(page)).not.toContainText('홈에는 표시하지 않는 본문');
  await expect(
    page.getByRole('heading', { name: /다음 할 일|보유 자격 · 재인증|나의 인증 일정/ }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: '상태·재인증 확인 →', exact: true })).toHaveCount(0);
  await expect(
    page.locator('.home-shortcuts').getByRole('link', { name: '알림함', exact: true }),
  ).toHaveCount(0);
  expect(reads).toEqual([]);
  expect(backend.store.snapshot()).toEqual(before);
  await actor(page, 'learner-2');
  await expect(links).toHaveCount(1);
  await expect(links).toContainText('other');
  await actor(page, 'admin-1');
  await expect(links).toHaveCount(0);
  await expect(recent(page)).toContainText('받은 알림이 없습니다.');
});

test('모든 홈 역할은 같은 본인 최근 알림을 유지하고 계정 전환 시 분리한다', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'recent-roles',
    () => {},
    (s) => {
      const user = s.users.find((u) => u.id === 'admin-1')!;
      user.roles = ['learner', 'admin', 'system_operator'];
      s.notifications = [notice('admin', { recipientId: user.id }), notice('learner')];
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  const before = backend.store.snapshot();
  for (const label of ['학습자 인증 · Auditee', '팀 관리', '시스템 운영']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(recent(page).locator('.home-notification-row')).toHaveCount(1);
    await expect(recent(page)).toContainText('알림 제목 admin');
    await expect(recent(page)).not.toContainText('알림 제목 learner');
  }
  expect(backend.store.snapshot()).toEqual(before);
  await actor(page, 'operator-1');
  await expect(recent(page)).toContainText('받은 알림이 없습니다.');
});

test('홈 클릭은 선택 본문만 펼치고 표시 시 읽으며 뒤로 가기와 일반 전체 보기는 기존 정책을 따른다', async ({
  page,
  backend,
}) => {
  await seed(backend.store, [
    notice('selected', { createdAt: '2026-10-24T00:00:00.000Z' }),
    notice('other'),
    notice('read', { readAt: '2026-10-23T01:00:00.000Z', createdAt: '2026-10-20T00:00:00.000Z' }),
  ]);
  const reads: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/read')) reads.push(r.url());
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  const initial = await recent(page).locator('.home-notification-row').allTextContents();
  await recent(page).locator('[data-notification-id="selected"]').click();
  await expect(page).toHaveURL(/notifications\?notification=selected$/);
  await expect(toggle(page, 'selected')).toBeFocused();
  await expect(toggle(page, 'selected')).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page, 'other')).toHaveAttribute('aria-expanded', 'false');
  await expect(row(page, 'selected').locator('.notification-status')).toHaveText('읽음');
  expect(reads.map((url) => new URL(url).pathname)).toEqual(['/api/notifications/selected/read']);
  await page.goBack();
  await expect(recent(page)).toBeVisible();
  expect(await recent(page).locator('.home-notification-row').allTextContents()).toEqual(initial);
  await recent(page).getByRole('link', { name: '전체 보기', exact: true }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(toggle(page, 'other')).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page, 'selected')).toHaveAttribute('aria-expanded', 'false');
});

test('오래된 읽음 알림 직접 진입·동일 화면 대상 변경·재조회 초점 보존·없는/종료된 대상', async ({
  page,
  backend,
}) => {
  const notifications = Array.from({ length: 20 }, (_, index) =>
    notice(`n-${index}`, { createdAt: new Date(Date.UTC(2026, 9, 23, 0, index)).toISOString() }),
  );
  notifications[0]!.readAt = '2026-10-23T01:00:00.000Z';
  notifications.push(notice('resolved', { resolvedAt: '2026-10-23T01:00:00.000Z' }));
  await seed(backend.store, notifications);
  const reads: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/read')) reads.push(r.url());
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/notifications?notification=n-0');
  await expect(toggle(page, 'n-0')).toBeFocused();
  await expect(toggle(page, 'n-0')).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, 'n-0').locator('.notification-body')).toBeInViewport();
  expect(reads).toEqual([]);
  await navigate(page, '/notifications?notification=n-10');
  await expect(toggle(page, 'n-10')).toBeFocused();
  await expect(toggle(page, 'n-0')).toHaveAttribute('aria-expanded', 'false');
  await expect(row(page, 'n-10').locator('.notification-status')).toHaveText('읽음');
  await toggle(page, 'n-9').focus();
  await refresh(page);
  await expect(toggle(page, 'n-9')).toBeFocused();
  await navigate(page, '/notifications?notification=resolved');
  await expect(page.getByText('선택한 알림을 찾을 수 없습니다.', { exact: true })).toBeVisible();
  await expect(row(page, 'resolved')).toHaveCount(0);
  await navigate(page, '/notifications?notification=missing');
  await expect(page.getByText('선택한 알림을 찾을 수 없습니다.', { exact: true })).toBeVisible();
});

test('선택 알림의 백그라운드 읽음 제외와 실패 재시도', async ({ page, backend }) => {
  await seed(backend.store, [notice('target'), notice('other')]);
  await page.addInitScript(() =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }),
  );
  let attempts = 0;
  await page.route('**/api/notifications/target/read', async (route) => {
    attempts++;
    if (attempts === 1)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '읽음 시험 실패' }),
      });
    else await route.continue();
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/notifications?notification=target');
  await expect(toggle(page, 'target')).toBeFocused();
  expect(attempts).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(row(page, 'target').getByRole('alert')).toContainText('읽음 처리에 실패');
  await row(page, 'target').getByRole('button', { name: '읽음 처리 재시도', exact: true }).click();
  await expect(row(page, 'target').locator('.notification-status')).toHaveText('읽음');
  expect(attempts).toBe(2);
  expect(
    backend.store.snapshot().notifications.find((n) => n.id === 'other')!.readAt,
  ).toBeUndefined();
});

test('최근 알림의 네 화면 폭·긴 제목·조작과 대비·공지 순서', async ({ page, backend }, info) => {
  await seed(backend.store, [
    notice('long', {
      title: '긴 알림 제목을 확인하고 필요한 업무로 이동할 수 있습니다. '.repeat(8),
    }),
    notice('second'),
  ]);
  await page.goto('/');
  await actor(page, 'learner-1');
  const metrics = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const first = recent(page).locator('.home-notification-row').first();
    await first.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const values = await first.evaluate((el) => {
      const rgb = (v: string) =>
        v
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      const lum = (v: string) =>
        rgb(v)
          .map((n) => n / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
          .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const ratio = (fg: string) => {
        const x = lum(fg);
        return 1.05 / (x + 0.05);
      };
      const style = getComputedStyle(el);
      return {
        height: el.getBoundingClientRect().height,
        titleSize: getComputedStyle(el.querySelector('strong')!).fontSize,
        dateSize: getComputedStyle(el.querySelector('time')!).fontSize,
        text: Math.min(
          ratio(getComputedStyle(el.querySelector('strong')!).color),
          ratio(getComputedStyle(el.querySelector('time')!).color),
        ),
        focus: ratio(style.outlineColor),
        focused: el.matches(':focus-visible'),
      };
    });
    expect(values.height).toBeGreaterThanOrEqual(56);
    expect(values.titleSize).toBe('14px');
    expect(values.dateSize).toBe('13px');
    expect(values.text).toBeGreaterThanOrEqual(4.5);
    expect(values.focus).toBeGreaterThanOrEqual(3);
    expect(values.focused).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const headings = await page.locator('.home-secondary > section h2').allTextContents();
    expect(headings).toEqual(['최근 알림']);
    await expect(page.locator('.home-notices-grid > section h2')).toHaveText([
      '시스템 공지',
      '내 팀 공지',
    ]);
    await page.screenshot({ path: info.outputPath(`home-${width}.png`), fullPage: true });
    metrics.push({ width, ...values });
  }
  await writeFile(
    info.outputPath('home-notification-metrics.json'),
    JSON.stringify(metrics, null, 2),
  );
});
