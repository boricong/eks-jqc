import { writeFile } from 'node:fs/promises';
import { test, expect, actor } from './fixtures';
import type { Page } from '@playwright/test';
import type { JsonStore } from '../../server/src/storage';
import {
  configureDashboardFixture,
  DASHBOARD_NOW,
  ORG_A,
} from '../../server/tests/dashboard-fixtures';

const nav = (page: Page) => page.locator('#primary-navigation');
async function openMenu(page: Page) {
  if (!(await nav(page).isVisible()))
    await page.getByRole('button', { name: '메뉴', exact: true }).click();
}
async function top(page: Page, label: string) {
  await openMenu(page);
  await nav(page).getByRole('link', { name: label, exact: true }).click();
  await expect(
    nav(page).getByRole('link', { name: label, exact: true, includeHidden: true }),
  ).toHaveAttribute('aria-current', 'page');
}
async function prepare(store: JsonStore, multi = false) {
  await configureDashboardFixture(store);
  if (multi)
    await store.transact(
      'operator-1',
      crypto.randomUUID(),
      'owned-multi',
      () => {},
      (s) => {
        const user = s.users.find((u) => u.id === 'alice')!;
        user.roles = ['learner', 'admin', 'system_operator'];
        user.organizationAdministration = {
          organizationId: ORG_A,
          grantedBy: 'operator-1',
          grantedAt: DASHBOARD_NOW,
        };
        return {};
      },
    );
  // Settle existing scheduled expiry/renewal work before measuring pure navigation.
  await store.refreshNotifications(DASHBOARD_NOW);
}
async function current(page: Page, label: string) {
  await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
  await expect(
    nav(page).getByRole('link', { name: label, exact: true, includeHidden: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(nav(page).locator('a.active')).toHaveCount(1);
}

async function headerContrast(page: Page) {
  const result = await page.locator('.topbar').evaluate((el) => {
    const rgb = (s: string) => s.match(/[\d.]+/g)!.map(Number);
    const luminance = (c: number[]) =>
      c
        .slice(0, 3)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    const background = (element: Element | null): number[] => {
      if (!element) return [255, 255, 255];
      const color = rgb(getComputedStyle(element).backgroundColor);
      const alpha = color[3] ?? 1;
      if (alpha === 1) return color.slice(0, 3);
      const parent = background(element.parentElement);
      return color.slice(0, 3).map((v, i) => v * alpha + parent[i]! * (1 - alpha));
    };
    const contrast = (fg: string, element: Element) => {
      const b = luminance(background(element));
      const f = luminance(rgb(fg));
      return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
    };
    const minima = { text: 100, indicator: 100, focus: 100 };
    const footer = document.querySelector('.site-footer');
    if (footer)
      minima.text = Math.min(minima.text, contrast(getComputedStyle(footer).color, footer));
    for (const link of el.querySelectorAll<HTMLElement>('.primary-nav a')) {
      if (!link.getBoundingClientRect().height) continue;
      const style = getComputedStyle(link);
      minima.text = Math.min(minima.text, contrast(style.color, link));
      if (link.classList.contains('active'))
        minima.indicator = contrast(style.borderBottomColor, link);
    }
    for (const focused of el.querySelectorAll<HTMLElement>(':focus-visible')) {
      const style = getComputedStyle(focused);
      if (style.outlineStyle !== 'none')
        minima.focus = Math.min(minima.focus, contrast(style.outlineColor, focused));
    }
    return minima;
  });
  expect(result.text).toBeGreaterThanOrEqual(4.5);
  expect(result.indicator).toBeGreaterThanOrEqual(3);
  expect(result.focus).toBeGreaterThanOrEqual(3);
  return result;
}

test('개인 보유 자격의 상단 독립 메뉴·기존 주소·세 가지 학습 하위 메뉴와 목록 분리', async ({
  page,
  backend,
}) => {
  await prepare(backend.store);
  backend.setClock(DASHBOARD_NOW);
  await page.goto('/');
  await actor(page, 'alice');
  await expect(nav(page).getByRole('link')).toHaveText(['홈', '자격 취득', '보유 자격', /알림/]);
  await expect(nav(page).getByRole('link', { name: '보유 자격', exact: true })).toHaveAttribute(
    'href',
    '/qualifications?filter=certified',
  );
  const before = backend.store.snapshot();
  await top(page, '자격 취득');
  await expect(
    page.getByRole('navigation', { name: '자격 취득 메뉴' }).getByRole('link'),
  ).toHaveText(['내 계획', '학습', '평가']);
  await expect(page.getByRole('button', { name: /^보유 자격/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^진행 중/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '검증 제외', exact: true })).toBeVisible();
  await current(page, '자격 취득');
  await page.getByLabel('자격 검색').fill('학습 화면에서 사용한 검색어');
  const height = await page.addStyleTag({ content: '.qualification-list { min-height: 2200px }' });
  await page.evaluate(() => scrollTo(0, 700));
  await nav(page)
    .getByRole('link', { name: '보유 자격', exact: true })
    .evaluate((el: HTMLAnchorElement) => el.click());
  await expect(page).toHaveURL(/\/qualifications\?filter=certified$/);
  await expect(page.getByRole('heading', { name: '보유 자격', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '자격 취득 메뉴' })).toHaveCount(0);
  await expect(page.locator('[aria-label="자격 상태"]')).toHaveCount(0);
  await expect(page.getByLabel('자격 유효 상태')).toBeVisible();
  await expect(page.getByLabel('자격 검색')).toBeVisible();
  await expect(page.locator('.qualification-row')).toHaveCount(1);
  await current(page, '보유 자격');
  await expect(page.locator('#main')).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.getByLabel('자격 검색')).toHaveValue('');
  await height.evaluate((el) => el.parentNode?.removeChild(el));
  await page.reload();
  await current(page, '보유 자격');
  await top(page, '자격 취득');
  await page.goBack();
  await current(page, '보유 자격');
  await page.goForward();
  await current(page, '자격 취득');
  expect(backend.store.snapshot()).toEqual(before);
});

test('관리자 겸 학습자의 개인 인증서·수료증 왕복과 기존 관리/시스템 복귀를 구분', async ({
  page,
  backend,
}) => {
  await prepare(backend.store, true);
  backend.setClock(DASHBOARD_NOW);
  await page.goto('/');
  await actor(page, 'alice');
  await expect(page.getByRole('tab', { name: '시스템 운영', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await top(page, '보유 자격');
  const before = backend.store.snapshot();
  await page.locator('.qualification-row').click();
  await expect(page).toHaveURL(/\/certifications\/assignment-active-cert\?from=owned$/);
  await current(page, '보유 자격');
  await expect(page.locator('.back-link')).toHaveAttribute(
    'href',
    '/qualifications?filter=certified',
  );
  await page.getByRole('button', { name: '수료 근거 펼치기', exact: true }).click();
  await page.locator('.evidence-course summary').first().click();
  await page.getByRole('link', { name: '인증Set 수료증 보기 →', exact: true }).first().click();
  await expect(page).toHaveURL(/\/completions\/.*from=owned$/);
  await current(page, '보유 자격');
  await page.reload();
  await page.locator('.back-link').click();
  await current(page, '보유 자격');
  await page.locator('.back-link').click();
  await expect(page).toHaveURL(/filter=certified$/);
  await page.goto('/certifications/assignment-held-cert?from=owned');
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/system/overview');
  await current(page, '시스템 운영');
  await page.goto('/certifications/assignment-active-cert?lv1OrganizationId=org-photo&from=owned');
  await expect(page.locator('.back-link')).toHaveAttribute(
    'href',
    /\/admin\/results\?lv1OrganizationId=org-photo/,
  );
  await current(page, '인증 업무 관리');
  await page.goto('/certifications/assignment-active-cert');
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/system/overview');
  await current(page, '시스템 운영');
  expect(backend.store.snapshot()).toEqual(before);
});

test('검색·효력 필터·빈 목록과 기존 인증서 주소 및 일반 학습자의 접근 보호', async ({
  page,
  backend,
}) => {
  await prepare(backend.store);
  backend.setClock(DASHBOARD_NOW);
  await page.goto('/');
  for (const [id, status] of [
    ['alice', 'valid'],
    ['bob', 'held'],
    ['expired-member', 'revoked'],
  ]) {
    await actor(page, id!);
    await top(page, '보유 자격');
    await expect(page.locator('.qualification-row')).toHaveCount(1);
    await page.getByLabel('자격 유효 상태').selectOption(status!);
    await expect(page.locator('.qualification-row')).toHaveCount(1);
    await page.getByLabel('자격 검색').fill('존재하지 않는 자격');
    await expect(page.locator('.qualification-row')).toHaveCount(0);
    await page.getByLabel('자격 검색').fill('');
    await expect(page.locator('.qualification-row')).toHaveCount(1);
  }
  await actor(page, 'learner-2');
  await top(page, '보유 자격');
  await expect(
    page.getByRole('heading', { name: '완료된 인증이 없습니다.', exact: true }),
  ).toBeVisible();
  await actor(page, 'alice');
  await page.goto('/certifications/assignment-active-cert');
  await current(page, '보유 자격');
  await page.locator('.back-link').click();
  await expect(page).toHaveURL(/filter=certified$/);
  await page.goto('/certifications/assignment-held-cert?from=owned');
  await expect(
    page.getByRole('heading', { name: '인증을 찾을 수 없습니다.', exact: true }),
  ).toBeVisible();
  await page.goto('/');
  await actor(page, 'operator-1');
  await expect(nav(page).getByRole('link', { name: '보유 자격', exact: true })).toHaveCount(0);
  await page.goto('/qualifications?filter=certified');
  await expect(page).toHaveURL(/\/$/);
});

test('전체 역할의 네 화면 폭·1280 경계·세로 메뉴·Escape·초점·현재 위치와 헤더 캡처', async ({
  page,
  backend,
}, info) => {
  await prepare(backend.store, true);
  backend.setClock(DASHBOARD_NOW);
  await page.goto('/');
  await actor(page, 'alice');
  await top(page, '보유 자격');
  const metrics = [];
  for (const width of [1920, 1440, 1281, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const toggle = page.getByRole('button', { name: '메뉴', exact: true });
    let contrast;
    if (width <= 1280) {
      await expect(toggle).toBeVisible();
      await expect(nav(page)).not.toBeVisible();
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(nav(page)).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await nav(page).getByRole('link', { name: '보유 자격', exact: true }).focus();
      const links = await nav(page)
        .getByRole('link')
        .evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return { y: r.y, height: r.height };
          }),
        );
      expect(links.every((r) => r.height >= 44)).toBe(true);
      expect(links.every((r, i) => !i || r.y >= links[i - 1]!.y + links[i - 1]!.height)).toBe(true);
      contrast = await headerContrast(page);
      await page.screenshot({ path: info.outputPath(`header-open-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
      await expect(nav(page)).not.toBeVisible();
    } else {
      await expect(toggle).not.toBeVisible();
      await expect(nav(page)).toBeVisible();
      await nav(page).getByRole('link', { name: '보유 자격', exact: true }).focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      contrast = await headerContrast(page);
    }
    await current(page, '보유 자격');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('h1')).toHaveCSS('font-size', '24px');
    metrics.push({ width, contrast, header: await page.locator('.topbar').boundingBox() });
    await page.screenshot({ path: info.outputPath(`owned-${width}.png`), fullPage: true });
  }
  await openMenu(page);
  await nav(page).getByRole('link', { name: '자격 취득', exact: true }).click();
  await expect(nav(page)).not.toBeVisible();
  await current(page, '자격 취득');
  await writeFile(info.outputPath('header-metrics.json'), JSON.stringify(metrics, null, 2));
  await info.attach('header-metrics', {
    body: JSON.stringify(metrics),
    contentType: 'application/json',
  });
});

test('역할 회수 시 보유 자격 링크와 개인 목록에서 이탈하고 관리 권한은 유지한다', async ({
  page,
  backend,
}) => {
  await prepare(backend.store, true);
  await page.goto('/');
  await actor(page, 'alice');
  await top(page, '보유 자격');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'remove-learner',
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'alice')!.roles = ['admin', 'system_operator'];
      return {};
    },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(/\/$/);
  await expect(nav(page).getByRole('link', { name: '보유 자격', exact: true })).toHaveCount(0);
  await expect(nav(page).getByRole('link', { name: '인증 업무 관리', exact: true })).toBeVisible();
});

test('팀 관리자 겸 학습자의 개인 맥락과 from 없는 관리 인증서 복귀를 유지한다', async ({
  page,
  backend,
}) => {
  await prepare(backend.store, true);
  backend.setClock(DASHBOARD_NOW);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'team-admin-learner',
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'alice')!.roles = ['learner', 'admin'];
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'alice');
  await top(page, '보유 자격');
  await page.locator('.qualification-row').click();
  await current(page, '보유 자격');
  await expect(page.locator('.back-link')).toHaveAttribute(
    'href',
    '/qualifications?filter=certified',
  );
  await page.goto('/certifications/assignment-held-cert?from=owned');
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/admin/results');
  await current(page, '인증 업무 관리');
  await page.goto('/certifications/assignment-active-cert');
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/admin/results');
  await current(page, '인증 업무 관리');
});

test('긴 사용자·조직 이름과 모바일 메뉴 상태가 목록·계정 전환을 가리지 않는다', async ({
  page,
  backend,
}, info) => {
  await prepare(backend.store, true);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'long-owned-user',
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'alice')!.name =
        '개인 학습과 팀 관리를 함께 수행하는 사용자 '.repeat(3);
      return {};
    },
  );
  await backend.store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    'long-owned-team',
    () => {},
    (doc) => {
      doc.roots[0]!.name = '반도체 생산 기술과 품질 인증 운영을 담당하는 팀 '.repeat(3);
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'alice');
  await top(page, '보유 자격');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await openMenu(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`long-header-${width}.png`), fullPage: true });
    if (width <= 1280) await page.keyboard.press('Escape');
  }
  await openMenu(page);
  await nav(page).getByRole('link', { name: '자격 취득', exact: true }).click();
  await expect(nav(page)).not.toBeVisible();
  await actor(page, 'operator-1');
  await openMenu(page);
  await expect(nav(page).getByRole('link', { name: '보유 자격', exact: true })).toHaveCount(0);
});
