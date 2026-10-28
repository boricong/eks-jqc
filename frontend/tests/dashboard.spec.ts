import { test, expect, actor } from './fixtures';
import {
  configureDashboardFixture,
  DASHBOARD_SECRET,
  DASHBOARD_NOW,
} from '../../server/tests/dashboard-fixtures';
import type { Page } from '@playwright/test';
import type { DashboardResponse } from '@eks/contracts';

async function dashboard(page: Page, actorId = 'admin-1') {
  await page.goto('/');
  await actor(page, actorId);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await expect(page.getByRole('heading', { name: '인증 현황', exact: true })).toBeVisible();
}
async function headers(page: Page) {
  return {
    'X-Session-Tab': (await page.evaluate(() => sessionStorage.getItem('eks-session-tab')))!,
  };
}
async function current(page: Page) {
  const response = await page.request.get('/api/dashboard?lv1OrganizationId=org-photo', {
    headers: await headers(page),
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as DashboardResponse;
}

test('팀 요약 → 단위별 명세 → 구성원 근거, 닫기·초점과 순수 조회', async ({ page, backend }) => {
  backend.setClock(DASHBOARD_NOW);
  await configureDashboardFixture(backend.store);
  await dashboard(page);
  const value = await current(page);
  const metric = page.getByRole('button', {
    name: `대상 인원 ${value.summary.eligiblePeople}명 명세 보기`,
    exact: true,
  });
  await expect(metric).toBeVisible();
  await metric.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('가 직원');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(metric).toBeFocused();
  await page.getByRole('tab', { name: '구성원별', exact: true }).click();
  const planningRow = page
    .getByTestId('dashboard-members')
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: '정하린 상세 보기', exact: true }) });
  await expect(planningRow).toContainText('계획 요청');
  await expect(planningRow).toContainText('2026-10-20');
  await page.getByRole('button', { name: '가 직원 상세 보기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Active');
  await expect(dialog).toContainText('통과');
  await expect(dialog).not.toContainText(DASHBOARD_SECRET);
  await dialog.getByRole('button', { name: '닫기', exact: true }).first().click();
  const before = backend.store.snapshot();
  const organizations = backend.store.organizations.snapshot();
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.getByRole('button', { name: '가 직원 상세 보기', exact: true })).toBeVisible();
  expect(backend.store.snapshot()).toEqual(before);
  expect(backend.store.organizations.snapshot()).toEqual(organizations);
  await page.getByRole('button', { name: '가 직원 상세 보기', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('link', { name: '상세 근거 조회', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/results\/assignment-active-cert/);
  await expect(page.locator('.result-details')).toHaveCount(1);
  await expect(page.locator('.result-details')).toHaveAttribute('open', '');
});

test('세부 관리자는 하위 조직도 조회하고 기존 결과 권한은 확대되지 않는다', async ({
  page,
  backend,
}) => {
  backend.setClock(DASHBOARD_NOW);
  await configureDashboardFixture(backend.store);
  await dashboard(page, 'learner-2');
  await expect(page.getByRole('tab', { name: '조직별', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '관리 메뉴' }).getByRole('link')).toHaveCount(
    4,
  );
  await page.getByRole('tab', { name: '구성원별', exact: true }).click();
  await expect(page.getByRole('button', { name: '가 직원 상세 보기', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '하위 직원 상세 보기', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '나 직원 상세 보기', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '가 직원 상세 보기', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('통과');
  await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(0);
  const denied = await page.request.get('/api/dashboard/members/bob?lv1OrganizationId=org-photo', {
    headers: await headers(page),
  });
  expect(denied.status()).toBe(403);
  await page.keyboard.press('Escape');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'dashboard-revoke-role',
    () => {},
    (s) => {
      delete s.users.find((u) => u.id === 'learner-2')!.organizationAdministration;
      return {};
    },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.dashboard-view')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('네 화면 폭에서 표·매트릭스·필터·글자·키보드와 내부 스크롤', async ({
  page,
  backend,
}, info) => {
  backend.setClock(DASHBOARD_NOW);
  await configureDashboardFixture(backend.store);
  await dashboard(page);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: '인증 현황', exact: true })).toHaveCSS(
      'font-size',
      '24px',
    );
    await expect(page.locator('.dashboard-view')).toHaveCSS('font-family', /Pretendard/);
    for (const name of ['요약', '조직별', '자격별', '구성원별', '만료·재인증']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      if (name === '조직별')
        await expect(
          page.getByRole('columnheader', { name: '기한 경과', exact: true }),
        ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBeTruthy();
      if (name === '요약' && width === 1920)
        await page.screenshot({
          path: info.outputPath('dashboard-summary-desktop.png'),
          fullPage: true,
        });
    }
    await page.getByRole('tab', { name: '구성원별', exact: true }).click();
    await page.getByRole('button', { name: '매트릭스', exact: true }).click();
    await expect(page.getByTestId('dashboard-matrix')).toBeVisible();
    await expect(page.getByTestId('dashboard-matrix')).toHaveCSS('font-size', '14px');
    const contrast = await page.evaluate(() => {
      const rgb = (color: string) =>
        color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      const light = (color: number[]) =>
        color
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const ratio = (a: string, b: string) => {
        const x = light(rgb(a)),
          y = light(rgb(b));
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const background = (el: Element): string => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const color = getComputedStyle(node).backgroundColor;
          if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
        }
        return 'rgb(255, 255, 255)';
      };
      const samples = [
        ...document.querySelectorAll(
          '.dashboard-view .dashboard-status, .dashboard-view .dashboard-meta, .dashboard-view .dashboard-link',
        ),
      ].filter((el) => el.getBoundingClientRect().height > 0);
      const input = document.querySelector('.dashboard-scope select')!;
      return {
        text: samples.map((el) => ratio(getComputedStyle(el).color, background(el))),
        boundary: ratio(getComputedStyle(input).borderTopColor, background(input)),
      };
    });
    expect(Math.min(...contrast.text)).toBeGreaterThanOrEqual(4.5);
    expect(contrast.boundary).toBeGreaterThanOrEqual(3);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy();
    await page.screenshot({
      path: info.outputPath(`dashboard-matrix-${width}.png`),
      fullPage: true,
    });
    if (width === 390) {
      const controls = page
        .locator('.dashboard-view')
        .getByRole('button', { name: '새로고침', exact: true });
      expect((await controls.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('button', { name: '목록', exact: true }).click();
  }
  await page.getByRole('tab', { name: '구성원별', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: '요약', exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath('dashboard-summary-mobile.png'), fullPage: true });
});

test('첫 조회 실패는 빈 집계로 표시하지 않고 재시도로 복구한다', async ({ page, backend }) => {
  backend.setClock(DASHBOARD_NOW);
  await configureDashboardFixture(backend.store);
  let failed = true;
  await page.route('**/api/dashboard?*', async (route) => {
    if (failed)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '첫 조회 시험 오류', code: 'TEST_FAILURE' }),
      });
    else await route.continue();
  });
  await dashboard(page);
  await expect(page.getByRole('alert')).toContainText('첫 조회 시험 오류');
  await expect(page.getByRole('button', { name: /대상 인원 .*명 명세 보기/ })).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: '다시 조회', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '대상 인원 5명 명세 보기', exact: true }),
  ).toBeVisible();
});

