import { test, expect, actor, answerConfirmation } from './fixtures';
import { registerFixtureQualification } from '../../server/tests/template-helpers';
import { saveCriterion } from './catalog-helpers';

test('팀 자격 최초 설정 저장 후 선택 팀·유형 목록으로 복귀한다', async ({ page, backend }) => {
  const ready = await registerFixtureQualification(backend.store, '저장 후 목록 검증');
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(
    `/admin/qualifications/${ready.id}/edit?lv1OrganizationId=org-photo&type=auditee`,
  );
  await page.getByLabel('인증기간', { exact: true }).selectOption('unlimited');
  await page.locator('[data-course-id="demo-course-1"]').getByRole('checkbox').check();
  await saveCriterion(page);
  await expect(page).toHaveURL(/\/admin\/qualifications\?/);
  expect(new URL(page.url()).searchParams.get('type')).toBeNull();
  await expect(page.getByRole('tab', { name: 'Auditee(피심사자)', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('heading', { name: '팀 자격 설정', exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '저장 후 목록 검증' })).toContainText(
    'v1.0',
  );
});

test('기본자격 삭제 확인·취소·실패 재시도·사용 중 제한과 키보드 초점', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/qualification-templates');
  await page.getByRole('button', { name: '새 기본자격 만들기', exact: true }).click();
  await page.getByLabel('기본자격명', { exact: true }).fill('삭제 검증 기본자격');
  await page.getByRole('button', { name: '기본자격 저장', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '기본자격 편집', exact: true })).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: '삭제 검증 기본자격' }),
    before = backend.store.snapshot();
  const remove = row.getByRole('button', { name: '삭제 검증 기본자격 삭제', exact: true });
  await remove.click();
  await answerConfirmation(page, false);
  expect(backend.store.snapshot()).toEqual(before);
  await page.route('**/api/system/qualification-templates/*', (r) =>
    r.request().method() === 'DELETE'
      ? r.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: '삭제 실패 시험' }),
        })
      : r.continue(),
  );
  await remove.click();
  await answerConfirmation(page, true);
  await expect(page.getByRole('alert')).toContainText('삭제 실패 시험');
  await expect(row).toBeVisible();
  await page.unroute('**/api/system/qualification-templates/*');
  await remove.focus();
  await page.keyboard.press('Enter');
  await answerConfirmation(page, true);
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('button', { name: '새 기본자격 만들기', exact: true })).toBeFocused();
  expect(backend.store.snapshot().qualifications).toEqual(before.qualifications);
  expect(
    backend.store.snapshot().audits.filter((a) => a.action === 'qualification-template.delete'),
  ).toHaveLength(1);
  const s = backend.store.snapshot(),
    used = s.qualificationTemplates.find((t) => t.id === s.qualifications[0]!.templateId)!;
  const usedRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: used.title, exact: true }) });
  await expect(
    usedRow.getByRole('button', { name: `${used.title} 삭제`, exact: true }),
  ).toBeDisabled();
  await expect(usedRow).toContainText('팀 자격');
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(
    await usedRow.locator('small').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
});

test('필요자격 조직 트리 외곽선·자격별 구획과 네 화면 폭', async ({ page, backend }, info) => {
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'mapping-visual',
    () => {},
    (s) => {
      s.organizationQualificationRequirements = [
        {
          organizationId: 'org-photo',
          entityIds: s.qualifications.slice(0, 2).map((q) => q.entityId),
          exclusions: [],
          revision: 1,
          updatedAt: new Date().toISOString(),
          updatedBy: 'operator-1',
        },
      ];
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/organization-requirements?organizationId=org-photo');
  const detail = page.getByRole('region', { name: '선택 조직 필요자격', exact: true });
  await expect(detail.locator('.mapping-row')).toHaveCount(2);
  const before = backend.store.snapshot();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const styles = await page.locator('.policy-tree-panel').evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.borderTopWidth, style: s.borderTopStyle };
    });
    expect(styles).toEqual({ width: '1px', style: 'solid' });
    const rows = detail.locator('.mapping-row'),
      a = await rows.nth(0).boundingBox(),
      b = await rows.nth(1).boundingBox();
    expect(b!.y - (a!.y + a!.height)).toBeGreaterThanOrEqual(15);
    await expect(rows.nth(0).locator('.mapping-row-actions')).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`mapping-separated-${width}.png`),
      fullPage: true,
    });
  }
  expect(backend.store.snapshot()).toEqual(before);
});
