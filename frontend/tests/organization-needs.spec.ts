import type { Page } from '@playwright/test';
import { test, expect, actor, answerConfirmation } from './fixtures';
import { randomUUID } from 'node:crypto';
async function setup(backend: any) {
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    'needs-fixture',
    () => {},
    (s: any) => {
      s.organizationQualificationRequirements = [
        {
          organizationId: 'org-photo',
          entityIds: ['demo-qualification'],
          exclusions: [],
          revision: 1,
          updatedAt: new Date().toISOString(),
          updatedBy: 'admin-1',
        },
      ];
      return {};
    },
  );
}
async function add(page: Page, title: string) {
  await page.getByRole('button', { name: '자격 추가', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('checkbox', { name: `${title} · v1.0`, exact: true })
    .check();
  await page.getByRole('button', { name: '선택 추가 (1)', exact: true }).click();
}
async function saveMapping(page: Page) {
  await page.getByRole('button', { name: '변경 확인', exact: true }).click();
  await page.getByRole('button', { name: '전체 변경 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '변경 확인', exact: true })).toBeDisabled();
}
test('조직 직접 지정·상속과 미저장 보호·네 화면 폭', async ({ page, backend }, info) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/organization-requirements');
  const title = backend.store
    .snapshot()
    .qualifications.find((q) => q.id === 'demo-qualification')!.title;
  await add(page, title);
  await page.getByRole('link', { name: '팀 자격 설정', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(page.getByRole('region', { name: '선택 조직 필요자격' })).toContainText(title);
  await page.locator('[role=treeitem][data-id=org-photo-fmg]').click();
  const detail = page.getByRole('region', { name: '선택 조직 필요자격' });
  await expect(detail).toContainText('상속');
  await expect(detail.getByRole('button', { name: '이 조직에도 직접 지정' })).toBeEnabled();
  await page.getByRole('button', { name: '자격별', exact: true }).click();
  await expect(page.getByLabel('매핑할 자격')).toHaveValue('demo-qualification');
  await page.getByRole('button', { name: '조직별', exact: true }).click();
  await saveMapping(page);
  expect(backend.store.snapshot().organizationQualificationRequirements[0]!.entityIds).toEqual([
    'demo-qualification',
  ]);
  const before = backend.store.snapshot();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`needs-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: '자격별', exact: true }).click();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const treeToggle = page.locator('.policy-tree-toggle');
    if (width < 1024 && (await treeToggle.getAttribute('aria-expanded')) === 'false')
      await treeToggle.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByRole('combobox', { name: /적용 규칙$/ }).first()).toHaveValue('direct');
    await page.screenshot({
      path: info.outputPath(`qualification-map-${width}.png`),
      fullPage: true,
    });
  }
  expect(backend.store.snapshot()).toEqual(before);
});
test('팀 자격에서 필요 조직을 지정하고 소속별 전체 계획 요청·교체 종료를 확인한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification/edit');
  await page.getByRole('button', { name: '필요 조직 설정', exact: true }).click();
  await expect(page).toHaveURL(/organization-requirements.*view=qualification/);
  await page
    .getByRole('combobox', { name: /적용 규칙$/ })
    .first()
    .selectOption('direct');
  await saveMapping(page);
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  const name = backend.store.snapshot().users.find((u) => u.id === 'learner-2')!.name;
  await page.getByRole('dialog').getByRole('checkbox', { name, exact: true }).check();
  await page
    .getByRole('dialog')
    .getByLabel('안내문', { exact: true })
    .fill('필요자격 취득 계획을 작성해 주세요.\n일정은 담당 조직과 확인해 주세요.');
  await page.getByRole('button', { name: '요청 대상 확인', exact: true }).click();
  await expect(
    page.getByRole('region', { name: '요청 대상 검토 결과', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: '요청 인증 유형' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '대상 다시 검토' })).toHaveCount(0);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath(`request-preview-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const old = backend.store.snapshot().planningRequests.at(-1)!;
  expect(old.mode).toBe('organization_required');
  await actor(page, 'learner-2');
  await page.goto(`/plans?request=${old.id}`);
  await expect(page.getByRole('region', { name: '조직 관리자 안내문' })).toContainText(
    '필요자격 취득 계획을 작성해 주세요.',
  );
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('.request-schedule-row')).toHaveCount(1);
    await page.screenshot({
      path: test.info().outputPath(`personal-request-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect(page.getByRole('heading', { name: '자격 일정 수립', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '요청에서 제외', exact: true })).toHaveCount(0);
  await page.getByLabel('완료일', { exact: true }).fill('2027-02-01');
  await expect.poll(() => backend.store.snapshot().plans.length).toBe(1);
  const plan = backend.store.snapshot().plans.find((p) => p.requestId === old.id)!;
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name, exact: true }).check();
  await page.getByRole('button', { name: '요청 대상 확인', exact: true }).click();
  await page.getByRole('checkbox', { name: /이전 요청 교체 종료/ }).check();
  await page.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    backend.store.snapshot().planningRequests.find((r) => r.id === old.id)!.closed,
  ).toBeTruthy();
  await actor(page, 'learner-2');
  await page.goto(`/plans/${plan.id}`);
  await expect(page.getByRole('button', { name: '계획 완료', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('종료일', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '계획 내용', exact: true })).toBeVisible();
});
test('필요자격 미지정·저장 충돌·발송 응답 유실을 안내하고 입력·단일 요청을 유지한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  await expect(page.getByRole('button', { name: '계획 수립 요청', exact: true })).toBeDisabled();
  await setup(backend);
  await page.reload();
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('checkbox', {
      name: backend.store.snapshot().users.find((u) => u.id === 'learner-2')!.name,
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: '요청 대상 확인', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('안내문', { exact: true }).fill('검토 충돌에도 보존할 안내문');
  let count = 0;
  await page.route('**/api/planning-requests?*', async (route) => {
    if (route.request().method() === 'POST' && ++count === 1) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ message: '대상 기준 충돌 시험' }),
      });
    } else if (route.request().method() === 'POST' && count === 2) {
      expect((await route.fetch()).ok()).toBe(true);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"발송 응답 유실"}',
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('대상 기준 충돌 시험');
  await expect(dialog.getByLabel('안내문', { exact: true })).toHaveValue(
    '검토 충돌에도 보존할 안내문',
  );
  await expect(dialog.getByRole('region', { name: '요청 대상 검토 결과' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '요청 대상 확인', exact: true }).click();
  await dialog.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('발송 응답 유실');
  await page.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    backend.store.snapshot().planningRequests.filter((r) => r.mode === 'organization_required'),
  ).toHaveLength(1);
});

test('세부 관리자는 상속 출처를 읽고 자기 조직의 직접 지정만 해제하며 시스템 운영자는 선택 팀에 저장한다', async ({
  page,
  backend,
}) => {
  await setup(backend);
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    'sub-admin',
    () => {},
    (s) => {
      const u = s.users.find((u) => u.id === 'learner-2')!;
      u.organizationId = 'org-photo-fmg';
      u.organizationAdministration = {
        organizationId: u.organizationId,
        grantedBy: 'admin-1',
        grantedAt: new Date().toISOString(),
      };
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.goto('/admin/organization-requirements');
  await expect(page.getByRole('treeitem')).toHaveCount(9);
  await expect(page.getByRole('button', { name: '자격별', exact: true })).toHaveCount(0);
  const detail = page.getByRole('region', { name: '선택 조직 필요자격' });
  await expect(detail).toContainText('상속');
  await page.getByRole('button', { name: '이 조직에도 직접 지정' }).click();
  await saveMapping(page);
  await detail.getByRole('button', { name: /직접 지정 해제/ }).click();
  await page.getByRole('button', { name: '변경 확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('출처만 변경 9개 조직');
  await page.getByRole('button', { name: '전체 변경 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(detail).toContainText('상속');
  await actor(page, 'operator-1');
  await page.goto('/admin/organization-requirements?lv1OrganizationId=org-photo');
  await page
    .getByRole('region', { name: '선택 조직 필요자격' })
    .getByRole('button', { name: /직접 지정 해제/ })
    .click();
  await saveMapping(page);
  expect(
    backend.store
      .snapshot()
      .organizationQualificationRequirements.every((r) => !r.entityIds.length),
  ).toBe(true);
});

test('필요자격 검토 충돌은 입력을 유지하고 최신 기준으로 재검토한다', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/organization-requirements');
  const title = backend.store
    .snapshot()
    .qualifications.find((q) => q.id === 'demo-qualification')!.title;
  await add(page, title);
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    'unrelated-change',
    () => {},
    () => ({}),
  );
  await page.getByRole('button', { name: '변경 확인', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('변경');
  await expect(page.getByRole('region', { name: '선택 조직 필요자격' })).toContainText(title);
  await page.getByRole('button', { name: '입력 유지하고 최신 기준 비교', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await saveMapping(page);
  expect(backend.store.snapshot().organizationQualificationRequirements[0]!.entityIds).toEqual([
    'demo-qualification',
  ]);
});

test('여러 조직의 초안·검색·키보드·출처 변경은 한 번에 저장된다', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/organization-requirements');
  const title = backend.store
    .snapshot()
    .qualifications.find((q) => q.id === 'demo-qualification')!.title;
  await add(page, title);
  const root = page.locator('[role=treeitem][data-id=org-photo]');
  await root.focus();
  await root.press('ArrowDown');
  await expect(page.locator('[role=treeitem][data-id=org-photo-fmg]')).toBeFocused();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('region', { name: '선택 조직 필요자격' });
  await detail.getByRole('button', { name: '이 조직에도 직접 지정' }).click();
  await expect(page.locator('.mapping-toolbar')).toContainText('변경 2개 조직');
  await expect(page.getByLabel('조직 검색')).toHaveCount(0);
  await expect(
    detail.getByRole('heading', { name: '이 조직의 필요자격 목록', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '자격별', exact: true }).click();
  await saveMapping(page);
  const records = backend.store.snapshot().organizationQualificationRequirements;
  expect(
    records.filter((r) => r.entityIds.includes('demo-qualification')).map((r) => r.organizationId),
  ).toEqual(['org-photo', 'org-photo-fmg']);
  await page.getByRole('button', { name: '조직별', exact: true }).click();
  await detail.getByRole('button', { name: /직접 지정 해제/ }).click();
  await detail.locator('summary').filter({ hasText: '상속' }).click();
  await detail.getByRole('button', { name: /Foundry Photo/ }).click();
  await expect(page.locator('[role=treeitem][data-id=org-photo]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: '변경 확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('적용 변경 0개 조직 · 구성원 0명');
  await expect(page.getByRole('dialog')).toContainText('적용 유지');
  await page.getByRole('button', { name: '전체 변경 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('저장 응답 유실은 동일 요청으로 재시도하며 후속 조회 실패는 쓰기를 반복하지 않는다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/organization-requirements');
  await add(
    page,
    backend.store.snapshot().qualifications.find((q) => q.id === 'demo-qualification')!.title,
  );
  const keys: string[] = [];
  let failedRead = false;
  await page.route('**/api/organization-qualification-requirements?*', async (route) => {
    if (route.request().method() === 'PUT') {
      keys.push(route.request().headers()['idempotency-key']!);
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      if (keys.length === 1)
        return route.fulfill({ status: 503, json: { message: '저장 응답 유실' } });
      return route.fulfill({ response });
    }
    if (keys.length === 2 && !failedRead && route.request().method() === 'GET') {
      failedRead = true;
      return route.fulfill({ status: 503, json: { message: '후속 조회 실패' } });
    }
    return route.continue();
  });
  await page.getByRole('button', { name: '변경 확인', exact: true }).click();
  await page.getByRole('button', { name: '전체 변경 저장', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('저장 응답 유실');
  const saved = backend.store.snapshot();
  await page.getByRole('dialog').getByRole('button', { name: '저장 재시도' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('후속 조회 실패');
  await page.getByRole('dialog').getByRole('button', { name: '저장 재시도' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).toBe(keys[1]);
  expect(backend.store.snapshot()).toEqual(saved);
});

test('충돌 비교는 다른 관리자의 직접 지정을 지우지 않고 내 추가 의도만 합친다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/organization-requirements');
  await add(
    page,
    backend.store.snapshot().qualifications.find((q) => q.id === 'demo-qualification')!.title,
  );
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    'concurrent-mapping',
    () => {},
    (s) => {
      const q = structuredClone(s.qualifications.find((q) => q.id === 'demo-qualification')!);
      q.id = 'concurrent-qualification';
      q.entityId = q.id;
      q.title = '다른 관리자의 자격';
      const template = structuredClone(
        s.qualificationTemplates.find((t) => t.id === q.templateId)!,
      );
      template.id = 'concurrent-template';
      template.title = q.title;
      q.templateId = template.id;
      s.qualificationTemplates.push(template);
      s.qualifications.push(q);
      s.organizationQualificationRequirements.push({
        organizationId: 'org-photo',
        entityIds: [q.entityId],
        exclusions: [],
        revision: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: 'admin-1',
      });
      return {};
    },
  );
  await page.getByRole('button', { name: '변경 확인', exact: true }).click();
  await page.getByRole('button', { name: '입력 유지하고 최신 기준 비교', exact: true }).click();
  await expect(page.getByRole('region', { name: '선택 조직 필요자격' })).toContainText(
    '다른 관리자의 자격',
  );
  await saveMapping(page);
  expect(
    backend.store.snapshot().organizationQualificationRequirements[0]!.entityIds.sort(),
  ).toEqual(['concurrent-qualification', 'demo-qualification']);
});
