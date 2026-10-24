import { test, expect, actor, answerConfirmation } from './fixtures';
import { configureTestPolicies } from '../../server/tests/policy-helpers';
import { configureDashboardFixture, DASHBOARD_NOW } from '../../server/tests/dashboard-fixtures';

const menuNames = [
  '인증 현황',
  '취득 대상자 상태',
  '계획 요청·진행',
  '평가·수료 결과',
  '보유 자격 관리',
  '팀 자격 설정',
  '조직 필수 자격 설정',
  '인증Set 설정',
  '기준 일괄 편집',
  '팀 공지 관리',
];
const groupNames = ['현황 조회', '인증 운영', '자격 기준 설정', '팀 소통'];

test('네 그룹·10개 메뉴·화면 제목·상세 선택과 기존 URL', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  const nav = page.getByRole('navigation', { name: '관리 메뉴', exact: true });
  await expect(nav.getByRole('heading')).toHaveText(groupNames);
  await expect(nav.getByRole('link')).toHaveText(menuNames);
  for (const name of menuNames) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.locator('[aria-current="page"]')).toHaveText(name);
  }
  await page.goto('/admin/courses/demo-course-1');
  await expect(nav.getByRole('link', { name: '인증Set 설정', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('link', { name: '인증Set 설정', exact: true })).toHaveAttribute(
    'href',
    '/admin/courses?lv1OrganizationId=org-photo',
  );
});

test('세부 관리자의 세 메뉴·빈 그룹 제거·직접 URL와 일반 학습자 제한, 운영자의 팀 전환', async ({
  page,
  backend,
}) => {
  backend.setClock(DASHBOARD_NOW);
  await configureDashboardFixture(backend.store);
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.goto('/admin');
  const nav = page.getByRole('navigation', { name: '관리 메뉴', exact: true });
  await expect(nav.getByRole('link')).toHaveText([
    '인증 현황',
    '취득 대상자 상태',
    '조직 필수 자격 설정',
  ]);
  await expect(nav.getByRole('heading')).toHaveText(groupNames.slice(0, 3));
  await page.goto('/admin/assignments');
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await actor(page, 'operator-1');
  await page.goto('/admin/targets?lv1OrganizationId=org-photo');
  await expect(nav.getByRole('link')).toHaveText(menuNames);
  await page.getByLabel('관리할 Lv1 조직').selectOption('org-etch');
  await expect(page).toHaveURL(/\/admin\/targets\?lv1OrganizationId=org-etch/);
  await expect(nav.getByRole('link', { name: '팀 자격 설정', exact: true })).toHaveAttribute(
    'href',
    '/admin/qualifications?lv1OrganizationId=org-etch',
  );
  await actor(page, 'alice');
  await page.goto('/admin/policies');
  await expect(page).toHaveURL(/\/$/);
  await expect(nav).toHaveCount(0);
});

