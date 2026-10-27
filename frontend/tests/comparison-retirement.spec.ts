import { test, expect, actor } from './fixtures';

test('평가 기준 검증 메뉴·시스템 탭 제거와 이전 링크의 팀 맥락 보존', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/admin/comparisons/old-record?lv1OrganizationId=org-photo');
  await expect(page).toHaveURL(/\/admin\/dashboard\?.*lv1OrganizationId=org-photo/);
  const nav = page.getByRole('navigation', { name: '관리 메뉴', exact: true });
  await expect(nav.getByRole('link')).toHaveCount(12);
  await expect(nav.getByRole('link', { name: '평가 기준 검증', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '비교 기록 추가', exact: true })).toHaveCount(0);
  await page.goto('/system/overview');
  await expect(page.getByRole('button', { name: '실제 수행 비교', exact: true })).toHaveCount(0);
  await expect(page.locator('.system-records')).toBeVisible();
  await actor(page, 'learner-1');
  await page.goto('/admin/comparisons?lv1OrganizationId=org-photo');
  await expect(page).toHaveURL(/\/$/);
});

test('브라우저에서도 이전 API가 닫혀 있고 기존 결과·평가 화면은 유지된다', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  const tab = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  const response = await page.request.get('/api/comparisons?lv1OrganizationId=org-photo', {
    headers: { 'X-Session-Tab': tab! },
  });
  expect(response.status()).toBe(404);
  await page.goto('/admin/results');
  await expect(page.getByRole('heading', { name: '평가·수료 결과', exact: true })).toBeVisible();
  await expect(page.locator('.result-details').first()).toBeVisible();
  await page.getByTestId('process-guide').getByRole('button').click();
  await expect(page.getByTestId('process-guide')).not.toContainText('실제 수행 비교');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1/courses/demo-course-2/objective');
  const guide = page.getByTestId('process-guide');
  await guide.getByRole('button').click();
  await expect(guide).not.toContainText('관리자 비교 기능');
  await expect(guide).toContainText('현장 수행 근거를 별도로 확보');
});
