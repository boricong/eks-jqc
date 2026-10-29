import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, actor } from './fixtures';
import { completePlan, requestPlan, savePlanViaApi } from './workflow-helpers';

async function refresh(page: Page) {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/workspace');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
}
async function headers(page: Page) {
  return {
    'X-Session-Tab': (await page.evaluate(() => sessionStorage.getItem('eks-session-tab')))!,
    'Idempotency-Key': crypto.randomUUID(),
    'X-EKS-Release-Contract': '2',
  };
}
function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const values = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((n) => {
        const value = n / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
    return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
  };
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('학습 평가 시작·필수 배지·진행 점과 네 화면 폭의 정렬·대비·키보드', async ({
  page,
  backend,
}, info) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1?course=demo-course-1');
  const before = backend.store.snapshot();
  const summary = page.getByRole('region', { name: '자격 요약', exact: true });
  const hero = page.getByRole('region', { name: '인증Set 요약', exact: true });
  const start = hero.getByRole('link', { name: '평가 시작', exact: true });
  await expect(hero.getByRole('link', { name: '일정 수정', exact: true })).toHaveCount(0);
  await expect(summary.getByRole('link', { name: '인증 계획 보기' })).toHaveCount(0);
  await expect(start).toHaveAttribute(
    'href',
    '/qualifications/assignment-1?stage=assessment&course=demo-course-1',
  );
  await expect(summary.locator('.learning-progress-status')).toHaveText('진행 중');
  await expect(summary.locator('.learning-progress-dot')).toHaveAttribute('aria-hidden', 'true');
  const metrics = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const selector = page.locator('.qualification-course-toggle');
    if (width < 1280) await expect(selector.locator('.course-required-badge')).toHaveText('필수');
    await start.focus();
    await expect(start).toBeFocused();
    const colors = await start.evaluate((el) => {
      const style = getComputedStyle(el);
      const dot = document.querySelector('.learning-progress-dot')!;
      const badge = document.querySelector('.course-required-badge')!;
      return {
        background: style.backgroundColor,
        text: style.color,
        focus: style.outlineColor,
        dot: getComputedStyle(dot).backgroundColor,
        hero: getComputedStyle(document.querySelector('.learning-hero')!).backgroundColor,
        badge: getComputedStyle(badge).color,
        badgeBackground: getComputedStyle(badge).backgroundColor,
      };
    });
    const ratios = {
      text: contrast(colors.text, colors.background),
      focus: contrast(colors.focus, 'rgb(255, 255, 255)'),
      dot: contrast(colors.dot, colors.hero),
      badge: contrast(colors.badge, colors.badgeBackground),
    };
    expect(ratios.text).toBeGreaterThanOrEqual(4.5);
    expect(ratios.badge).toBeGreaterThanOrEqual(4.5);
    expect(ratios.dot).toBeGreaterThanOrEqual(3);
    expect(ratios.focus).toBeGreaterThanOrEqual(3);
    const button = (await start.boundingBox())!;
    expect(button.height).toBeGreaterThanOrEqual(48);
    await expect(start).toHaveCSS('font-size', '16px');
    await expect(start).toHaveCSS('font-weight', '600');
    await expect(start).toHaveCSS('align-items', 'center');
    await expect(start).toHaveCSS('justify-content', 'center');
    if (width <= 768)
      expect(button.width).toBeCloseTo(
        (await hero.locator('.learning-course-actions').boundingBox())!.width,
        1,
      );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    metrics.push({ width, button, ratios });
    await page.screenshot({
      path: info.outputPath(`learning-actions-${width}.png`),
      fullPage: true,
    });
  }
  await writeFile(
    info.outputPath('learning-actions-metrics.json'),
    JSON.stringify(metrics, null, 2),
  );
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/stage=assessment&course=demo-course-1$/);
  await expect(page.getByRole('navigation', { name: '인증Set', exact: true })).toBeHidden();
  await expect(page.locator('.assessment-grid')).toBeVisible();
  expect(backend.store.snapshot()).toEqual(before);
});

