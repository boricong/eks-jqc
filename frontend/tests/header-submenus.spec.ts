import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { actor, answerConfirmation, expect, test } from './fixtures';
import { configureDashboardFixture, DASHBOARD_NOW } from '../../server/tests/dashboard-fixtures';

const main = (page: Page) => page.locator('#primary-navigation');
const toggle = (page: Page, id: string) => main(page).locator(`[data-submenu-toggle="${id}"]`);
const panel = (page: Page, id: string) => main(page).locator(`[data-submenu-panel="${id}"]`);
const managementNames = [
  '인증 현황',
  '취득 대상자 상태',
  'Auditor 운영',
  '계획 요청·진행',
  '평가·수료 결과',
  '보유 자격 관리',
  '팀 사용자 관리',
  '조직 정보·관리자',
  '조직 필요자격',
  '팀 자격 설정',
  '인증Set 설정',
  '팀 공지 관리',
];
async function multi(backend: Parameters<typeof configureDashboardFixture>[0]) {
  await configureDashboardFixture(backend);
  await backend.transact(
    'operator-1',
    crypto.randomUUID(),
    'header-all-roles',
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'alice')!.roles = ['learner', 'admin', 'system_operator'];
      return {};
    },
  );
  await backend.refreshNotifications(DASHBOARD_NOW);
}

test('권한별 공유 하위 메뉴·호버/팝업 왕복·조회/저장 없는 펼침과 부모 링크', async ({
  page,
  backend,
}) => {
  backend.setClock(DASHBOARD_NOW);
  await multi(backend.store);
  await page.goto('/');
  await actor(page, 'alice');
  const before = backend.store.snapshot(),
    organizations = backend.store.organizations.snapshot();
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests++;
  });
  await main(page).getByRole('link', { name: '인증 업무 관리', exact: true }).hover();
  await expect(panel(page, 'management')).toBeVisible();
  await expect(panel(page, 'management').getByRole('link')).toHaveText(managementNames);
  await expect(panel(page, 'management').getByRole('heading')).toHaveText([
    '현황 조회',
    '인증 운영',
    '조직 관리',
    '자격 기준 설정',
    '팀 소통',
  ]);
  await panel(page, 'management').getByRole('link', { name: '팀 자격 설정', exact: true }).hover();
  await expect(toggle(page, 'management')).toHaveAttribute('aria-expanded', 'true');
  await main(page).getByRole('link', { name: '시스템 운영', exact: true }).hover();
  await expect(panel(page, 'system')).toBeVisible();
  await expect(panel(page, 'management')).toHaveCount(0);
  await expect(panel(page, 'system').getByRole('link')).toHaveText([
    '기본자격 관리',
    '공통인증Set 관리',
    '조직 관리',
    '사용자 관리',
    '전체 업무 조회',
    '테스트 데이터 관리',
    '시스템 공지 관리',
    '문서 조회',
  ]);
  await page.mouse.move(20, 400);
  await expect(panel(page, 'system')).toHaveCount(0);
  expect(requests).toBe(0);
  expect(backend.store.snapshot()).toEqual(before);
  expect(backend.store.organizations.snapshot()).toEqual(organizations);
  await main(page).getByRole('link', { name: '시스템 운영', exact: true }).click();
  await expect(page).toHaveURL(/\/system\/organizations$/);
  await main(page).getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await main(page).getByRole('link', { name: '자격 취득', exact: true }).click();
  await expect(page).toHaveURL(/\/qualifications$/);
  await actor(page, 'learner-2');
  await toggle(page, 'management').click();
  await expect(panel(page, 'management').getByRole('link')).toHaveText([
    '인증 현황',
    '취득 대상자 상태',
    '조직 정보·관리자',
    '조직 필요자격',
  ]);
  await expect(toggle(page, 'system')).toHaveCount(0);
  await actor(page, 'admin-1');
  await expect(toggle(page, 'learning')).toHaveCount(0);
  await toggle(page, 'management').click();
  await expect(panel(page, 'management').getByRole('link')).toHaveText(managementNames);
});

