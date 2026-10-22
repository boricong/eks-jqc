import { expect, type Page } from '@playwright/test';
export async function courseSection(page: Page, name: string) {
  const toggle = page.locator('.course-editor-menu-toggle');
  const tabs = page.getByRole('tablist', { name: '인증Set 편집 항목', exact: true });
  if ((await toggle.isVisible()) && !(await tabs.isVisible())) await toggle.click();
  await tabs.getByRole('tab', { name, exact: true }).click();
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