test('필수 배지는 배정 버전의 포함 여부만 따르며 최신 버전·학습 항목 필수와 구별', async ({
  page,
}) => {
  let subset = false;
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const assignment = data.assignments.find((a: { id: string }) => a.id === 'assignment-1');
    const pinned = data.qualifications.find(
      (q: { id: string }) => q.id === assignment.qualificationId,
    );
    data.qualifications.push({
      ...pinned,
      id: 'new-version',
      version: pinned.version + 1,
      courseIds: [],
    });
    data.courses.find((c: { id: string }) => c.id === 'demo-course-1').learningItems = [];
    if (subset) pinned.courseIds = ['demo-course-1'];
    pinned.title = '긴 자격명과 적용 범위 '.repeat(12);
    data.courses[0].title = '긴 인증Set의 이름과 학습 기준 '.repeat(9);
    await route.fulfill({ response, json: data });
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1?course=demo-course-1');
  const nav = page.getByRole('navigation', { name: '인증Set', exact: true });
  await expect(nav.locator('.course-required-badge')).toHaveCount(2);
  subset = true;
  await refresh(page);
  await expect(nav.getByRole('button').first().locator('.course-required-badge')).toHaveCount(1);
  await expect(nav.getByRole('button').nth(1).locator('.course-required-badge')).toHaveCount(0);
  await nav.getByRole('button').nth(1).click();
  await expect(page).toHaveURL(/course=demo-course-2$/);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    if (width <= 768)
      await expect(page.locator('.qualification-course-toggle .course-required-badge')).toHaveCount(
        0,
      );
    await page.screenshot({
      path: test.info().outputPath(`learning-actions-long-${width}.png`),
      fullPage: true,
    });
  }
});

test('완료 계획은 편집·저장 없이 조회하고 서버 API 수정 후 최신 일정·목표를 표시', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await completePlan(page, '평가 흐름 체험', false);
  const plan = backend.store.snapshot().plans[0]!;
  await page.getByRole('link', { name: '인증 계획 보기', exact: true }).click();
  const saves: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && /\/api\/plans\//.test(r.url())) saves.push(r.url());
  });
  await expect(page.getByRole('heading', { name: '계획 내용', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '계획 작성 단계' })).toHaveCount(0);
  await expect(page.locator('[data-plan-field]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /수정|변경 저장|저장 재시도/ })).toHaveCount(0);
  await expect(page.getByLabel('계획 변경 사유')).toHaveCount(0);
  await expect(
    page.getByText('완료된 계획은 이 화면에서 변경할 수 없습니다.', { exact: true }),
  ).toBeVisible();
  await savePlanViaApi(
    page,
    plan.id,
    { endOn: '2027-03-01', goal: '서버에서 수정한 조회 목표' },
    '서버 조정',
  );
  await refresh(page);
  await expect(page.locator('.plan-review-summary')).toContainText('2027.03.01');
  await expect(page.locator('.plan-review-goal').first()).toContainText(
    '서버에서 수정한 조회 목표',
  );
  await page.getByRole('link', { name: '학습으로 이동', exact: true }).click();
  await expect(page).toHaveURL(/\/qualifications\/[^/?]+$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '계획 내용', exact: true })).toBeVisible();
  expect(saves).toEqual([]);
});

test('다른 화면에서 전체 확정하면 오래된 입력 저장을 보류하고 확정 이력을 유지한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await page.getByLabel('완료일', { exact: true }).fill('2027-03-01');
  await expect.poll(() => backend.store.snapshot().plans.length).toBe(1);
  const request = backend.store.snapshot().planningRequests[0]!,
    h = await headers(page);
  const preview = await (
    await page.request.post('/api/planning-requests/' + request.id + '/schedule/preview', {
      headers: h,
      data: {},
    })
  ).json();
  const complete = await page.request.post(
    '/api/planning-requests/' + request.id + '/schedule/complete',
    {
      headers: h,
      data: { requestRevision: preview.requestRevision, reviewToken: preview.reviewToken },
    },
  );
  expect(complete.ok(), await complete.text()).toBeTruthy();
  await page.getByLabel('완료일', { exact: true }).fill('2027-03-02');
  await expect(page.getByRole('button', { name: '변경된 저장 내용 확인' })).toBeVisible();
  await expect(page.getByLabel('완료일', { exact: true })).toHaveValue('2027-03-02');
  expect(backend.store.snapshot().plans[0]!.endOn).toBe('2027-03-01');
});
