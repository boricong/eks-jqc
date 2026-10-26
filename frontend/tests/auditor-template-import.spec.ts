import { test, expect, actor } from './fixtures';
import { saveCriterion } from './catalog-helpers';

test('시스템 Auditor 기본자격을 팀 관리자가 유형별 목록에서 가져오고 편집한다', async ({
  page,
  backend,
}, info) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/qualification-templates');
  await page.getByRole('button', { name: '새 기본자격 만들기', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('인증 유형', { exact: true }).selectOption('auditor');
  await editor.getByLabel('기본자격명', { exact: true }).fill('공통 현장 Auditor');
  await editor.getByLabel('영문명', { exact: true }).fill('Shared Field Auditor');
  await editor.getByRole('button', { name: '기본자격 저장', exact: true }).click();
  await expect(editor).not.toBeVisible();
  const template = backend.store
    .snapshot()
    .qualificationTemplates.find((t) => t.title === '공통 현장 Auditor')!;
  expect(template.qualificationType).toBe('auditor');
  expect(template.description).toBe('');

  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications?type=auditor');
  const register = page.getByRole('button', { name: 'Auditor 자격 등록', exact: true });
  await register.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Auditor 자격 등록', exact: true });
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await expect(dialog.getByRole('checkbox', { name: /공통 현장 Auditor/ })).toBeEnabled();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`auditor-import-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  await dialog.getByRole('checkbox', { name: /공통 현장 Auditor/ }).check();
  await dialog.getByRole('button', { name: '팀 자격 등록', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('link', { name: '공통 현장 Auditor', exact: true })).toBeVisible();
  const q = backend.store.snapshot().qualifications.find((q) => q.templateId === template.id)!;
  expect(q.lv1OrganizationId).toBe('org-photo');
  expect(q.qualificationType).toBe('auditor');
  expect(backend.store.snapshot().auditorPrograms).toHaveLength(0);

  await register.click();
  await expect(dialog.getByRole('checkbox', { name: /공통 현장 Auditor/ })).toBeDisabled();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('link', { name: '공통 현장 Auditor', exact: true }).click();
  await page.getByLabel('인증기간', { exact: true }).selectOption('unlimited');
  await saveCriterion(page);
  await expect
    .poll(() =>
      backend.store
        .snapshot()
        .qualifications.some(
          (item) => item.entityId === q.entityId && item.validity.type === 'unlimited',
        ),
    )
    .toBe(true);
  const saved = backend.store
    .snapshot()
    .qualifications.filter((item) => item.entityId === q.entityId)
    .sort((a, b) => b.version - a.version)[0]!;
  await page.goto(`/admin/qualifications/${saved.id}`);
  await expect(page.getByLabel('인증기간', { exact: true })).toHaveValue('unlimited');
  await page.goto('/admin/qualifications?type=auditee');
  await page.getByRole('button', { name: 'Auditee 자격 등록', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('checkbox', { name: /공통 현장 Auditor/ }),
  ).toHaveCount(0);
});

test('Auditor 공통 기본자격이 없으면 등록 창에서 준비 안내를 표시한다', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications?type=auditor');
  await page.getByRole('button', { name: 'Auditor 자격 등록', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('등록할 Auditor 기본자격이 없습니다.');
  await expect(dialog.getByRole('button', { name: '팀 자격 등록', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
