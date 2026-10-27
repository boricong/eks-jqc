import { test, expect, actor, answerConfirmation } from './fixtures';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const root = 'org-photo',
  group = 'org-photo-fmg',
  part = 'org-photo-pyeongtaek',
  q = 'demo-qualification';
async function setup(backend: any, exclude = false) {
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    'fixture',
    () => {},
    (s: any) => {
      const at = new Date().toISOString();
      s.organizationQualificationRequirements = [
        {
          organizationId: root,
          entityIds: [q],
          exclusions: [],
          revision: 1,
          updatedAt: at,
          updatedBy: 'admin-1',
        },
        ...(exclude
          ? [
              {
                organizationId: group,
                entityIds: [],
                exclusions: [
                  { entityId: q, reason: '기존 업무 범위', updatedBy: 'admin-1', updatedAt: at },
                ],
                revision: 1,
                updatedAt: at,
                updatedBy: 'admin-1',
              },
            ]
          : []),
      ];
      return {};
    },
  );
}
async function save(page: Page) {
  await page.getByRole('button', { name: '변경 확인', exact: true }).click();
  await page.getByRole('button', { name: '전체 변경 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '변경 확인', exact: true })).toBeDisabled();
}
async function reason(page: Page, text: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '변경 적용' })).toBeDisabled();
  await dialog.getByLabel('변경 사유', { exact: true }).fill(text);
  await dialog.getByRole('button', { name: '변경 적용' }).click();
  await expect(dialog).toHaveCount(0);
}
test('상속 제외 사유·하위 전파·재지정·다조직 저장과 네 폭', async ({ page, backend }, info) => {
  await setup(backend);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(`/admin/organization-requirements?organizationId=${group}`);
  const detail = page.getByRole('region', { name: '선택 조직 필요자격' });
  await expect(
    detail.getByRole('heading', { name: '이 조직의 필요자격 목록', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('조직 검색')).toHaveCount(0);
  await detail.getByRole('button', { name: /상속 제외$/ }).click();
  await page.getByRole('dialog').getByLabel('변경 사유').fill('  ');
  await reason(page, '그룹 담당 업무에서 제외');
  await expect(detail).toContainText('이 조직에서 제외');
  await page.locator(`[role=treeitem][data-id=${part}]`).click();
  await expect(detail).toContainText('상위 조직에서 제외');
  await detail.getByRole('button', { name: '직접 지정', exact: true }).click();
  await expect(detail).toContainText('직접');
  await page.getByRole('link', { name: '팀 자격 설정', exact: true }).click();
  await answerConfirmation(page, false);
  await page.getByRole('button', { name: '변경 확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('그룹 담당 업무에서 제외');
  await page.getByRole('button', { name: '전체 변경 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const records = backend.store.snapshot().organizationQualificationRequirements;
  expect(records.find((r) => r.organizationId === group)!.exclusions[0]!.reason).toBe(
    '그룹 담당 업무에서 제외',
  );
  expect(records.find((r) => r.organizationId === part)!.entityIds).toEqual([q]);
  await page.locator(`[role=treeitem][data-id=${group}]`).click();
  await detail.getByText('제외 근거', { exact: true }).click();
  const before = backend.store.snapshot();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const toggle = page.locator('.policy-tree-toggle');
    if (width < 1024 && (await toggle.getAttribute('aria-expanded')) === 'false')
      await toggle.click();
    const row = page.locator(`[role=treeitem][data-id=${group}]`);
    const name = await row.locator('.policy-tree-name').boundingBox();
    const status = await row.locator('.mapping-tree-status').boundingBox();
    expect(status!.x).toBeGreaterThanOrEqual(name!.x + name!.width - 1);
    expect(status!.y).toBeLessThan(name!.y + name!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(detail).toContainText('그룹 담당 업무에서 제외');
    await page.screenshot({ path: info.outputPath(`exceptions-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: '자격별', exact: true }).click();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const toggle = page.locator('.policy-tree-toggle');
    if (width < 1024 && (await toggle.getAttribute('aria-expanded')) === 'false')
      await toggle.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`exception-rules-${width}.png`),
      fullPage: true,
    });
  }
  expect(backend.store.snapshot()).toEqual(before);
});
test('상속 소멸 시 예외 유지·상위 재지정과 Hold 예외 해제', async ({ page, backend }) => {
  await setup(backend, true);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(`/admin/organization-requirements?organizationId=${group}`);
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    'remove-parent',
    () => {},
    (s) => {
      s.organizationQualificationRequirements.find((r) => r.organizationId === root)!.entityIds =
        [];
      return {};
    },
  );
  await page.reload();
  const detail = page.getByRole('region', { name: '선택 조직 필요자격' });
  await expect(detail).toContainText('현재 상속 없음');
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    'restore-parent-hold',
    () => {},
    (s) => {
      s.organizationQualificationRequirements.find((r) => r.organizationId === root)!.entityIds = [
        q,
      ];
      s.qualifications.find((x) => x.id === q)!.lifecycleStatus = 'Hold';
      return {};
    },
  );
  await page.reload();
  await expect(detail).toContainText('이 조직에서 제외');
  await expect(detail).not.toContainText('현재 상속 없음');
  await detail.getByRole('button', { name: '예외 해제', exact: true }).click();
  await reason(page, '상속 기준 재적용');
  await expect(detail).toContainText('요청 보류');
  await save(page);
  expect(
    backend.store
      .snapshot()
      .organizationQualificationRequirements.find((r) => r.organizationId === group)!.exclusions,
  ).toEqual([]);
});
test('같은 예외의 동시 사유 수정은 선택 후 재검토하며 세부 관리자 범위를 유지한다', async ({
  page,
  backend,
}) => {
  await setup(backend, true);
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    'detail-admin',
    () => {},
    (s) => {
      const u = s.users.find((u) => u.id === 'learner-2')!;
      u.organizationId = group;
      u.organizationAdministration = {
        organizationId: group,
        grantedBy: 'admin-1',
        grantedAt: new Date().toISOString(),
      };
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.goto('/admin/organization-requirements');
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '자격별', exact: true })).toHaveCount(0);
  const detail = page.getByRole('region', { name: '선택 조직 필요자격' });
  await detail.getByRole('button', { name: '사유 수정', exact: true }).click();
  await page.getByRole('dialog').getByLabel('변경 사유').fill('내가 확인한 변경 사유');
  await page.getByRole('button', { name: '변경 적용', exact: true }).click();
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    'concurrent-reason',
    () => {},
    (s) => {
      const r = s.organizationQualificationRequirements.find((r) => r.organizationId === group)!;
      r.exclusions[0]!.reason = '팀 관리자가 확인한 사유';
      r.revision++;
      return {};
    },
  );
  await page.getByRole('button', { name: '변경 확인', exact: true }).click();
  await page.getByRole('button', { name: '입력 유지하고 최신 기준 비교' }).click();
  const compare = page.getByRole('region', { name: '동시 변경 비교' });
  await expect(compare).toContainText('팀 관리자가 확인한 사유');
  await expect(compare).toContainText('내가 확인한 변경 사유');
  await expect(page.getByRole('button', { name: '변경 확인', exact: true })).toBeDisabled();
  await compare.getByRole('button', { name: '내 변경 사용' }).click();
  await save(page);
  expect(
    backend.store
      .snapshot()
      .organizationQualificationRequirements.find((r) => r.organizationId === group)!.exclusions[0]!
      .reason,
  ).toBe('내가 확인한 변경 사유');
});

test('예외 해제 후 직접 지정으로 바꿔도 해제 사유를 유지하고 키보드로 확인한다', async ({
  page,
  backend,
}) => {
  await setup(backend, true);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(`/admin/organization-requirements?organizationId=${group}`);
  const detail = page.getByRole('region', { name: '선택 조직 필요자격' });
  const restore = detail.getByRole('button', { name: '예외 해제', exact: true });
  await restore.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByLabel('변경 사유').fill('업무 변경으로 예외 해제');
  await page.getByRole('dialog').getByRole('button', { name: '변경 적용', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await detail.getByRole('button', { name: '이 조직에도 직접 지정', exact: true }).click();
  await save(page);
  const record = backend.store
    .snapshot()
    .organizationQualificationRequirements.find((r) => r.organizationId === group)!;
  expect(record.entityIds).toEqual([q]);
  expect(record.exclusions).toEqual([]);
  expect(JSON.stringify(backend.store.snapshot().audits.at(-1))).toContain(
    '업무 변경으로 예외 해제',
  );
});
