import { writeFile } from 'node:fs/promises';
import { heroContrast } from './home-helpers';
import { test, expect, actor } from './fixtures';
import type { Page } from '@playwright/test';
import type { DashboardResponse } from '@eks/contracts';
import {
  configureDashboardFixture,
  DASHBOARD_NOW,
  ORG_A,
  TEAM,
} from '../../server/tests/dashboard-fixtures';
import type { JsonStore } from '../../server/src/storage';

const roles = (page: Page) => page.getByRole('tablist', { name: '홈 보기' });
const stats = (page: Page) => page.locator('.home-hero .stat-value');
async function prepare(store: JsonStore, all = false) {
  await configureDashboardFixture(store);
  await store.transact(
    'operator-1',
    crypto.randomUUID(),
    'multi-role-home',
    () => {},
    (s) => {
      const admin = s.users.find((u) => u.id === 'admin-1')!;
      admin.roles = ['learner', 'admin'];
      if (all) {
        admin.roles.push('system_operator');
        admin.organizationId = ORG_A;
        admin.organizationAdministration = {
          organizationId: ORG_A,
          grantedBy: 'operator-1',
          grantedAt: DASHBOARD_NOW,
        };
      }
      return {};
    },
  );
}
async function expectedSummary(page: Page, direct: boolean) {
  const query = new URLSearchParams({
    lv1OrganizationId: TEAM,
    organizationId: direct ? ORG_A : TEAM,
    includeDescendants: 'true',
    view: 'summary',
  });
  const response = await page.request.get(`/api/dashboard?${query}`, {
    headers: {
      'X-Session-Tab': (await page.evaluate(() => sessionStorage.getItem('eks-session-tab')))!,
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as DashboardResponse;
}

test('보유 역할·기존 최초 홈·사용자별 세션 복원과 새 접속 초기화', async ({
  page,
  backend,
  context,
}) => {
  await prepare(backend.store);
  await page.goto('/');
  await actor(page, 'alice');
  await expect(roles(page)).toHaveCount(0);
  await actor(page, 'admin-1');
  await expect(roles(page).getByRole('tab')).toHaveText(['학습자 인증 · Auditee', '팀 관리']);
  await expect(roles(page).getByRole('tab', { name: '팀 관리' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(stats(page)).toHaveCount(2);
  const menu = await page.getByRole('navigation', { name: '주 메뉴', exact: true }).innerText();
  const url = page.url();
  const history = await page.evaluate(() => window.history.length);
  await roles(page).getByRole('tab', { name: '학습자 인증 · Auditee' }).click();
  await expect(page.getByRole('heading', { name: '진행 중인 자격', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '기준 관리', exact: true })).toHaveCount(0);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => window.history.length)).toBe(history);
  expect(await page.getByRole('navigation', { name: '주 메뉴', exact: true }).innerText()).toBe(
    menu,
  );
  await page.reload();
  await expect(roles(page).getByRole('tab', { name: '학습자 인증 · Auditee' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page
    .getByRole('navigation', { name: '주 메뉴', exact: true })
    .getByRole('link', { name: '알림', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: '주 메뉴', exact: true })
    .getByRole('link', { name: '홈', exact: true })
    .click();
  await expect(roles(page).getByRole('tab', { name: '학습자 인증 · Auditee' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await actor(page, 'learner-2');
  await expect(roles(page).getByRole('tab', { name: '학습자 인증 · Auditee' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await roles(page).getByRole('tab', { name: '조직 관리' }).click();
  await actor(page, 'admin-1');
  await expect(roles(page).getByRole('tab', { name: '학습자 인증 · Auditee' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await actor(page, 'learner-2');
  await expect(roles(page).getByRole('tab', { name: '조직 관리' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const fresh = await context.newPage();
  await fresh.goto('/');
  await actor(fresh, 'admin-1');
  await expect(roles(fresh).getByRole('tab', { name: '팀 관리' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await fresh.close();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('eks-dataset-changed')));
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(sessionStorage).filter((key) => key.startsWith('eks-home-role-')),
      ),
    )
    .toEqual([]);
});

test('전체 역할의 순서·팀/직속 집계·이동 범위·학습 개인 정보와 조회 불변', async ({
  page,
  backend,
}) => {
  backend.setClock(DASHBOARD_NOW);
  await prepare(backend.store, true);
  const before = backend.store.snapshot(),
    organizations = backend.store.organizations.snapshot();
  await page.goto('/');
  await actor(page, 'admin-1');
  await expect(roles(page).getByRole('tab')).toHaveText([
    '학습자 인증 · Auditee',
    '팀 관리',
    '조직 관리',
    '시스템 운영',
  ]);
  await expect(roles(page).getByRole('tab', { name: '시스템 운영' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('홈 관리할 Lv1 조직')).toBeVisible();
  for (const direct of [false, true]) {
    await roles(page)
      .getByRole('tab', { name: direct ? '조직 관리' : '팀 관리', exact: true })
      .click();
    const data = await expectedSummary(page, direct);
    await expect(stats(page)).toHaveText([
      String(data.summary.eligiblePeople),
      String(data.summary.overdueRequests),
    ]);
    await expect(page.locator('.home-scope')).toContainText(
      direct ? '본인 조직 및 모든 하위 조직 기준' : '팀 전체 기준',
    );
    const target = new URL(
      (await page.locator('.home-hero a').first().getAttribute('href'))!,
      page.url(),
    );
    expect(target.searchParams.get('organizationId')).toBe(direct ? ORG_A : TEAM);
    expect(target.searchParams.get('includeDescendants')).toBe('true');
    await page.locator('.home-hero a').first().click();
    await expect(page.getByRole('heading', { name: '인증 현황', exact: true })).toBeVisible();
    await page
      .getByRole('navigation', { name: '주 메뉴', exact: true })
      .getByRole('link', { name: '홈', exact: true })
      .click();
    await expect(
      roles(page).getByRole('tab', { name: direct ? '조직 관리' : '팀 관리', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
  }
  await roles(page).getByRole('tab', { name: '학습자 인증 · Auditee' }).click();
  await expect(stats(page)).toHaveText(['0', '0', '0']);
  await expect(page.locator('.home-scope')).toHaveCount(0);
  await expect(page.locator('.home-primary')).not.toContainText('대시보드에 노출하면 안 되는');
  expect(backend.store.snapshot()).toEqual(before);
  expect(backend.store.organizations.snapshot()).toEqual(organizations);
});

test('관리 요약 실패는 0건을 만들지 않고 재시도로 실제 현황을 확인한다', async ({
  page,
  backend,
}) => {
  await prepare(backend.store);
  await page.route('**/api/dashboard?**', (route) =>
    route.fulfill({ status: 503, json: { message: '일시적인 조회 오류' } }),
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await expect(page.getByRole('alert')).toContainText('일시적인 조회 오류');
  await expect(stats(page)).toHaveCount(0);
  await page.unroute('**/api/dashboard?**');
  await page.getByRole('button', { name: '현황 다시 조회' }).click();
  await expect(stats(page)).toHaveCount(2);
  await roles(page).getByRole('tab', { name: '학습자 인증 · Auditee' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await actor(page, 'admin-1');
  await roles(page).getByRole('tab', { name: '팀 관리' }).click();
  await expect(page.locator('.home-hero')).not.toContainText('필수 자격 충족률');
});

test('늦은 역할·계정 응답 무시와 역할 회수 시 유효 홈 복귀', async ({ page, backend }) => {
  await prepare(backend.store, true);
  await page.goto('/');
  await actor(page, 'admin-1');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  await page.route('**/api/dashboard?**', async (route) => {
    intercepted = true;
    const response = await route.fetch();
    await pending;
    try {
      await route.fulfill({ response });
    } catch {
      /* Aborted requests are expected. */
    }
  });
  await roles(page).getByRole('tab', { name: '팀 관리' }).click();
  await expect.poll(() => intercepted).toBe(true);
  await roles(page).getByRole('tab', { name: '학습자 인증 · Auditee' }).click();
  await expect(stats(page)).toHaveText(['0', '0', '0']);
  release();
  await page.unroute('**/api/dashboard?**');
  await roles(page).getByRole('tab', { name: '조직 관리' }).click();
  await expect(stats(page)).toHaveCount(2);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'remove-role',
    () => {},
    (s) => {
      const u = s.users.find((u) => u.id === 'admin-1')!;
      delete u.organizationAdministration;
      u.roles = ['learner'];
      return {};
    },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(roles(page)).toHaveCount(0);
  await expect(stats(page)).toHaveText(['0', '0', '0']);
  await expect(page.getByRole('heading', { name: '조직 관리', exact: true })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('eks-home-role-admin-1')))
    .toBe('learner');
});

test('네 화면 폭·키보드·패널 연결·실제 대비와 네 역할 화면 캡처', async ({
  page,
  backend,
}, info) => {
  await prepare(backend.store, true);
  await page.goto('/');
  await actor(page, 'admin-1');
  await roles(page).getByRole('tab', { name: '시스템 운영' }).focus();
  await page.keyboard.press('Home');
  await expect(roles(page).getByRole('tab', { name: '학습자 인증 · Auditee' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(roles(page).getByRole('tab', { name: '팀 관리' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(roles(page).getByRole('tab', { name: '시스템 운영' })).toBeFocused();
  const metrics = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const label of ['학습자 인증 · Auditee', '팀 관리', '조직 관리', '시스템 운영']) {
      await roles(page).getByRole('tab', { name: label, exact: true }).click();
      await expect(stats(page)).toHaveCount(label.includes('관리') ? 2 : 3);
      const active = roles(page).getByRole('tab', { name: label, exact: true });
      const ids = (await active.getAttribute('aria-controls'))!.split(' ');
      for (const id of ids)
        await expect(page.locator(`#${id}`)).toHaveAttribute(
          'aria-labelledby',
          (await active.getAttribute('id'))!,
        );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const bounds = await active.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(width <= 768 ? 44 : 40);
      await expect(active).toHaveCSS('font-size', '14px');
      await expect(page.locator('.home-role-tabs')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
      await expect(page.locator('.home-role-tabs')).toHaveCSS(
        'border-bottom-color',
        'rgba(0, 0, 0, 0)',
      );
      await expect(active).toHaveCSS('background-color', 'rgba(83, 58, 253, 0.06)');
      await expect(active).toHaveCSS('color', 'rgb(46, 43, 140)');
      await expect(active).toHaveCSS('font-weight', '600');
      await expect(active).toHaveCSS('border-bottom-width', '2px');
      await expect(active).toHaveCSS('border-bottom-color', 'rgb(46, 43, 140)');
      const other = roles(page).locator('[aria-selected="false"]').first();
      await page.mouse.move(0, 0);
      await expect(other).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await other.hover();
      await expect(other).toHaveCSS('background-color', 'rgba(83, 58, 253, 0.04)');
      await active.focus();
      await page.keyboard.press('Space');
      await expect(active).toBeFocused();
      expect(await active.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
      await expect(active).toHaveCSS('outline-color', 'rgb(46, 43, 140)');
      await expect(active).toHaveCSS('outline-width', '2px');
      await expect(active).toHaveCSS('outline-offset', '-2px');
      await expect(page.locator('.home-hero h1')).toHaveCSS('font-size', '24px');
      metrics.push({
        ...(await heroContrast(page)),
        width,
        label,
        hero: await page.locator('.home-hero').boundingBox(),
        tab: bounds,
      });
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: info.outputPath(`focus-${label}-${width}.png`),
        fullPage: true,
      });
      await active.blur();
      await page.screenshot({
        path: info.outputPath(`home-${label}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await writeFile(info.outputPath('tab-blend-metrics.json'), JSON.stringify(metrics, null, 2));
  await info.attach('role-home-metrics', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
});

test('계정 전환 중 이전 관리 응답은 새 학습 홈에 적용되지 않는다', async ({ page, backend }) => {
  await prepare(backend.store, true);
  await page.goto('/');
  await actor(page, 'admin-1');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  await page.route('**/api/dashboard?**', async (route) => {
    const response = await route.fetch();
    intercepted = true;
    await pending;
    try {
      await route.fulfill({ response });
    } catch {
      /* Previous account request cancelled. */
    }
  });
  await roles(page).getByRole('tab', { name: '팀 관리' }).click();
  await expect.poll(() => intercepted).toBe(true);
  await actor(page, 'alice');
  release();
  await page.unroute('**/api/dashboard?**');
  await expect(roles(page)).toHaveCount(0);
  await expect(page.locator('.home-scope')).toHaveCount(0);
  await expect(stats(page)).toHaveText(['0', '1', '1']);
  await expect(page.locator('.home-primary')).not.toContainText('기준 관리');
});

test('긴 이름·소속·Hold·잘못된 기억과 비어 있는 역할 화면을 네 폭에서 표시', async ({
  page,
  backend,
}, info) => {
  await prepare(backend.store, true);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'long-held-role',
    () => {},
    (s) => {
      const user = s.users.find((u) => u.id === 'admin-1')!;
      user.name = '역할을 함께 수행하는 사용자 '.repeat(4);
      user.certificationEligibility = 'hold';
      return {};
    },
  );
  await backend.store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    'long-org',
    () => {},
    (doc) => {
      doc.roots[0]!.children.find((n) => n.id === ORG_A)!.name =
        '생산 공정과 설비 품질 업무를 관리하는 조직 '.repeat(3);
      return {};
    },
  );
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('eks-home-role-admin-1', 'unsupported-role'));
  await actor(page, 'admin-1');
  await expect(roles(page).getByRole('tab', { name: '시스템 운영' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const label of ['조직 관리', '학습자 인증 · Auditee']) {
      await roles(page).getByRole('tab', { name: label }).click();
      await expect(stats(page)).toHaveCount(label.includes('관리') ? 2 : 3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (label === '학습자 인증 · Auditee') {
        await expect(page.locator('#home-role-content > .error-message')).toContainText('Hold');
        await expect(stats(page)).toHaveText(['0', '0', '0']);
      } else {
        await expect(page.locator('#home-role-content > .error-message')).toHaveCount(0);
      }
      await page.screenshot({
        path: info.outputPath(`long-${label}-${width}.png`),
        fullPage: true,
      });
    }
  }
});