test('탭별 필터·주소 복원과 실패 시 선택 유지·다시 조회', async ({ page, backend }) => {
  backend.setClock(DASHBOARD_NOW);
  await configureDashboardFixture(backend.store);
  await dashboard(page);
  await page.getByRole('tab', { name: '구성원별', exact: true }).click();
  await page.getByLabel('구성원 검색', { exact: true }).fill('가 직원');
  await expect(page.getByRole('button', { name: '가 직원 상세 보기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '나 직원 상세 보기', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/search=/);
  await page.getByRole('tab', { name: '요약', exact: true }).click();
  await page.getByRole('tab', { name: '구성원별', exact: true }).click();
  await expect(page.getByLabel('구성원 검색', { exact: true })).toHaveValue('가 직원');
  await page.reload();
  await expect(page.getByLabel('구성원 검색', { exact: true })).toHaveValue('가 직원');
  let failed = true;
  await page.route('**/api/dashboard?*', async (route) => {
    if (failed)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '가상 조회 실패', code: 'TEST_FAILURE' }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('가상 조회 실패');
  await expect(page.getByLabel('구성원 검색', { exact: true })).toHaveValue('가 직원');
  await expect(page.getByRole('button', { name: '가 직원 상세 보기', exact: true })).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: '다시 조회', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('상세 기준 변경은 요약과 함께 갱신하고 개인 데이터는 브라우저에 저장하지 않는다', async ({
  page,
  backend,
}) => {
  backend.setClock(DASHBOARD_NOW);
  await configureDashboardFixture(backend.store);
  await dashboard(page);
  const before = await current(page);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'dashboard-add-person',
    () => {},
    (s) => {
      s.users.push({
        id: 'new-person',
        name: '새 구성원',
        roles: ['learner'],
        organizationId: 'dashboard-a',
        revision: 1,
      });
      return {};
    },
  );
  await page
    .getByRole('button', {
      name: `대상 인원 ${before.summary.eligiblePeople}명 명세 보기`,
      exact: true,
    })
    .click();
  await expect(page.getByRole('dialog')).toContainText('새 구성원');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', {
      name: `대상 인원 ${before.summary.eligiblePeople + 1}명 명세 보기`,
      exact: true,
    }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) => key.includes('dashboard')),
  );
  expect(JSON.stringify(saved)).not.toContain('새 구성원');
  expect(JSON.stringify(saved)).not.toContain(DASHBOARD_SECRET);
});

test('운영자 팀 전환은 대시보드를 유지하고 일반 학습자는 접근하지 못한다', async ({
  page,
  backend,
}) => {
  backend.setClock(DASHBOARD_NOW);
  await configureDashboardFixture(backend.store);
  await dashboard(page, 'operator-1');
  await page.getByLabel('관리할 Lv1 조직').selectOption('org-photo');
  await expect(page).toHaveURL(/\/admin\/dashboard.*org-photo/);
  await expect(page.getByRole('button', { name: /대상 인원 .*명 명세 보기/ })).toBeVisible();
  await page.getByLabel('관리할 Lv1 조직').selectOption('org-etch');
  await expect(page).toHaveURL(/\/admin\/dashboard.*org-etch/);
  await expect(
    page.getByRole('button', { name: '대상 인원 0명 명세 보기', exact: true }),
  ).toBeVisible();
  await page.goto('/');
  await actor(page, 'alice');
  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: '인증 업무 관리', exact: true })).toHaveCount(0);
});

