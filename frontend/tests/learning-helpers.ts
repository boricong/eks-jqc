import type { Page } from '@playwright/test';
import { expect } from './fixtures';
export const learningContentTabs = (page: Page) =>
  page.getByRole('tablist', { name: '인증Set 학습 내용', exact: true });
export async function showLearningMaterials(page: Page) {
  const tab = learningContentTabs(page).getByRole('tab', { name: /^학습자료 / });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}
export async function showLearningScope(page: Page) {
  const tab = learningContentTabs(page).getByRole('tab', { name: /^학습범위 / });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}
