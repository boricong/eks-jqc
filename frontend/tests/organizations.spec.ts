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
  await page.getByRole('link', { name: '사용자 관리', exact: true }).click();
  await page.getByRole('button', { name: '김민서 수정', exact: true }).click();
  await expect(page.getByLabel('Lv1 조직', { exact: true })).toBeDisabled();
  await page.getByLabel('Lv2 조직', { exact: true }).selectOption(organization.id);
  await page.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(page.locator('tbody tr').filter({ hasText: '김민서' })).toContainText(
    'MVP 검증 조직',
  );
  await addUser(page, 'Photo 공동 관리자', '조직 관리자', 'org-photo');
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
  await operatorPage.getByLabel('조직 관리자', { exact: true }).uncheck();
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

test('새 Lv1 관리자·학습자·FT 생성부터 기준 등록·배정·평가·인증 조회', async ({
  page,
  backend,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.getByRole('link', { name: '시스템 운영', exact: true }).click();
  await page.getByRole('link', { name: '사용자 관리', exact: true }).click();
  await addUser(page, 'Etch 관리자', '조직 관리자');
  await addUser(page, 'Etch 학습자', '학습자');
  await addUser(page, 'Etch 평가자', 'FT');
  const id = (name: string) => backend.store.snapshot().users.find((u) => u.name === name)!.id;
  await actor(page, id('Etch 관리자'));
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Recipe Management', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '과정 관리', exact: true }).click();
  await page.getByRole('button', { name: '과정 추가', exact: true }).click();
  await page.getByLabel('과정명', { exact: true }).fill('Etch 화면 평가 과정');
  await practicalOnly(page);
  await page.getByRole('button', { name: '항목 추가', exact: true }).click();
  await page.getByLabel('항목명', { exact: true }).fill('시험 항목');
  await page.getByLabel('관찰·판정 기준', { exact: true }).fill('가상 작업을 독립적으로 수행한다.');
  await page.getByRole('button', { name: '사용 등록', exact: true }).click();
  await expect(page.getByRole('button', { name: '새 버전', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '자격 관리', exact: true }).click();
  await page.getByRole('button', { name: '새 자격 만들기', exact: true }).click();
  await page.getByLabel('자격명', { exact: true }).fill('Etch 화면 검증 자격');
  await qualificationPolicy(page);
  await page.getByRole('checkbox', { name: /Etch 화면 평가 과정/ }).check();
  await page.getByRole('button', { name: '사용 등록', exact: true }).click();
  await expect(page.getByRole('button', { name: '새 버전', exact: true })).toBeVisible();
  await requestPlan(page, 'Etch 학습자', id('Etch 평가자'));
  await actor(page, id('Etch 학습자'));
  await completePlan(page, 'Etch 화면 검증 자격');
  await page.getByRole('link', { name: '평가 요청', exact: true }).click();
  await page.getByRole('button', { name: '평가 요청', exact: true }).click();
  await actor(page, id('Etch 평가자'));
  await page.getByRole('link', { name: 'FT 평가', exact: true }).click();
  await page.getByRole('link', { name: '평가하기', exact: true }).click();
  await page.getByLabel('통과', { exact: true }).check();
  await page.getByLabel('판정 근거', { exact: true }).fill('새 Lv1의 가상 평가를 확인함.');
  await page.getByRole('button', { name: '판정 확인', exact: true }).click();
  await page.getByRole('button', { name: '평가 확정', exact: true }).click();
  await expect(
    page.getByText('Etch 학습자 님이 이 과정을 수료했습니다.', { exact: true }),
  ).toBeVisible();
  await actor(page, 'learner-1');
  await expect(page.getByText('Etch 화면 검증 자격', { exact: true })).toHaveCount(0);
  await actor(page, 'operator-1');
  await page.getByRole('link', { name: '시스템 운영', exact: true }).click();
  await page.getByRole('link', { name: '전체 업무 조회', exact: true }).click();
  await page.getByLabel('조회할 Lv1 조직', { exact: true }).selectOption('org-etch');
  await page.locator('.record-detail > summary').click();
  await expect(page.locator('.system-records')).toContainText('Etch 학습자');
  await expect(page.locator('.readonly-course')).toContainText('실기: 통과');
  await expect(page.locator('.readonly-course')).not.toContainText('객관식: 미시작');
  await expect(page.getByRole('button', { name: '평가 확정', exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('system-overview-1920x900.png') });
  await page.getByRole('link', { name: '검증용 인증 보기', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '자격 인증서 · 검증용', exact: true }),
  ).toBeVisible();
  await expect(page.locator('main')).toContainText('Foundry Etch기술팀');
});