test('조직 전환 중 늦게 도착한 응답이 새 범위의 수치를 덮어쓰지 않는다', async ({
  page,
  backend,
}) => {
  backend.setClock(DASHBOARD_NOW);
  await configureDashboardFixture(backend.store);
  await dashboard(page);
  let release!: () => void;
  let received!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    received = resolve;
  });
  let delay = true;
  await page.route('**/api/dashboard?*', async (route) => {
    const url = new URL(route.request().url());
    if (delay && url.searchParams.get('organizationId') === 'org-photo') {
      delay = false;
      const response = await route.fetch();
      received();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await started;
  try {
    await page.getByLabel('조회 조직', { exact: true }).selectOption('dashboard-a');
    await expect(
      page.getByRole('button', { name: '대상 인원 4명 명세 보기', exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByLabel('조회 조직', { exact: true })).toHaveValue('dashboard-a');
  await expect(
    page.getByRole('button', { name: '대상 인원 5명 명세 보기', exact: true }),
  ).toHaveCount(0);
});

test('많은 인원·긴 이름·11개 이상 자격에서 명세와 매트릭스의 양방향 페이지 유지', async ({
  page,
  backend,
}, info) => {
  backend.setClock(DASHBOARD_NOW);
  await configureDashboardFixture(backend.store);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'dashboard-many-records',
    () => {},
    (s) => {
      for (let i = 0; i < 55; i++)
        s.users.push({
          id: `many-${i}`,
          name: `추가 구성원 ${String(i).padStart(2, '0')}`,
          roles: ['learner'],
          organizationId: 'dashboard-a',
          revision: 1,
        });
      s.users.find((u) => u.id === 'alice')!.name =
        '가 직원 이름이 길어서 줄바꿈과 표의 내부 스크롤을 확인하는 구성원';
      const original = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      for (let i = 0; i < 12; i++) {
        const id = `many-q-${i}`,
          templateId = `many-template-${i}`;
        s.qualificationTemplates.push({
          defaultCommonCourseIds: [],
          id: templateId,
          qualificationType: 'auditee',
          revision: 1,
          title: `표준 가상 자격 ${String(i).padStart(2, '0')} 긴 이름과 기준 정보`,
          englishName: '',
          description: '가상 UI 시험',
          updatedBy: 'operator-1',
          updatedAt: DASHBOARD_NOW,
        });
        s.qualifications.push({ ...structuredClone(original), id, entityId: id, templateId });
      }
      return {};
    },
  );
  await dashboard(page);
  await page.getByRole('button', { name: '대상 인원 60명 명세 보기', exact: true }).click();
  await expect(page.getByRole('dialog').locator('tbody tr')).toHaveCount(25);
  await page.getByRole('button', { name: '명세 다음 페이지', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '명세 페이지' })).toContainText('2 / 3');
  await expect(page).toHaveURL(/detailPage=2/);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '구성원별', exact: true }).click();
  await page.getByRole('button', { name: '매트릭스', exact: true }).click();
  const matrix = page.getByTestId('dashboard-matrix');
  await expect(matrix.locator('thead th')).toHaveCount(11);
  await expect(matrix.locator('tbody tr')).toHaveCount(25);
  await page.getByRole('button', { name: '다음 자격 열', exact: true }).click();
  await expect(matrix.locator('thead th')).toHaveCount(4);
  await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
  await expect(page).toHaveURL(/columnPage=2/);
  await expect(page).toHaveURL(/page=2/);
  await expect(matrix.locator('tbody tr')).toHaveCount(25);
  await page.reload();
  await expect(matrix.locator('thead th')).toHaveCount(4);
  await expect(page.getByRole('navigation', { name: '현황 페이지' })).toContainText('2 / 3');
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy();
  await page.screenshot({ path: info.outputPath('dashboard-many-mobile.png'), fullPage: true });
});
