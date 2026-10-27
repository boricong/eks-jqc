import { answerConfirmation } from './fixtures';
import { courseSection, saveCriterion } from './catalog-helpers';
import { test, expect, actor } from './fixtures';
import { requestPlan } from './workflow-helpers';

async function noPageOverflow(page: import('@playwright/test').Page) {
  const { content, viewport } = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(content).toBeLessThanOrEqual(viewport);
}

test('인증Set 필수 평가와 개별 학습 탭, 3년 인증기간, 좁은 화면', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  const group = page.getByRole('group', { name: '평가 유형' });
  await expect(group.getByRole('checkbox')).toHaveCount(3);
  await courseSection(page, '학습 정보');
  await page.getByRole('button', { name: '교육 추가' }).click();
  await expect(
    page.getByRole('tablist', { name: '학습 정보 항목' }).getByRole('tab', { name: /^교육/ }),
  ).toHaveCount(2);
  const title = page.getByLabel('교육명');
  await expect(title).toBeFocused();
  await title.fill('안전 상태 확인');
  await page.getByRole('button', { name: '교육 추가' }).click();
  await title.fill('결과 기록');
  const tabs = page.getByRole('tablist', { name: '학습 정보 항목' });
  await tabs.getByRole('tab', { name: /교육 3 · 결과 기록/ }).press('ArrowUp');
  await expect(tabs.getByRole('tab', { name: /교육 2 · 안전 상태 확인/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: '이 항목 삭제' }).click();
  await answerConfirmation(page, true);
  await expect(tabs.getByRole('tab', { name: /^교육/ })).toHaveCount(2);
  await expect(tabs.getByRole('tab', { name: /교육 3 · 결과 기록/ })).toHaveCount(0);
  await expect(tabs.getByRole('tab', { name: /교육 2 · 결과 기록/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  for (const width of [1920, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });

    await expect(tabs).toBeVisible();
    await noPageOverflow(page);
  }
  await page.goto('/admin/qualifications/recipe');
  await page.getByLabel('인증기간', { exact: true }).selectOption('three-years');
  await expect(page.getByLabel('유효 개월 수')).toHaveCount(0);
  await expect(page.getByLabel('재인증 시작 N일 전 알림')).toHaveValue('7');
  await page.getByLabel('인증기간', { exact: true }).selectOption('months');
  await expect(page.getByLabel('유효 개월 수')).toBeVisible();
  await noPageOverflow(page);
});

test('계획 단계는 날짜·저장을 검사하고 목표 없이 최종 확인을 허용한다', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await page.getByLabel('취득할 자격').selectOption('demo-qualification');
  await page.getByRole('button', { name: '계획 수립 시작', exact: true }).click();
  await page.getByLabel('종료일', { exact: true }).fill('');
  await page.getByRole('button', { name: '3. 최종 확인' }).click();
  await expect(page.getByRole('heading', { name: '일정 수립', exact: true })).toBeVisible();
  await expect(page.getByText('종료일을 입력해 주세요.')).toBeVisible();
  await expect(page.getByLabel('종료일', { exact: true })).toBeFocused();
  await page.getByLabel('시작일', { exact: true }).fill('2026-10-01');
  await page.getByLabel('종료일', { exact: true }).fill('2026-10-15');
  await page.getByRole('button', { name: '3. 최종 확인' }).click();
  await expect(page.getByRole('heading', { name: '계획 최종 확인', exact: true })).toBeVisible();
  await expect(page.locator('.plan-review-goal')).toContainText('미입력');
  await page.getByRole('button', { name: '2. 일정 수립', exact: true }).click();
  await page
    .getByLabel('학습 목표(선택)', { exact: true })
    .fill('독립적으로 기준을 확인하고 결과를 기록한다.');
  await page.getByLabel('종료일', { exact: true }).fill('2026-09-30');
  await page.getByRole('button', { name: '최종 확인', exact: true }).click();
  await expect(page.getByText('종료일은 시작일 이후여야 합니다.')).toBeVisible();
  await expect(page.getByLabel('종료일', { exact: true })).toBeFocused();
  await page.route('**/api/plans/**', async (route) => {
    if (route.request().method() === 'PUT') await route.abort('failed');
    else await route.continue();
  });
  await page.getByLabel('종료일', { exact: true }).fill('2027-03-01');
  await page.getByRole('button', { name: '최종 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '일정 수립', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').first()).toContainText(
    '저장되지 않아 다음 단계로 이동할 수 없습니다.',
  );
});

test('학습자 홈 최근 알림·공지의 본문 대비와 읽음 상태', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await expect(page.locator('.home-recent-notifications')).toBeVisible();
  const ratios = await page.evaluate(() => {
    const secondary = document.createElement('button');
    secondary.className = 'button secondary';
    document.querySelector('.home-card')!.appendChild(secondary);
    const toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
    const luminance = (rgb: string) => {
      const channels = (rgb.match(/[\d.]+/g) || []).slice(0, 3).map((n) => Number(n) / 255);
      const linear = channels.map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
      return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
    };
    const ratio = (selector: string, background: string) => {
      const element = document.querySelector(selector)!;
      const a = luminance(getComputedStyle(element).color),
        b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const values = {
      task: ratio(
        '.home-notification-row strong',
        getComputedStyle(document.querySelector('.home-recent-notifications')!).backgroundColor,
      ),
      taskDetail: ratio(
        '.home-notification-row time',
        getComputedStyle(document.querySelector('.home-recent-notifications')!).backgroundColor,
      ),
      notice: ratio(
        '.notice-row',
        getComputedStyle(document.querySelector('.notice-card')!).backgroundColor,
      ),
      primaryButton: ratio(
        '.home-card .button.primary',
        getComputedStyle(document.querySelector('.home-card .button.primary')!).backgroundColor,
      ),
      secondaryButton: ratio(
        '.home-card .button.secondary',
        getComputedStyle(secondary).backgroundColor,
      ),
      toast: ratio('.toast', getComputedStyle(toast).backgroundColor),
    };
    secondary.remove();
    toast.remove();
    return values;
  });
  expect(Math.min(...Object.values(ratios)), JSON.stringify(ratios)).toBeGreaterThanOrEqual(4.5);
  await page.goto('/notifications');
  await expect(
    page.locator('.notification-row').first().locator('.notification-status'),
  ).toHaveText('읽음');
  await expect(
    page.locator('.notification-row').first().locator('.collapsible-section-toggle'),
  ).toHaveAttribute('aria-expanded', 'true');
  const notificationRatio = await page.evaluate(() => {
    const color = (value: string) =>
      (value.match(/[\d.]+/g) || [])
        .slice(0, 3)
        .map((n) => Number(n) / 255)
        .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
    const luminance = (value: string) => {
      const [r, g, b] = color(value);
      return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
    };
    const body = luminance(getComputedStyle(document.querySelector('.notification-row p')!).color);
    const background = luminance(
      getComputedStyle(document.querySelector('.notification-row')!).backgroundColor,
    );
    return (Math.max(body, background) + 0.05) / (Math.min(body, background) + 0.05);
  });
  expect(notificationRatio).toBeGreaterThanOrEqual(4.5);
  await noPageOverflow(page);
});