test('키보드 펼침·위/아래·Tab·Escape 복귀·외부 클릭·목록 목적지와 뒤로 가기', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  const button = toggle(page, 'learning');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(
    panel(page, 'learning').getByRole('link', { name: '내 계획', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await expect(panel(page, 'learning')).toHaveCount(0);
  await page.keyboard.press('ArrowUp');
  await expect(
    panel(page, 'learning').getByRole('link', { name: '평가', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');
  await expect(
    panel(page, 'learning').getByRole('link', { name: '내 계획', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Space');
  await expect(panel(page, 'learning')).toBeVisible();
  await page.locator('h1, h2').filter({ hasText: '진행 중인 자격' }).first().click();
  await expect(panel(page, 'learning')).toHaveCount(0);
  await page.goto('/qualifications/assignment-1?course=demo-course-2');
  await button.click();
  await expect(
    panel(page, 'learning').getByRole('link', { name: '학습', exact: true }),
  ).toHaveAttribute('href', '/qualifications');
  await panel(page, 'learning').getByRole('link', { name: '평가', exact: true }).click();
  await expect(page).toHaveURL(/\/qualifications\?stage=assessment$/);
  await expect(panel(page, 'learning')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/qualifications\/assignment-1\?course=demo-course-2$/);
  await button.click();
  await expect(
    panel(page, 'learning').getByRole('link', { name: '학습', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await button.focus();
  await page.keyboard.press('Escape');
  await button.focus();
  await page.keyboard.press('Tab');
  // 닫힌 팝업의 링크는 Tab 경로에 포함되지 않는다.
  await expect(main(page).getByRole('link', { name: '보유 자격', exact: true })).toBeFocused();
});

test('관리 조직 경로·미저장 이동 취소/확인과 권한 회수 시 닫힘', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/admin/targets?lv1OrganizationId=org-etch');
  await toggle(page, 'management').click();
  await expect(
    panel(page, 'management').getByRole('link', { name: '팀 자격 설정', exact: true }),
  ).toHaveAttribute('href', '/admin/qualifications?lv1OrganizationId=org-etch');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  await page.getByLabel('인증Set명', { exact: true }).fill('헤더 이동 취소 시 보존');
  await toggle(page, 'management').click();
  await panel(page, 'management').getByRole('link', { name: '팀 자격 설정', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(page).toHaveURL(/\/admin\/courses\/demo-course-1/);
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('헤더 이동 취소 시 보존');
  await expect(panel(page, 'management')).toBeVisible();
  await panel(page, 'management').getByRole('link', { name: '팀 자격 설정', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(page).toHaveURL(/\/admin\/qualifications/);
  await expect(panel(page, 'management')).toHaveCount(0);
  await toggle(page, 'management').click();
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'revoke-header',
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'admin-1')!.roles = ['learner'];
      return {};
    },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(toggle(page, 'management')).toHaveCount(0);
  await expect(page.locator('.header-submenu')).toHaveCount(0);
});

test('6폭 헤더/팝업 정렬·대비·현재 위치·모바일 스크롤과 2단계 Escape', async ({
  page,
  backend,
}, info) => {
  backend.setClock(DASHBOARD_NOW);
  await multi(backend.store);
  await page.goto('/');
  await actor(page, 'alice');
  const metrics = [];
  for (const width of [1920, 1440, 1281, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 1280) await page.getByRole('button', { name: '메뉴', exact: true }).click();
    for (const id of ['learning', 'management', 'system']) {
      await toggle(page, id).focus();
      await page.keyboard.press('ArrowDown');
      const popup = panel(page, id);
      await expect(popup).toBeVisible();
      const values = await popup.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const rgb = (value: string) => {
          const parts = value.match(/[\d.]+/g);
          if (!parts)
            throw new Error(
              `색상 오류 ${JSON.stringify({ value, connected: el.isConnected, styles: [...el.querySelectorAll('a')].map((a) => ({ text: a.textContent, color: getComputedStyle(a).color, bg: getComputedStyle(a).backgroundColor })) })}`,
            );
          return parts.slice(0, 3).map(Number);
        };
        const lum = (color: string) =>
          rgb(color)
            .map((x) => {
              x /= 255;
              return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i]!, 0);
        const ratio = (a: string, b: string) =>
          (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
        const links = [...el.querySelectorAll<HTMLElement>('a')];
        const background = getComputedStyle(el).backgroundColor;
        const focus = links.find((a) => a.matches(':focus-visible'))!;
        return {
          left: box.left,
          right: box.right,
          width: box.width,
          height: box.height,
          font: getComputedStyle(links[0]!).fontSize,
          minHeight: Math.min(...links.map((a) => a.getBoundingClientRect().height)),
          text: Math.min(
            ...links.map((a) =>
              ratio(getComputedStyle(a).color, getComputedStyle(a).backgroundColor),
            ),
          ),
          focus: ratio(
            getComputedStyle(focus).outlineColor,
            background.startsWith('rgba') ? 'rgb(255, 255, 255)' : background,
          ),
          pageWidth: document.documentElement.scrollWidth,
          header: document.querySelector('.topbar')!.getBoundingClientRect().height,
        };
      });
      expect(values.left).toBeGreaterThanOrEqual(0);
      expect(values.right).toBeLessThanOrEqual(width);
      expect(values.pageWidth).toBeLessThanOrEqual(width);
      expect(values.header).toBe(56);
      expect(values.font).toBe('14px');
      expect(values.minHeight).toBeGreaterThanOrEqual(width <= 1280 ? 44 : 40);
      expect(values.text).toBeGreaterThanOrEqual(4.5);
      expect(values.focus).toBeGreaterThanOrEqual(3);
      if (width > 1280) expect(values.width).toBe(280);
      metrics.push({ viewportWidth: width, id, ...values });
      await page.screenshot({ path: info.outputPath(`header-${id}-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(toggle(page, id)).toBeFocused();
      if (width <= 1280) await expect(main(page)).toBeVisible();
    }
    if (width <= 1280) {
      await page.keyboard.press('Escape');
      await expect(main(page)).toBeHidden();
      await expect(page.getByRole('button', { name: '메뉴', exact: true })).toBeFocused();
    }
  }
  await page.setViewportSize({ width: 390, height: 400 });
  await page.getByRole('button', { name: '메뉴', exact: true }).click();
  await toggle(page, 'management').click();
  const scrolling = await main(page).evaluate((el) => ({
    height: el.clientHeight,
    scroll: el.scrollHeight,
    overflow: getComputedStyle(el).overflowY,
  }));
  expect(scrolling.height).toBeLessThanOrEqual(328);
  expect(scrolling.scroll).toBeGreaterThan(scrolling.height);
  expect(scrolling.overflow).toBe('auto');
  await writeFile(info.outputPath('header-submenu-metrics.json'), JSON.stringify(metrics, null, 2));
});

test('응시 중 헤더 이동도 답안 저장 실패/취소·성공·동일 회차 복원을 따른다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  const assessment = '/qualifications/assignment-1/courses/demo-course-2/objective';
  await page.goto(assessment);
  let fail = true;
  await page.route('**/api/attempts/*/draft', async (route) => {
    if (fail && route.request().method() === 'PUT')
      await route.fulfill({ status: 503, json: { message: '헤더 이동 저장 실패' } });
    else await route.continue();
  });
  await page.getByRole('radio').first().check();
  await expect(page.locator('.save-error')).toContainText('헤더 이동 저장 실패');
  const attempts = backend.store.snapshot().attempts.length;
  await toggle(page, 'learning').click();
  await panel(page, 'learning').getByRole('link', { name: '학습', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(page).toHaveURL(new RegExp(assessment + '$'));
  await expect(page.getByRole('radio').first()).toBeChecked();
  await expect(panel(page, 'learning')).toBeVisible();
  fail = false;
  await panel(page, 'learning').getByRole('link', { name: '학습', exact: true }).click();
  await expect(page).toHaveURL(/\/qualifications$/);
  await page.goto(assessment);
  await expect(page.getByRole('radio').first()).toBeChecked();
  expect(backend.store.snapshot().attempts.length).toBe(attempts);
});

test.describe('터치 탐색', () => {
  test.use({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
  test('상위 이름은 이동·화살표는 펼침·하위 항목으로 직접 진입', async ({ page }) => {
    await page.goto('/');
    await actor(page, 'operator-1');
    await page.getByRole('button', { name: '메뉴', exact: true }).tap();
    await toggle(page, 'system').tap();
    await expect(panel(page, 'system')).toBeVisible();
    await panel(page, 'system').getByRole('link', { name: '사용자 관리', exact: true }).tap();
    await expect(page).toHaveURL(/\/system\/users$/);
    await expect(main(page)).toBeHidden();
    await page.getByRole('button', { name: '메뉴', exact: true }).tap();
    await main(page).getByRole('link', { name: '시스템 운영', exact: true }).tap();
    await expect(page).toHaveURL(/\/system\/organizations$/);
  });
});
