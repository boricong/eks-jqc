import { linkFixtureTemplates } from '../../server/tests/template-helpers';
import type { Page } from '@playwright/test';
import { defaultPlanSchedule } from '@eks/contracts';
import { test, expect, actor } from './fixtures';
import { requestPlan } from './workflow-helpers';

async function start(page: Page) {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await page.getByLabel('취득할 자격').selectOption('demo-qualification');
  await page.getByRole('button', { name: '계획 수립 시작', exact: true }).click();
  await expect(page.locator('input[type="date"]')).toHaveCount(2);
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

test('계획 기본 일정·날짜 삭제와 시작일 수정 보존·기존 초안 최초 적용', async ({
  page,
  backend,
}) => {
  await start(page);
  let p = backend.store.snapshot().plans[0]!;
  const defaults = defaultPlanSchedule(p.createdAt);
  await expect(page.getByLabel('시작일').first()).toHaveValue(defaults.startOn);
  await expect(page.getByLabel('종료일').first()).toHaveValue(defaults.endOn);
  await page.getByLabel('종료일').fill('2029-12-01');
  await page.getByLabel('종료일').first().fill('');
  await page.getByRole('button', { name: '3. 최종 확인' }).click();
  await expect(page.locator('.field-error').first()).toContainText('종료일');
  await expect(page.getByLabel('종료일').first()).toBeFocused();
  await expect.poll(() => backend.store.snapshot().plans[0]!.endOn).toBe('');
  await page.reload();
  await expect(page.getByLabel('종료일').first()).toHaveValue('');
  await page.getByLabel('시작일').first().fill('2028-02-08');
  await expect(page.getByLabel('종료일').first()).toHaveValue('');
  await expect.poll(() => backend.store.snapshot().plans[0]!.startOn).toBe('2028-02-08');
  await page.goto('/plans');
  await backend.store.transact(
    'learner-2',
    'legacy-schedule',
    'legacy-schedule',
    () => {},
    (s) => {
      const value = s.plans[0]!;
      delete value.scheduleDefaultsAppliedAt;
      value.goal = '기존 목표';
      return {};
    },
  );
  await page.goto(`/plans/${p.id}`);
  await expect(page.getByLabel('종료일').first()).toHaveValue('2028-02-29');
  p = backend.store.snapshot().plans[0]!;
  expect(p.goal).toBe('기존 목표');
  const revision = p.revision;
  await page.reload();
  await expect(page.getByLabel('종료일').first()).toHaveValue('2028-02-29');
  expect(backend.store.snapshot().plans[0]!.revision).toBe(revision);
});

test('내 계획 삭제·재작성과 다른 탭의 자동 저장 중단', async ({ page, context, backend }) => {
  await start(page);
  const p = backend.store.snapshot().plans[0]!,
    stale = await context.newPage();
  await stale.goto('/');
  await actor(stale, 'learner-2');
  await stale.goto(`/plans/${p.id}`);
  await expect(stale.getByLabel('종료일')).toBeVisible();
  await page.goto('/plans');
  await page.getByRole('button', { name: '평가 흐름 체험 계획 삭제', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('일정과 학습 목표');
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  expect(backend.store.snapshot().plans[0]!.deletedAt).toBeUndefined();
  await page.getByRole('button', { name: '평가 흐름 체험 계획 삭제', exact: true }).click();
  await singleStyle(page);
  await page.getByRole('dialog').getByRole('button', { name: '계획 삭제', exact: true }).click();
  await expect(page.locator('.plan-list-row')).toHaveCount(0);
  await expect(
    page.getByLabel('취득할 자격').locator('option[value="demo-qualification"]'),
  ).toHaveCount(1);
  const deletedRevision = backend.store.snapshot().plans[0]!.revision;
  // No focus refresh: the pending edit must be rejected by the API and stop autosave.
  await stale.getByLabel('종료일').fill('2029-12-01');
  await expect(
    stale.getByRole('heading', { name: '삭제된 계획입니다', exact: true }),
  ).toBeVisible();
  await expect(stale.getByRole('button', { name: '저장 재시도' })).toHaveCount(0);
  await stale.getByRole('link', { name: '내 계획으로 이동' }).click();
  expect(backend.store.snapshot().plans[0]!.revision).toBe(deletedRevision);
  await page.getByLabel('취득할 자격').selectOption('demo-qualification');
  await page.getByRole('button', { name: '계획 수립 시작', exact: true }).click();
  await expect
    .poll(() => backend.store.snapshot().plans.filter((v) => !v.deletedAt).length)
    .toBe(1);
  expect(backend.store.snapshot().planningRequests).toHaveLength(1);
  await stale.close();
});

for (const failure of ['response', 'refresh'] as const) {
  test(`계획 삭제 후 ${failure === 'response' ? '응답 유실' : '조회 실패'} 재시도는 한 번만 삭제한다`, async ({
    page,
    backend,
  }) => {
    await start(page);
    const id = backend.store.snapshot().plans[0]!.id;
    await page.goto('/plans');
    await page.getByRole('button', { name: '평가 흐름 체험 계획 삭제', exact: true }).click();
    const keys: string[] = [];
    await page.route(`**/api/plans/${id}`, async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      keys.push(route.request().headers()['idempotency-key']!);
      if (failure === 'response' && keys.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: '삭제 응답 유실 시험' }),
        });
      } else await route.continue();
    });
    if (failure === 'refresh')
      await page.route('**/api/workspace', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: '삭제 후 조회 실패 시험' }),
        }),
      );
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '계획 삭제', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      failure === 'response' ? '삭제 응답 유실 시험' : '삭제 후 조회 실패 시험',
    );
    expect(backend.store.snapshot().plans[0]!.deletedAt).toBeTruthy();
    if (failure === 'refresh') await page.unroute('**/api/workspace');
    await dialog.getByRole('button', { name: '계획 삭제', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.plan-list-row')).toHaveCount(0);
    expect(new Set(keys).size).toBe(1);
    expect(keys.length).toBe(failure === 'response' ? 2 : 1);
    expect(backend.store.snapshot().audits.filter((a) => a.action === 'plan.delete')).toHaveLength(
      1,
    );
  });
}

