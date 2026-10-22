import { answerConfirmation } from './fixtures';
import { test, expect, actor } from './fixtures';
import { requestPlan, completePlan } from './workflow-helpers';
import { nodeFor } from '../../server/src/organizations';

test('팀 관리자의 복수 지정 → 세부 관리자 전용 메뉴·트리·필수 설정 → 권한 회수 시 입력 보존', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'direct-members',
    () => {},
    (s) => {
      for (const id of ['learner-2', 'ft-1'])
        s.users.find((u) => u.id === id)!.organizationId = 'org-photo-pyeongtaek-1';
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/policies');
  await page.getByLabel('조직 검색').fill('RE A조');
  await page.getByRole('treeitem', { name: 'RE A조', exact: true }).click();
  const admins = page.getByRole('region', { name: '세부 조직 관리자 지정' });
  await admins.getByRole('checkbox', { name: '정하린', exact: true }).check();
  await admins.getByRole('checkbox', { name: '박준호', exact: true }).check();
  await admins.getByRole('button', { name: '관리자 지정 저장', exact: true }).click();
  await answerConfirmation(page, true);
  await expect
    .poll(() => backend.store.snapshot().users.filter((u) => u.organizationAdministration).length)
    .toBe(2);
  await actor(page, 'learner-2');
  await expect(page.getByRole('link', { name: '조직별 자격 설정', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await expect(page.getByRole('navigation', { name: '관리 메뉴' }).getByRole('link')).toHaveCount(
    3,
  );
  await page
    .getByRole('navigation', { name: '관리 메뉴' })
    .getByRole('link', { name: '조직별 자격 설정', exact: true })
    .click();
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.locator('.policy-pool-management')).toHaveCount(0);
  await expect(admins.getByRole('checkbox')).toHaveCount(0);
  await page.getByLabel('조직 설명').fill('세부 관리자 검증 내용');
  await page.getByRole('button', { name: '조직 설정 변경 확인', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    nodeFor(backend.store.organizations.snapshot().roots, 'org-photo-pyeongtaek-1')!.description,
  ).toBe('세부 관리자 검증 내용');
  await page.getByLabel('조직 설명').fill('권한 회수 뒤 보존할 입력');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'revoke',
    () => {},
    (s) => {
      delete s.users.find((u) => u.id === 'learner-2')!.organizationAdministration;
      return {};
    },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('입력 내용은 유지');
  await expect(page.getByLabel('조직 설명')).toHaveValue('권한 회수 뒤 보존할 입력');
  await expect(
    page.getByRole('button', { name: '조직 설정 변경 확인', exact: true }),
  ).toBeDisabled();
});

test('시스템 공지 작성·게시와 팀 공지의 홈 분리·다른 팀 비노출', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/notices');
  await page.getByRole('button', { name: '시스템 공지 작성', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('제목', { exact: true }).fill('전체 조직 운영 안내');
  await dialog
    .getByLabel('내용', { exact: true })
    .fill('첫 번째 문단입니다.\n\n두 번째 문단은 구분됩니다.');
  await dialog.getByLabel('전 조직에 게시', { exact: true }).check();
  await dialog.getByRole('button', { name: '공지 저장', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await actor(page, 'admin-1');
  await page.goto('/admin/notices');
  await page.getByRole('button', { name: '공지 등록', exact: true }).click();
  await dialog.getByLabel('제목', { exact: true }).fill('Photo 팀 전용 안내');
  await dialog.getByLabel('내용', { exact: true }).fill('Photo 구성원에게만 보이는 공지');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await actor(page, 'learner-1');
  await expect(page.getByRole('region', { name: '시스템 공지', exact: true })).toContainText(
    '전체 조직 운영 안내',
  );
  await expect(page.getByRole('region', { name: '내 팀 공지', exact: true })).toContainText(
    'Photo 팀 전용 안내',
  );
  await page
    .getByRole('region', { name: '시스템 공지', exact: true })
    .getByRole('button', { name: /전체 조직 운영 안내/ })
    .click();
  await expect(dialog).toContainText('전 조직 공통');
  await expect(dialog.locator('.notice-body')).toHaveCSS('white-space', 'pre-wrap');
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'etch-user',
    () => {},
    (s) => {
      s.users.push({
        id: 'etch-user',
        name: 'Etch 구성원',
        roles: ['learner'],
        organizationId: 'org-etch',
        revision: 1,
      });
      return {};
    },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#actor option[value="etch-user"]')).toHaveCount(1);
  await actor(page, 'etch-user');
  await expect(page.getByRole('region', { name: '시스템 공지', exact: true })).toContainText(
    '전체 조직 운영 안내',
  );
  await expect(page.getByRole('region', { name: '내 팀 공지', exact: true })).not.toContainText(
    'Photo 팀 전용 안내',
  );
});

test('기준 일괄 관리 공통 사이드바·미저장 보호·안내 기본 접힘·네 화면 폭', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications');
  const sidebar = page.getByRole('complementary', { name: '인증 업무 관리 탐색' });
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole('link', { name: '기준 일괄 관리', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/catalog/);
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('link', { name: '기준 일괄 관리', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('region', { name: '인증 업무 관리 대상' })).toHaveCount(1);
  const guide = page.getByTestId('process-guide'),
    toggle = guide.getByRole('button');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(
    guide.getByRole('heading', { name: 'AI 검수 항목', exact: true, includeHidden: true }),
  ).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-controls', 'process-guide-content');
  await expect(page.locator('#process-guide-content')).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(guide).toContainText('정적 설명');
  await toggle.click();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    if (width < 1025) {
      await page.locator('.management-menu-toggle').click();
      await expect(sidebar.getByRole('link', { name: '인증Set 관리', exact: true })).toBeVisible();
      await page.locator('.management-menu-toggle').click();
    }
    await page.screenshot({
      path: test.info().outputPath(`catalog-shell-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByTestId('catalog-qualification-demo-qualification').getByRole('button').click();
  await page.getByLabel('인증Set명', { exact: true }).fill('보존할 기준 입력');
  await sidebar.getByRole('link', { name: '인증Set 관리', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(page).toHaveURL(/\/admin\/catalog/);
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('보존할 기준 입력');
});

test('자격 설명·개인 목표·일정 정렬과 반응형 문단 간격', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await completePlan(page, '평가 흐름 체험', false);
  const overview = page.getByRole('region', { name: '자격 요약', exact: true });
  const goals = page.getByRole('region', { name: '내 학습 목표와 일정', exact: true });
  await expect(overview.getByRole('heading', { name: '자격 설명', exact: true })).toBeVisible();
  await expect(goals.getByRole('heading', { name: '내 학습 목표', exact: true })).toBeVisible();
  await expect(overview.locator('dl > div')).toHaveCount(4);
  await expect(goals.locator('dl > div')).toHaveCount(3);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await expect(overview).toHaveCSS('row-gap', '16px');
    await page.screenshot({
      path: test.info().outputPath(`learning-overview-${width}.png`),
      fullPage: true,
    });
  }
});