test('네 화면 폭의 그룹·글자·조작 높이·키보드 메뉴와 미저장 이동 취소', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  const sidebar = page.getByRole('complementary', { name: '인증 업무 관리 탐색' });
  const nav = sidebar.getByRole('navigation', { name: '관리 메뉴', exact: true });
  const toggle = sidebar.getByRole('button', { name: /메뉴 (열기|접기)/ });
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 1024) {
      await expect(nav).toBeHidden();
      await toggle.focus();
      await page.keyboard.press('Space');
    }
    await expect(nav.getByRole('heading')).toHaveText(groupNames);
    for (const link of await nav.getByRole('link').all()) {
      await expect(link).toHaveCSS('font-size', '14px');
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(width <= 1024 ? 44 : 40);
    }
    await expect(nav.getByRole('heading').first()).toHaveCSS('font-size', '13px');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: test.info().outputPath(`navigation-${width}.png`),
      fullPage: true,
    });
    if (width <= 1024) {
      await nav.getByRole('link').first().focus();
      await page.keyboard.press('Escape');
      await expect(nav).toBeHidden();
      await expect(toggle).toBeFocused();
    }
  }
  await page.getByLabel('인증Set명', { exact: true }).fill('메뉴 전환에서 보존할 초안');
  await toggle.click();
  await nav.getByRole('link', { name: '팀 자격 설정', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(nav).toBeVisible();
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue(
    '메뉴 전환에서 보존할 초안',
  );
  await nav.getByRole('link', { name: '팀 자격 설정', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(page).toHaveURL(/\/admin\/qualifications/);
  await expect(nav).toBeHidden();
});

test('필수 선택 우선·빈 저장·조직 정보 접힘 입력·실패 복구와 조직 전환', async ({
  page,
  backend,
}) => {
  await configureTestPolicies(backend.store);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/policies');
  const info = page.getByRole('button', { name: /조직 정보 (펼치기|접기)/, exact: true });
  const admins = page.getByRole('button', { name: /세부 조직 관리자 (펼치기|접기)/, exact: true });
  await expect(info).toHaveAttribute('aria-expanded', 'false');
  await expect(admins).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('조직 설명', { exact: true })).toBeHidden();
  const required = page.getByRole('group', { name: '필수 자격 · 선택 사항', exact: true });
  await expect(required).toBeVisible();
  for (const checkbox of await required.getByRole('checkbox').all()) await checkbox.uncheck();
  await info.click();
  await page.getByLabel('조직 설명', { exact: true }).fill('접어도 유지할 조직 설명');
  await info.click();
  await expect(info).toContainText('미저장 변경');
  await page.route('**/api/organization-policies/org-photo?*', async (route) => {
    if (route.request().method() === 'PUT')
      await route.fulfill({ status: 503, json: { message: '조직 저장 시험 실패' } });
    else await route.continue();
  });
  await page.getByRole('button', { name: '조직 설정 변경 확인', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('조직 저장 시험 실패');
  await expect(info).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByLabel('조직 설명', { exact: true })).toHaveValue(
    '접어도 유지할 조직 설명',
  );
  await page.unroute('**/api/organization-policies/org-photo?*');
  await page.getByRole('button', { name: '조직 설정 변경 확인', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(backend.store.organizations.snapshot().roots[0]!.requiredQualifications).toEqual([]);
  await page.getByLabel('조직 설명', { exact: true }).fill('전환 취소 시 보존');
  await page.getByRole('treeitem', { name: 'RE A조', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(page.getByLabel('조직 설명', { exact: true })).toHaveValue('전환 취소 시 보존');
  await page.getByRole('treeitem', { name: 'RE A조', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(info).toHaveAttribute('aria-expanded', 'false');
  await expect(admins).toHaveAttribute('aria-expanded', 'false');
});

test('계획 요청·취득 진행 구역의 독립 필터와 목록 설정 유지', async ({ page, backend }) => {
  backend.setClock(DASHBOARD_NOW);
  await configureDashboardFixture(backend.store);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  const requests = page.getByRole('region', { name: '계획 요청 현황', exact: true });
  const progress = page.getByRole('region', { name: '자격별 취득 진행', exact: true });
  await expect(requests.locator('tbody tr').first()).toBeVisible();
  await expect(progress.locator('tbody tr').first()).toBeVisible();
  const requestRows = await requests.locator('tbody tr').count();
  const progressRows = await progress.locator('tbody tr').count();
  expect(progressRows).toBeGreaterThan(0);
  await progress.getByLabel('취득 진행 검색').fill('없는 자격 검색');
  await expect(progress.locator('tbody tr')).toHaveCount(0);
  await expect(requests.locator('tbody tr')).toHaveCount(requestRows);
  await progress.getByLabel('취득 진행 검색').fill('');
  await requests.getByLabel('요청 현황 필터').selectOption('late');
  await expect(progress.locator('tbody tr')).toHaveCount(progressRows);
  await requests.getByLabel('요청 현황 필터').selectOption('all');
  await progress.getByLabel('취득 진행 상태').selectOption('excluded');
  await expect(requests.locator('tbody tr')).toHaveCount(requestRows);
  await page.reload();
  await expect(progress.getByLabel('취득 진행 상태')).toHaveValue('excluded');
  await expect(requests.getByLabel('요청 현황 필터')).toHaveValue('all');
});

test('필수·팀 적용 자격이 없어도 기존 요청 대화상자에서 발송', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  const requests = page.getByRole('region', { name: '계획 요청 현황', exact: true });
  await requests.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: '정하린', exact: true }).check();
  await dialog.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(requests.getByRole('row').filter({ hasText: '정하린' })).toContainText(
    '자격 준비 대기',
  );
});
