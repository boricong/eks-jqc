import { configureNeeds } from './workflow-helpers';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, actor } from './fixtures';

test('조직 트리 초기 접힘·전체 펼침·검색과 이력/수동 재조회 제거·조회 불변', async ({
  page,
  backend,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await actor(page, 'operator-1');
  const before = await readFile(backend.store.organizations.file, 'utf8');
  await page.goto('/system/organizations');
  await expect(page.locator('.tree-node')).toHaveCount(
    backend.store.organizations.snapshot().roots.length,
  );
  await expect(page.getByRole('button', { name: '다시 불러오기', exact: true })).toHaveCount(0);
  await expect(page.locator('.organization-history')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: '이 조직의 인증 업무 관리', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Lv1 단위로 자격 인증 업무를 관리합니다.', { exact: false }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '모두 펼치기', exact: true }).click();
  await expect(page.locator('.tree-node')).toHaveCount(35);
  await page
    .getByLabel('조직 검색')
    .fill(`${backend.store.organizations.snapshot().roots[0]!.name} FMG`);
  await page
    .locator('.tree-node')
    .filter({ hasText: /Lv2\s*FMG$/ })
    .click();
  await expect(page.getByLabel('조직명', { exact: true })).toHaveValue('FMG');
  await page.getByRole('button', { name: '모두 접기', exact: true }).click();
  await expect(page.locator('.tree-node')).toHaveCount(1);
  await page.getByLabel('조직 검색').fill('없는 조직 검색 결과');
  await expect(page.getByText('검색 결과가 없습니다.', { exact: true })).toBeVisible();
  await page.getByLabel('조직 검색').clear();
  await expect(page.locator('.tree-node')).toHaveCount(35);
  await page.getByRole('button', { name: '모두 접기', exact: true }).click();
  await expect(page.locator('.tree-node')).toHaveCount(
    backend.store.organizations.snapshot().roots.length,
  );
  expect(await readFile(backend.store.organizations.file, 'utf8')).toBe(before);
  expect(errors).toEqual([]);
});

test('독립된 검색 접힘·숨겨진 선택/미저장 입력 보존·키보드와 재진입 초기화', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/organizations');
  const roots = backend.store.organizations.snapshot().roots.length;
  const rootName = backend.store.organizations.snapshot().roots[0]!.name;
  const photo = page.getByRole('button', { name: `${rootName} 펼치기`, exact: true });
  await photo.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: `${rootName} 접기`, exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const generalCount = await page.locator('.tree-node').count();
  expect(generalCount).toBeGreaterThan(roots);
  await page.getByLabel('조직 검색').fill('RE A조');
  await page
    .locator('.tree-node')
    .filter({ hasText: /RE A조$/ })
    .click();
  await page.getByLabel('조직명', { exact: true }).fill('미저장 이름');
  await page.getByRole('button', { name: '모두 접기', exact: true }).click();
  await expect(page.locator('.tree-node')).toHaveCount(1);
  await expect(page.getByLabel('조직명', { exact: true })).toHaveValue('미저장 이름');
  await page.getByLabel('조직 검색').clear();
  await expect(page.locator('.tree-node')).toHaveCount(generalCount);
  await expect(page.locator('.tree-node.selected')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '선택 조직으로 이동', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: '모두 펼치기', exact: true }).click();
  await expect(page.locator('.tree-node.selected')).toContainText('RE A조');
  await expect(page.locator('.tree-node.selected')).toBeInViewport();
  await expect(page.getByLabel('조직명', { exact: true })).toHaveValue('미저장 이름');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByLabel('조직명', { exact: true })).toHaveValue('RE A조');
  const collapse = page.getByRole('button', { name: `${rootName} 접기`, exact: true });
  await collapse.focus();
  await page.keyboard.press('Space');
  await expect(photo).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '모두 접기', exact: true }).click();
  await expect(page.locator('.tree-node')).toHaveCount(roots);
  await page.goto('/system/users');
  await page.goto('/system/organizations');
  await expect(page.locator('.tree-node')).toHaveCount(roots);
});

async function addUser(page: Page, name: string, role: string, root = 'org-etch') {
  await page.getByRole('button', { name: '사용자 추가', exact: true }).click();
  await page.getByLabel('이름', { exact: true }).fill(name);
  await page.getByLabel('Lv1 조직', { exact: true }).selectOption(root);
  if (role !== '학습자') {
    await page.getByLabel('학습자', { exact: true }).uncheck();
    await page.getByLabel(role, { exact: true }).check();
  }
  await page.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(page.locator('.user-editor')).toHaveCount(0);
  await expect(page.locator('tbody')).toContainText(name);
}

