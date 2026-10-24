import { requestPlan, completePlan, practicalOnly, qualificationPolicy } from './workflow-helpers';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, actor } from './fixtures';

test('팀 적용·필수 자격 이력이 있어도 조직 트리와 상세·변경 이력을 조회한다', async ({
  page,
  backend,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await actor(page, 'operator-1');
  const session = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  async function change(url: string, data: object, method = 'PUT') {
    const response = await page.request.fetch(`/api${url}`, {
      method,
      headers: { 'X-Session-Tab': session!, 'Idempotency-Key': crypto.randomUUID() },
      data: { revision: backend.store.organizations.snapshot().revision, ...data },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await change('/organization-policies/org-photo/qualification-pool?lv1OrganizationId=org-photo', {
    qualificationIds: ['demo-qualification'],
  });
  await change('/organization-policies/org-photo?lv1OrganizationId=org-photo', {
    description: '팀의 조직 설명',
    duties: '자격 인증 운영',
    requiredQualifications: ['demo-qualification'],
  });
  await change('/system/organizations/org-photo', { name: '조회 검증팀' }, 'PATCH');
  const longDescription = '긴 조직 설명과 담당 업무를 확인합니다. '.repeat(50);
  await change('/organization-policies/org-photo-fmg?lv1OrganizationId=org-photo', {
    description: longDescription,
    duties: '세부 조직 업무',
    requiredQualifications: [],
  });
  const before = await readFile(backend.store.organizations.file, 'utf8');
  await page.goto('/system/organizations');
  await expect(page.locator('.tree-node')).toHaveCount(35);
  await expect(page.getByLabel('조직명', { exact: true })).toHaveValue('조회 검증팀');
  const history = page.locator('.organization-history');
  await history.locator('summary').click();
  await expect(history).toContainText('조직 정보 변경');
  await expect(history).toContainText('조직별 자격 설정 변경');
  await expect(history).toContainText('팀 적용 자격 변경');
  await expect(history).toContainText('필수 자격 없음');
  await expect(history).toContainText('필수 자격 1개');
  await expect(history).toContainText('팀 적용 자격 0개');
  await expect(history).toContainText('팀 적용 자격 1개');
  await expect(history).toContainText('조직 설명: 팀의 조직 설명');
  await expect(history).toContainText('담당 업무: 자격 인증 운영');
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await expect(page.locator('.tree-node')).toHaveCount(35);
  await page.screenshot({ path: test.info().outputPath('organization-audits-1920.png') });
  await page.getByLabel('조직 검색').fill('조회 검증팀 FMG');
  await page
    .locator('.tree-node')
    .filter({ hasText: /Lv2\s*FMG$/ })
    .click();
  await expect(page.getByLabel('조직명', { exact: true })).toHaveValue('FMG');
  await expect(history).toContainText(longDescription.trim());
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
  await page.screenshot({
    path: test.info().outputPath('organization-audits-390.png'),
    fullPage: true,
  });
  expect(await readFile(backend.store.organizations.file, 'utf8')).toBe(before);
  expect(errors).toEqual([]);
});

test('일부 필드가 없거나 지원하지 않는 변경 이력이 조직 조회를 중단하지 않는다', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.route('**/api/system/organizations', async (route) => {
    const response = await route.fetch();
    const doc = await response.json();
    doc.audits = [
      {
        action: 'organization.update',
        before: { name: '이전 이름' },
        after: { path: [null, {}], name: '이후 이름' },
      },
      { action: 'organization.policy', before: {}, after: { requiredQualifications: null } },
      { action: 'organization.pool', before: null, after: {} },
      { action: 'organization.future', before: '이전 기록', after: [] },
    ].map((event) => ({
      ...event,
      id: crypto.randomUUID(),
      targetId: doc.entries[0].id,
      actorId: 'operator-1',
      date: new Date().toISOString(),
    }));
    await route.fulfill({ response, json: doc });
  });
  await page.goto('/system/organizations');
  await expect(page.locator('.tree-node')).toHaveCount(35);
  const history = page.locator('.organization-history');
  await history.locator('summary').click();
  await expect(history).toContainText('이전: 이전 이름');
  await expect(history).toContainText('이후: 이후 이름');
  await expect(history).toContainText('상세 표시를 지원하지 않는 이력입니다.');
  await expect(history).not.toContainText('NaN');
  expect(errors).toEqual([]);
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
