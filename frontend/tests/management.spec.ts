import { answerConfirmation } from './fixtures';
import { createCourse, courseSection, saveCriterion, openSavedCourse } from './catalog-helpers';
import { requestPlan, completePlan, practicalOnly, qualificationPolicy } from './workflow-helpers';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect, actor } from './fixtures';

async function manage(page: Page, root?: string) {
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  if (root) await page.getByLabel('관리할 Lv1 조직', { exact: true }).selectOption(root);
}
async function lifecycle(page: Page, action: string) {
  await page.getByRole('button', { name: action, exact: true }).click();
  await page.getByLabel('처리 사유').fill('MVP 인증Set 운영 검증');
  await page.getByRole('button', { name: `${action} 실행`, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function apiFor(page: Page) {
  const tab = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  return async (path: string, data?: unknown, method = 'POST') => {
    const response = await page.request.fetch(`/api${path}`, {
      method: data === undefined ? 'GET' : method,
      headers: { 'X-Session-Tab': tab!, 'Idempotency-Key': crypto.randomUUID() },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
}

test('다른 창에서 전역 역할을 제거하면 선택한 타 Lv1 편집 권한도 즉시 해제', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await manage(page, 'org-etch');
  const call = await apiFor(page);
  const backupOperator = await call('/system/users', {
    name: '추가 운영자',
    organizationId: 'org-photo',
    roles: ['system_operator'],
  });
  await page.getByRole('link', { name: '인증Set 설정', exact: true }).click();
  await createCourse(page);
  await page.getByLabel('인증Set명', { exact: true }).fill('권한 제거 전 편집');
  const other = await page.context().newPage();
  await other.goto('/');
  await actor(other, backupOperator.id);
  const change = await apiFor(other);
  await change(
    '/system/users/operator-1',
    { revision: 1, name: '시스템 운영자', organizationId: 'org-photo', roles: ['admin'] },
    'PATCH',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '시스템 운영자 님', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '시스템 운영', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  await expect(page.getByLabel('관리할 Lv1 조직')).toHaveCount(0);
  await expect(page.locator('.management-context')).toContainText('Foundry Photo기술팀');
  await other.close();
});

test('탭별 Lv1 선택·새로고침·미저장 경고·저장 중 전환 차단·늦은 응답 보호', async ({
  page,
  backend,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await actor(page, 'operator-1');
  await manage(page, 'org-etch');
  const other = await page.context().newPage();
  await other.goto('/');
  await actor(other, 'operator-1');
  await manage(other, 'org-photo');
  await page.getByRole('link', { name: '인증Set 설정', exact: true }).click();
  await createCourse(page);
  await page.getByLabel('인증Set명', { exact: true }).fill('Etch 탭 초안');
  await page.getByLabel('관리할 Lv1 조직').selectOption('org-photo');
  await answerConfirmation(page, false);
  await expect(page.getByLabel('관리할 Lv1 조직')).toHaveValue('org-etch');
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('Etch 탭 초안');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  backend.store.beforeReplace = () => gate;
  try {
    await saveCriterion(page);
    await expect(page.getByLabel('관리할 Lv1 조직')).toBeDisabled();
    await expect(page.getByLabel('접속 계정')).toBeDisabled();
  } finally {
    release();
    backend.store.beforeReplace = undefined;
  }
  await expect(page.getByLabel('관리할 Lv1 조직')).toBeEnabled();
  await openSavedCourse(page);
  await page.reload();
  await expect(page.getByLabel('관리할 Lv1 조직')).toHaveValue('org-etch');
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('Etch 탭 초안');
  await expect(other.getByLabel('관리할 Lv1 조직')).toHaveValue('org-photo');
  await other.getByRole('link', { name: '인증Set 설정', exact: true }).click();
  await expect(other.getByRole('link', { name: 'Etch 탭 초안', exact: true })).toHaveCount(0);
  // Hold an old focus refresh while a new scope is selected.
  let oldResponse!: () => void, captured!: () => void;
  const oldGate = new Promise<void>((resolve) => {
    oldResponse = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route('**/api/workspace?lv1OrganizationId=org-etch', async (route) => {
    const response = await route.fetch();
    captured();
    await oldGate;
    await route.fulfill({ response });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await Promise.race([
    seen,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('focus refresh not captured')), 5000),
    ),
  ]);
  try {
    await page.getByLabel('관리할 Lv1 조직').selectOption('org-photo');
    await expect(page.getByRole('link', { name: '자료 확인', exact: true })).toBeVisible();
  } finally {
    oldResponse();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await expect(page.getByLabel('관리할 Lv1 조직')).toHaveValue('org-photo');
  await expect(page.getByRole('link', { name: 'Etch 탭 초안', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('management-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
  await other.close();
});

test('인증Set 삭제 영향·변경 충돌·응답 유실 재시도와 연결 초안 차단', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await manage(page, 'org-photo');
  const call = await apiFor(page);
  await page.getByRole('link', { name: '인증Set 설정', exact: true }).click();
  await createCourse(page);
  await expect(page.getByRole('button', { name: '인증Set 삭제', exact: true })).toBeVisible();
  const id = backend.store.snapshot().courses.at(-1)!.id;
  await page.getByRole('button', { name: '인증Set 삭제', exact: true }).click();
  await page.getByLabel('처리 사유').fill('삭제 검증');
  await call('/notices?lv1OrganizationId=org-photo', {
    title: '동시 변경',
    body: '확인 후 변경',
    published: false,
  });
  await page.getByRole('button', { name: '인증Set 삭제 실행', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('다시 조회');
  await page.getByRole('button', { name: '영향 다시 조회', exact: true }).click();
  let once = true;
  await page.route(`**/api/courses/${id}?*`, async (route) => {
    if (route.request().method() === 'DELETE' && once) {
      once = false;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: '인증Set 삭제 실행', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('다시 시도');
  await page.getByRole('button', { name: '인증Set 삭제 실행', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '인증Set 설정', exact: true })).toBeVisible();
  expect(
    backend.store
      .snapshot()
      .audits.filter((a) => a.action === 'course.delete' && a.targetId === id),
  ).toHaveLength(1);
  await page.getByRole('link', { name: 'Recipe 생성', exact: true }).click();
  await page.getByRole('button', { name: '인증Set 삭제', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('연결된 자격');
  await expect(page.getByRole('dialog')).toContainText('Recipe Management');
  await expect(page.getByRole('button', { name: '인증Set 삭제 실행', exact: true })).toBeDisabled();
});