test('5인증Set 일정의 밀도·인증Set 구분·단일 디자인과 반응형 입력 유지', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'admin-1',
    'five-course',
    'five-course',
    () => {},
    (s) => {
      const source = s.courses.find((c) => c.id === 'demo-course-1')!;
      const courseIds = Array.from({ length: 5 }, (_, i) => `schedule-course-${i}`);
      courseIds.forEach((id, i) =>
        s.courses.push({
          ...structuredClone(source),
          id,
          entityId: id,
          title: `설비 Backup ${i + 1} · 대상 설비와 구성 확인`,
        }),
      );
      const q = structuredClone(s.qualifications.find((q) => q.id === 'demo-qualification')!);
      s.qualifications.push({
        ...q,
        id: 'schedule-qualification',
        entityId: 'schedule-qualification',
        title: '설비 Backup 일정 검증',
        courseIds,
      });
      linkFixtureTemplates(s);
      return {};
    },
  );
  await start(page);
  await page.goto('/plans');
  await page.getByLabel('취득할 자격').selectOption('schedule-qualification');
  await page.getByRole('button', { name: '계획 수립 시작', exact: true }).click();
  await expect(page.locator('input[type="date"]')).toHaveCount(2);
  await expect(page.getByRole('region', { name: '포함된 인증Set' }).locator('li')).toHaveCount(5);
  await page.getByLabel('종료일').fill('2029-12-01');
  const input = page.getByLabel('시작일').first();
  await input.fill('2027-01-01');
  await input.focus();
  const scroll = await page.evaluate(() => scrollY);
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'eks-theme:learner-1', newValue: 'dark' }),
    ),
  );
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('2027-01-01');
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['single'] as const) {
      await singleStyle(page);
      await noOverflow(page);
      await page.screenshot({
        path: test.info().outputPath(`schedule-${theme}-${width}.png`),
        fullPage: true,
      });
    }
    if (width === 390)
      expect(await input.evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(
        44,
      );
  }
});

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
