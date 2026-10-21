import { requestPlan, completePlan, practicalOnly, qualificationPolicy } from './workflow-helpers';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, actor } from './fixtures';

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

test('운영자 조직·사용자 편집, 공동 관리자 UI, 초기화 후 메타정보 보존', async ({
  page,
  backend,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.getByRole('link', { name: '시스템 운영', exact: true }).click();
  await expect(page.locator('.tree-node')).toHaveCount(35);
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
  await page.getByRole('link', { name: '기준 검증', exact: true }).click();
  await expect(page.getByRole('button', { name: '비교 기록 추가' })).toBeEnabled();
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
  await page.locator('.tree-node').filter({ hasText: 'MVP 검증 조직' }).click();
  await page.getByLabel('조직 사용', { exact: true }).uncheck();
  await page.getByRole('button', { name: '조직 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('기존 사용자 1명');
  await page.getByRole('dialog').getByRole('button', { name: '사용 중지', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const master = await readFile(backend.store.organizations.file, 'utf8'),
    users = backend.store.snapshot().users;
  await page.getByRole('link', { name: '테스트 관리', exact: true }).click();
  await page.getByLabel('초기화 대상', { exact: true }).selectOption('org-photo');
  await page.getByRole('button', { name: '진행 내역 초기화', exact: true }).click();
  await page.getByLabel('확인을 위해 ‘초기화’를 입력해 주세요.').fill('초기화');
  await page.getByRole('button', { name: '초기화 실행', exact: true }).click();
  await expect(page.getByText('초기화할 진행 내역이 없습니다.', { exact: true })).toBeVisible();
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
