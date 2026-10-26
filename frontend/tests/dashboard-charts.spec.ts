import { test, expect, actor } from './fixtures';
import { configureDashboardFixture, DASHBOARD_NOW, Q } from '../../server/tests/dashboard-fixtures';
import type { Page } from '@playwright/test';
async function start(
  page: Page,
  store: Parameters<typeof configureDashboardFixture>[0],
  role = 'admin-1',
) {
  await configureDashboardFixture(store);
  await page.goto('/');
  await actor(page, role);
  await page.goto('/admin/dashboard');
  await expect(page.locator('[data-chart="required-coverage"]')).toBeVisible();
}
test('차트·확대 → 구간 명세 → 개인 → 뒤로·Escape·원래 초점과 URL 복원', async ({
  page,
  backend,
}, info) => {
  backend.setClock(DASHBOARD_NOW);
  await start(page, backend.store);
  const button = page.getByRole('button', { name: '필수 자격 충족 크게 보기', exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '필수 자격 충족', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('chart-expanded-desktop.png') });
  await dialog.locator('circle[role="button"]').first().focus();
  await page.keyboard.press('Space');
  await expect(dialog).toContainText('가 직원');
  await expect(page).toHaveURL(/chartGroup=all/);
  await expect(dialog.locator('.dashboard-table tbody tr')).toHaveCount(1);
  await dialog.getByRole('button', { name: '가 직원', exact: true }).click();
  await expect(dialog).toContainText('인증Set 수료');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await dialog.getByRole('button', { name: '명세로 돌아가기', exact: true }).click();
  await expect(dialog.locator('.dashboard-table tbody tr')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: '가 직원', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: '차트로 돌아가기', exact: true }).click();
  await dialog.getByRole('button', { name: '데이터 표 보기', exact: true }).click();
  await expect(dialog.getByRole('region', { name: '필수 자격 충족 데이터 표' })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('dialog').getByRole('region', { name: '필수 자격 충족 데이터 표' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await button.click();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
});

test('전체 탭·네 화면 폭·긴 차트·큰 화면과 모바일 전체화면·데이터표 접근', async ({
  page,
  backend,
}, info) => {
  backend.setClock(DASHBOARD_NOW);
  await start(page, backend.store);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of ['요약', '조직별', '자격별', '구성원별', '만료·재인증']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.locator('.dashboard-charts')).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBeTruthy();
    }
    await page.getByRole('button', { name: '만료 구간별 인증 크게 보기', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    if (width === 390) {
      expect((await dialog.boundingBox())!.width).toBe(390);
      const controls = dialog.getByRole('button', { name: '데이터 표 보기', exact: true });
      expect((await controls.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByRole('button', { name: '데이터 표 보기', exact: true }).click();
    await expect(
      dialog.getByRole('region', { name: '만료 구간별 인증 데이터 표', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath('charts-' + width + '.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '요약', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '필수 자격 충족 크게 보기', exact: true }),
    ).toBeVisible();
    const metrics = await page.evaluate(() => {
      const root = document.querySelector('.dashboard-charts')!;
      const light = (value: string) =>
        value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map((v) => Number(v) / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const ratio = (a: string, b: string) =>
        (Math.max(light(a), light(b)) + 0.05) / (Math.min(light(a), light(b)) + 0.05);
      const style = (selector: string) => getComputedStyle(root.querySelector(selector)!);
      return {
        columns: getComputedStyle(root).gridTemplateColumns.split(' ').length,
        font: getComputedStyle(root).fontFamily,
        heading: style('h2').fontSize,
        text: ratio(style('.chart-unit').color, 'rgb(255,255,255)'),
        fills: [...root.querySelectorAll('.chart-swatch')].map((el) =>
          ratio(getComputedStyle(el).backgroundColor, 'rgb(255,255,255)'),
        ),
      };
    });
    expect(metrics.columns).toBe(width >= 1280 ? 2 : 1);
    expect(metrics.font).toContain('Pretendard');
    expect(metrics.heading).toBe('18px');
    expect(metrics.text).toBeGreaterThanOrEqual(4.5);
    expect(Math.min(...metrics.fills)).toBeGreaterThanOrEqual(3);
    await page.screenshot({
      path: info.outputPath('summary-charts-' + width + '.png'),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test('구성원 필터·기존 목록 페이지 유지와 확대 명세의 실패·재시도·갱신', async ({
  page,
  backend,
}) => {
  backend.setClock(DASHBOARD_NOW);
  await start(page, backend.store);
  await page.getByRole('tab', { name: '구성원별', exact: true }).click();
  await page.getByLabel('구성원 검색', { exact: true }).fill('가 직원');
  await expect(page.getByTestId('dashboard-members').locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '구성원 필수 충족 분포 크게 보기', exact: true }).click();
  let fail = true;
  await page.route('**/api/dashboard/chart-details?*', async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'TEST', message: '시험 조회 실패' }),
      });
    else await route.continue();
  });
  await page
    .getByRole('dialog')
    .locator('.chart-value-legend')
    .getByRole('button', { name: '전체 충족 1 명 명세 보기', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('시험 조회 실패');
  fail = false;
  await page.getByRole('dialog').getByRole('button', { name: '다시 조회', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('가 직원');
  await expect(page).toHaveURL(/search=/);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'chart-revision',
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'alice')!.name = '가 직원 변경';
      return {};
    },
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '차트로 돌아가기', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .locator('.chart-value-legend')
    .getByRole('button', { name: '전체 충족 1 명 명세 보기', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('가 직원 변경');
  await expect(page.getByRole('dialog')).toContainText('최신 기준');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('구성원 검색', { exact: true })).toHaveValue('가 직원');
});

test('세부 관리자 차트에는 조직비교가 없으며 직접 소속 밖의 명세를 노출하지 않는다', async ({
  page,
  backend,
}) => {
  backend.setClock(DASHBOARD_NOW);
  await start(page, backend.store, 'learner-2');
  await expect(page.locator('[data-chart="organization-coverage"]')).toHaveCount(0);
  await page.getByRole('tab', { name: '구성원별', exact: true }).click();
  await page.getByRole('button', { name: '구성원 필수 충족 분포 크게 보기', exact: true }).click();
  await page
    .getByRole('dialog')
    .locator('.chart-value-legend')
    .getByRole('button', { name: '미충족 2 명 명세 보기', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toContainText('하위 직원');
  await expect(page.getByRole('dialog')).not.toContainText('나 직원');
  await expect(page.getByRole('dialog').locator('tbody tr')).toHaveCount(2);
});

test('명세 전환 중 이전 응답을 폐기하고 세부 관리자 권한 해제 시 개인 자료를 지운다', async ({
  page,
  backend,
}) => {
  backend.setClock(DASHBOARD_NOW);
  await start(page, backend.store, 'learner-2');
  await page.getByRole('button', { name: '계획·취득 단계 크게 보기', exact: true }).click();
  let release!: () => void, received!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    started = new Promise<void>((r) => {
      received = r;
    });
  let once = true;
  await page.route('**/api/dashboard/chart-details?*', async (route) => {
    if (once && new URL(route.request().url()).searchParams.get('seriesKey') === 'draft') {
      once = false;
      const response = await route.fetch();
      received();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  await page
    .getByRole('dialog')
    .locator('.chart-distribution')
    .getByRole('button', { name: '계획 작성 1 사람·자격 명세 보기', exact: true })
    .click();
  await started;
  try {
    await page.getByRole('button', { name: '차트로 돌아가기', exact: true }).click();
    await page
      .getByRole('dialog')
      .locator('.chart-distribution')
      .getByRole('button', { name: '계획 미작성 1 사람·자격 명세 보기', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toContainText('만료 직원');
  } finally {
    release();
  }
  await expect(page.getByRole('dialog')).not.toContainText('정하린');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'chart-role-revoked',
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

test('많은 자격의 차트8개 미리보기·20개 확대 페이지·URL 복원', async ({ page, backend }) => {
  backend.setClock(DASHBOARD_NOW);
  await start(page, backend.store);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'many-chart-qualifications',
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === Q)!;
      for (let i = 0; i < 25; i++) {
        const id = 'chart-q-' + i,
          templateId = 'chart-template-' + i;
        s.qualificationTemplates.push({
          id: templateId,
          qualificationType: 'auditee',
          revision: 1,
          title: '차트 검증 자격 ' + i + ' 긴 이름과 줄바꿈',
          englishName: '',
          description: '',
          updatedBy: 'operator-1',
          updatedAt: DASHBOARD_NOW,
        });
        s.qualifications.push({ ...structuredClone(q), id, entityId: id, templateId });
      }
      return {};
    },
  );
  await page.getByRole('tab', { name: '자격별', exact: true }).click();
  const card = page.locator('[data-chart="qualification-coverage"]');
  await expect(card).toContainText('전체 26개 중 8개');
  await expect(card.locator('.chart-comparison > li')).toHaveCount(8);
  await card.getByRole('button', { name: '자격별 필수 충족률 크게 보기', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.chart-comparison > li')).toHaveCount(20);
  await page.getByRole('button', { name: '차트 다음 항목', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.chart-comparison > li')).toHaveCount(6);
  await expect(page).toHaveURL(/chartPage=2/);
  await page.reload();
  await expect(page.getByRole('dialog').locator('.chart-comparison > li')).toHaveCount(6);
  await page.keyboard.press('Escape');
});
