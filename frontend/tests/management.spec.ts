import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect, actor } from './fixtures';

async function manage(page: Page, root?: string) {
  await page.getByRole('link', { name: '인증 업무 관리', exact: true }).click();
  if (root) await page.getByLabel('관리할 Lv1 조직', { exact: true }).selectOption(root);
}
async function lifecycle(page: Page, action: string) {
  await page.getByRole('button', { name: action, exact: true }).click();
  await page.getByLabel('처리 사유').fill('MVP 과정 운영 검증');
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
  await page.getByRole('link', { name: '과정 관리', exact: true }).click();
  await page.getByRole('button', { name: '과정 추가', exact: true }).click();
  await page.getByLabel('과정명', { exact: true }).fill('권한 제거 전 편집');
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

test('새 Lv1 생성 후 운영자 기준·배정, 종료 후 기존 학습자·FT 완료와 인증 보존', async ({
  page,
  backend,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await actor(page, 'operator-1');
  await manage(page);
  await expect(page.getByLabel('관리할 Lv1 조직')).toHaveValue('');
  await expect(page.getByRole('button', { name: '자격 추가' })).toHaveCount(0);
  await page.getByRole('link', { name: '시스템 운영', exact: true }).click();
  await page.getByLabel('조직 검색').fill('검색 중');
  await page.getByRole('button', { name: 'Lv1 조직 추가', exact: true }).click();
  await expect(page.getByLabel('상위 조직', { exact: true })).toHaveCount(0);
  await page.getByLabel('조직명', { exact: true }).fill('MVP 신규 Lv1');
  await page.getByRole('button', { name: '조직 저장', exact: true }).click();
  await expect(page.locator('.tree-node.selected')).toContainText('MVP 신규 Lv1');
  await expect(page.getByLabel('조직 검색')).toHaveValue('');
  const root = backend.store.organizations.snapshot().roots.at(-1)!.id;
  await page.getByRole('link', { name: '사용자 등록', exact: true }).click();
  await expect(page.getByLabel('Lv1 조직', { exact: true })).toHaveValue(root);
  await page.getByLabel('이름', { exact: true }).fill('신규 학습자');
  await page.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(page.locator('.user-editor')).toHaveCount(0);
  await page.getByRole('button', { name: '사용자 추가', exact: true }).click();
  await page.getByLabel('이름', { exact: true }).fill('신규 FT');
  await page.getByLabel('Lv1 조직', { exact: true }).selectOption(root);
  await page.getByLabel('학습자', { exact: true }).uncheck();
  await page.getByLabel('FT', { exact: true }).check();
  await page.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(page.locator('.user-editor')).toHaveCount(0);
  await page.getByRole('link', { name: '조직 관리', exact: true }).click();
  await page.locator('.tree-node').filter({ hasText: 'MVP 신규 Lv1' }).click();
  await page.getByRole('link', { name: '이 조직의 인증 업무 관리', exact: true }).click();
  await expect(page.getByLabel('관리할 Lv1 조직')).toHaveValue(root);
  await expect(page).toHaveURL(new RegExp(`lv1OrganizationId=${root}`));
  await expect(page.locator('.management-context')).toContainText('시스템 운영자 관리');
  await page.getByRole('link', { name: '과정 관리', exact: true }).click();
  await page.getByRole('button', { name: '과정 추가', exact: true }).click();
  await page.getByLabel('과정명', { exact: true }).fill('신규 조직 실기');
  await page.getByLabel('필수 평가').selectOption('practical');
  await page.getByRole('button', { name: '항목 추가', exact: true }).click();
  await page.getByLabel('항목명', { exact: true }).fill('독립 수행');
  await page.getByLabel('판정 기준', { exact: true }).fill('가상 조건에서 수행');
  await page.getByRole('button', { name: '사용 등록', exact: true }).click();
  await expect(page.getByRole('button', { name: '운영 종료', exact: true })).toBeVisible();
  const course = backend.store.snapshot().courses.find((c) => c.title === '신규 조직 실기')!;
  await page.getByRole('link', { name: '자격 관리', exact: true }).click();
  await page.getByRole('button', { name: '자격 추가', exact: true }).click();
  await page.getByLabel('자격명', { exact: true }).fill('신규 조직 자격');
  await page.getByRole('checkbox', { name: /신규 조직 실기/ }).check();
  await page.getByRole('button', { name: '사용 등록', exact: true }).click();
  await expect(page.getByRole('button', { name: '새 버전', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '자격 배정', exact: true }).click();
  await page.getByRole('button', { name: '자격 배정', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '배정', exact: true }).click();
  await expect(page.locator('tbody')).toContainText('신규 학습자');
  const assignment = backend.store
    .snapshot()
    .assignments.find((a) => a.lv1OrganizationId === root)!;
  expect(assignment.ownerAdminId).toBe('operator-1');
  expect(backend.store.snapshot().users.find((u) => u.id === 'operator-1')!.organizationId).toBe(
    'org-photo',
  );
  await page.getByRole('link', { name: '과정 관리', exact: true }).click();
  await page.getByRole('link', { name: '신규 조직 실기', exact: true }).click();
  await page.getByRole('button', { name: '운영 종료', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    '신규 배정은 중단되며 기존 배정과 취득한 인증은 유지됩니다',
  );
  await expect(page.getByRole('dialog')).toContainText('배정 1건');
  await page.getByLabel('처리 사유').fill('다음 기수 운영 종료');
  await page.getByRole('button', { name: '운영 종료 실행', exact: true }).click();
  await expect(page.getByRole('button', { name: '운영 재개', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '자격 관리', exact: true }).click();
  await expect(page.locator('tbody')).toContainText('신규 배정 불가');
  await actor(page, assignment.learnerId);
  await page.getByRole('link', { name: '이어서 진행', exact: true }).click();
  await expect(page.locator('.course-workspace')).toContainText('운영 종료');
  await page.getByRole('link', { name: '평가 요청', exact: true }).click();
  await page.getByRole('button', { name: '평가 요청', exact: true }).click();
  await actor(page, assignment.ftId!);
  await page.getByRole('link', { name: 'FT 평가', exact: true }).click();
  await page.getByRole('link', { name: '평가하기', exact: true }).click();
  await page.getByLabel('통과', { exact: true }).check();
  await page.getByLabel('판정 근거', { exact: true }).fill('독립 수행 확인');
  await page.getByRole('button', { name: '판정 확인', exact: true }).click();
  await page.getByRole('button', { name: '평가 확정', exact: true }).click();
  await expect(
    page.getByText('신규 학습자 님이 이 과정을 수료했습니다.', { exact: true }),
  ).toBeVisible();
  const certificate = backend.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === assignment.id)!;
  await actor(page, 'operator-1');
  await manage(page);
  await expect(page.getByLabel('관리할 Lv1 조직')).toHaveValue(root);
  await page.getByRole('link', { name: '과정 관리', exact: true }).click();
  await expect(page.getByRole('link', { name: '신규 조직 실기', exact: true })).toHaveCount(0);
  await page.getByLabel('상태 필터').selectOption('retired');
  await page.getByRole('link', { name: '신규 조직 실기', exact: true }).click();
  await lifecycle(page, '운영 재개');
  await lifecycle(page, '운영 종료');
  expect(backend.store.snapshot().certifications.find((c) => c.id === certificate.id)).toEqual(
    certificate,
  );
  await page.goto(`/certifications/${assignment.id}?lv1OrganizationId=${root}`);
  await expect(page.getByRole('heading', { name: '검증용 인증', exact: true })).toBeVisible();
  await expect(page.locator('.evidence-course')).toContainText('운영 종료');
  await page.screenshot({ path: test.info().outputPath('retired-certification.png') });
  const master = await readFile(backend.store.organizations.file, 'utf8');
  await backend.restart();
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto(`/admin/courses/${course.id}?lv1OrganizationId=${root}`);
  await expect(page.getByRole('button', { name: '운영 재개', exact: true })).toBeVisible();
  expect(await readFile(backend.store.organizations.file, 'utf8')).toBe(master);
  expect(errors).toEqual([]);
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
  await page.getByRole('link', { name: '과정 관리', exact: true }).click();
  await page.getByRole('button', { name: '과정 추가', exact: true }).click();
  await page.getByLabel('과정명', { exact: true }).fill('Etch 탭 초안');
  page.once('dialog', (d) => d.dismiss());
  await page.getByLabel('관리할 Lv1 조직').selectOption('org-photo');
  await expect(page.getByLabel('관리할 Lv1 조직')).toHaveValue('org-etch');
  await expect(page.getByLabel('과정명', { exact: true })).toHaveValue('Etch 탭 초안');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  backend.store.beforeReplace = () => gate;
  try {
    await page.getByRole('button', { name: '초안 저장', exact: true }).click();
    await expect(page.getByLabel('관리할 Lv1 조직')).toBeDisabled();
    await expect(page.getByLabel('접속 계정')).toBeDisabled();
  } finally {
    release();
    backend.store.beforeReplace = undefined;
  }
  await expect(page.getByLabel('관리할 Lv1 조직')).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel('관리할 Lv1 조직')).toHaveValue('org-etch');
  await expect(page.getByLabel('과정명', { exact: true })).toHaveValue('Etch 탭 초안');
  await expect(other.getByLabel('관리할 Lv1 조직')).toHaveValue('org-photo');
  await other.getByRole('link', { name: '과정 관리', exact: true }).click();
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

test('초안 삭제 영향·변경 충돌·응답 유실 재시도와 연결 초안 차단', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await manage(page, 'org-photo');
  const call = await apiFor(page);
  await page.getByRole('link', { name: '과정 관리', exact: true }).click();
  await page.getByRole('button', { name: '과정 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: '초안 삭제', exact: true })).toBeVisible();
  const id = backend.store.snapshot().courses.at(-1)!.id;
  await page.getByRole('button', { name: '초안 삭제', exact: true }).click();
  await page.getByLabel('처리 사유').fill('삭제 검증');
  await call('/notices?lv1OrganizationId=org-photo', {
    title: '동시 변경',
    body: '확인 후 변경',
    published: false,
  });
  await page.getByRole('button', { name: '초안 삭제 실행', exact: true }).click();
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
  await page.getByRole('button', { name: '초안 삭제 실행', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('다시 시도');
  await page.getByRole('button', { name: '초안 삭제 실행', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '과정 관리', exact: true })).toBeVisible();
  expect(
    backend.store
      .snapshot()
      .audits.filter((a) => a.action === 'course.delete' && a.targetId === id),
  ).toHaveLength(1);
  await page.getByRole('link', { name: 'Recipe 생성', exact: true }).click();
  await page.getByRole('button', { name: '초안 삭제', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('연결된 자격');
  await expect(page.getByRole('dialog')).toContainText('Recipe Management');
  await expect(page.getByRole('button', { name: '초안 삭제 실행', exact: true })).toBeDisabled();
});
