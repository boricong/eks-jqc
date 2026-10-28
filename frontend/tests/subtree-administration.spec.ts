import { test, expect, actor } from './fixtures';
import { nodeFor } from '../../server/src/organizations';

const own = 'org-photo-fmg',
  child = 'org-photo-pyeongtaek',
  leaf = 'org-photo-pyeongtaek-1';

test('세부 관리자가 하위 조직 정보·상속 제외·대상자 상태를 편집하고 네 폭·키보드로 탐색한다', async ({
  page,
  backend,
}, info) => {
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'subtree-fixture',
    () => {},
    (s) => {
      const manager = s.users.find((u) => u.id === 'learner-2')!;
      manager.organizationId = own;
      manager.organizationAdministration = {
        organizationId: own,
        grantedBy: 'admin-1',
        grantedAt: new Date().toISOString(),
      };
      s.users.find((u) => u.id === 'ft-1')!.organizationId = leaf;
      s.organizationQualificationRequirements = [
        {
          organizationId: 'org-photo',
          entityIds: ['demo-qualification'],
          exclusions: [],
          revision: 1,
          updatedBy: 'admin-1',
          updatedAt: new Date().toISOString(),
        },
      ];
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.goto('/admin/organization-settings');
  await expect(page.getByRole('treeitem')).toHaveCount(9);
  await expect(page.locator('.management-context')).toContainText('본인 조직 및 모든 하위 조직');
  const row = (id: string) => page.locator(`[role=treeitem][data-id="${id}"]`);
  await row(own).focus();
  await page.keyboard.press('ArrowRight');
  await expect(row(child)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(row(leaf)).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByLabel('조직 설명', { exact: true }).fill('손자 조직 설명 변경');
  await page.getByLabel('담당 업무', { exact: true }).fill('하위 조직 인증 관리');
  await page.getByRole('button', { name: '조직 설정 변경 확인', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(nodeFor(backend.store.organizations.snapshot().roots, leaf)!.description).toBe(
    '손자 조직 설명 변경',
  );
  await page.getByRole('button', { name: '세부 조직 관리자 펼치기', exact: true }).click();
  await expect(
    page.getByRole('region', { name: '세부 조직 관리자 지정' }).getByRole('checkbox'),
  ).toHaveCount(0);
  await page.goto(`/admin/organization-requirements?organizationId=${child}`);
  const detail = page.getByRole('region', { name: '선택 조직 필요자격' });
  await detail.getByRole('button', { name: /상속 제외$/ }).click();
  await page.getByRole('dialog').getByLabel('변경 사유').fill('하위 부서 업무 제외');
  await page.getByRole('dialog').getByRole('button', { name: '변경 적용' }).click();
  await page.getByRole('button', { name: '변경 확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('RE A조');
  await page.getByRole('button', { name: '전체 변경 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await row(leaf).click();
  await expect(detail).toContainText('상위 조직에서 제외');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const toggle = page.locator('.policy-tree-toggle');
    if (width < 1024 && (await toggle.getAttribute('aria-expanded')) === 'false')
      await toggle.click();
    await expect(row(leaf)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`subtree-requirements-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/targets');
  await page.getByRole('checkbox', { name: '박준호 선택', exact: true }).check();
  await page.getByRole('button', { name: '대상자 상태 변경', exact: true }).click();
  await page.getByRole('dialog').getByLabel('변경 사유').fill('하위 조직 대상 조정');
  await page.getByRole('dialog').getByRole('button', { name: '대상 상태 저장' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    backend.store.snapshot().users.find((u) => u.id === 'ft-1')!.certificationEligibility,
  ).toBe('hold');
  await page.getByRole('checkbox', { name: '박준호 선택', exact: true }).check();
  await page.getByRole('button', { name: '대상자 상태 변경', exact: true }).click();
  await page.getByRole('dialog').getByRole('combobox').selectOption('eligible');
  await page.getByRole('dialog').getByLabel('변경 사유').fill('하위 조직 대상 복원');
  await page.getByRole('dialog').getByRole('button', { name: '대상 상태 저장' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    backend.store.snapshot().users.find((u) => u.id === 'ft-1')!.certificationEligibility,
  ).toBe('eligible');
  await page.goto('/admin/dashboard');
  await expect(page.getByLabel('조회 조직', { exact: true })).toHaveValue(own);
  await expect(page.getByLabel('하위 조직 포함', { exact: true })).toHaveValue('true');
  await expect(page.getByLabel('조회 조직', { exact: true }).locator('option')).toHaveCount(9);
  await page.getByLabel('조회 조직', { exact: true }).selectOption(child);
  await page.getByLabel('하위 조직 포함', { exact: true }).selectOption('false');
  await expect(page).toHaveURL(/includeDescendants=false/);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel('조회 조직', { exact: true })).toHaveValue(child);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`subtree-dashboard-${width}.png`),
      fullPage: true,
    });
  }
});
