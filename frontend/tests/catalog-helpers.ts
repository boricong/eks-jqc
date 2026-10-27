import { expect, type Page } from '@playwright/test';
export async function courseSection(page: Page, name: string) {
  const tabs = page.getByRole('tablist', { name: '인증Set 편집 항목', exact: true });
  await tabs.getByRole('tab', { name: new RegExp(`^${name}( · 보완 필요)?$`) }).click();
}
export async function openSavedCourse(page: Page, section?: string) {
  await expect(page).toHaveURL(/\/admin\/courses(?:\?|$)/);
  await expect(page.getByRole('heading', { name: '인증Set 설정', exact: true })).toBeVisible();
  await page.getByTestId('saved-course-link').click();
  await expect(page.getByLabel('인증Set명', { exact: true })).toBeEnabled();
  if (section) await courseSection(page, section);
}
export async function saveCriterion(page: Page, mode?: 'current' | 'new') {
  const dialog = page.getByRole('dialog', { name: '기준 저장 확인', exact: true });
  if (await dialog.isVisible())
    await dialog.getByRole('button', { name: '계속 편집', exact: true }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '저장', exact: true })).toBeEnabled();
  await expect(dialog.or(page.locator('.editor-errors')).first()).toBeVisible();
  if (await dialog.isVisible()) {
    if (mode && (await dialog.getByRole('radio').count())) {
      await dialog
        .getByRole('radio', { name: mode === 'new' ? /^새 버전 생성/ : /^현재 버전에 저장/ })
        .check();
    }
    await dialog
      .locator('.dialog-footer')
      .getByRole('button', {
        name: /^(저장 확인|현재 버전에 저장|새 버전 생성|새 버전 저장|v1으로 최초 설정 저장|v1.0으로 최초 설정 저장|닫기)$/,
      })
      .click();
  }
}

export async function createCourse(page: Page, type = 'Auditee', name = '새 인증Set') {
  await page.getByRole('button', { name: `${type} 특화인증Set 추가`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `${type} 특화인증Set 만들기`, exact: true });
  await dialog.getByLabel('인증Set명', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '생성 후 편집', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('인증Set명', { exact: true })).toBeVisible();
}