test('운영자 조직·사용자 편집, 공동 관리자 UI와 메타정보 보존', async ({ page, backend }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.getByRole('link', { name: '시스템 운영', exact: true }).click();
  await expect(page.locator('.tree-node')).toHaveCount(
    backend.store.organizations.snapshot().roots.length,
  );
  await page.screenshot({ path: test.info().outputPath('organizations-1920x900.png') });
  await page.getByRole('button', { name: '하위 조직 추가', exact: true }).click();
  await page.getByLabel('조직명', { exact: true }).fill('MVP 운영');
  await page.getByRole('button', { name: '조직 저장', exact: true }).click();
  await expect(page.locator('.tree-node.selected')).toContainText('MVP 운영');
  const organization = backend.store.organizations
    .snapshot()
    .roots[0]!.children.find((n) => n.name === 'MVP 운영')!;
  await page.getByRole('button', { name: '위로 이동', exact: true }).click();
  await expect
    .poll(() => backend.store.organizations.snapshot().roots[0]!.children[1]!.id)
    .toBe(organization.id);
  await page.getByLabel('조직명', { exact: true }).fill('MVP 검증 조직');
  await page.getByRole('button', { name: '조직 저장', exact: true }).click();
  await expect(page.locator('.tree-node.selected')).toContainText('MVP 검증 조직');
  await expect(page.getByRole('button', { name: '조직 저장', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: '사용자 관리', exact: true }).click();
  await page.getByRole('button', { name: '김민서 수정', exact: true }).click();
  await expect(page.getByLabel('Lv1 조직', { exact: true })).toBeDisabled();
  await page.getByLabel('Lv2 조직', { exact: true }).selectOption(organization.id);
  await page.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(page.locator('tbody tr').filter({ hasText: '김민서' })).toContainText(
    'MVP 검증 조직',
  );
  await addUser(page, 'Photo 공동 관리자', '팀 조직 관리자', 'org-photo');
  await page.screenshot({ path: test.info().outputPath('users-1920x900.png') });
  const admin = backend.store.snapshot().users.find((u) => u.name === 'Photo 공동 관리자')!;
  await actor(page, admin.id);
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  await configureNeeds(page);
  await page.getByRole('link', { name: '계획 요청·진행', exact: true }).click();
  await expect(page.getByRole('button', { name: '계획 수립 요청', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: '테스트 관리', exact: true })).toHaveCount(0);
  const operatorPage = await page.context().newPage();
  await operatorPage.goto('/');
  await actor(operatorPage, 'operator-1');
  await operatorPage.getByRole('link', { name: '시스템 운영', exact: true }).click();
  await operatorPage.getByRole('link', { name: '사용자 관리', exact: true }).click();
  await operatorPage.getByRole('button', { name: 'Photo 공동 관리자 수정', exact: true }).click();
  await operatorPage.getByLabel('팀 조직 관리자', { exact: true }).uncheck();
  await operatorPage.getByLabel('학습자', { exact: true }).check();
  await operatorPage.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(operatorPage.locator('.user-editor')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('heading', { name: 'Photo 공동 관리자 님', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '인증 업무 관리', exact: true })).toHaveCount(0);
  await operatorPage.close();
  await actor(page, 'operator-1');
  await page.getByRole('link', { name: '시스템 운영', exact: true }).click();
  await page.getByLabel('조직 검색').fill('MVP 검증 조직');
  await page.locator('.tree-node').filter({ hasText: 'MVP 검증 조직' }).click();
  await page.getByLabel('조직 사용', { exact: true }).uncheck();
  await page.getByRole('button', { name: '조직 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('기존 사용자 1명');
  await page.getByRole('dialog').getByRole('button', { name: '사용 중지', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const master = await readFile(backend.store.organizations.file, 'utf8'),
    users = backend.store.snapshot().users;
  expect(await readFile(backend.store.organizations.file, 'utf8')).toBe(master);
  expect(backend.store.snapshot().users).toEqual(users);
  await page.getByRole('link', { name: '조직 관리', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: test.info().outputPath('organizations-mobile.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
