import { expect, type Page } from '@playwright/test';
export async function courseSection(page: Page, name: string) {
  const tabs = page.getByRole('tablist', { name: '인증Set 편집 항목', exact: true });
  await tabs.getByRole('tab', { name: new RegExp(`^${name}( · 보완 필요)?$`) }).click();
}
export async function openSavedCourse(page: Page, section?: string) {
  await expect(page).toHaveURL(/\/admin\/courses(?:\?|$)/);
  await expect(page.getByRole('heading', { name: '인증Set 관리', exact: true })).toBeVisible();
  await page.getByTestId('saved-course-link').click();
  await expect(page.getByLabel('인증Set명', { exact: true })).toBeEnabled();
  if (section) await courseSection(page, section);
}
export async function saveCriterion(page: Page) {
  const dialog = page.getByRole('dialog', { name: '기준 저장 확인', exact: true });
  if (await dialog.isVisible())
    await dialog.getByRole('button', { name: '계속 편집', exact: true }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '저장', exact: true })).toBeEnabled();
  await expect(dialog.or(page.locator('.editor-errors')).first()).toBeVisible();
  if (await dialog.isVisible())
    await dialog.getByRole('button', { name: '저장 확인', exact: true }).click();
}
