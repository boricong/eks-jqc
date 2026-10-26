import type { Page } from '@playwright/test';
import { actor, expect } from './fixtures';
export async function registerAuditorFromPool(page: Page, title: string) {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/qualification-templates');
  await page.getByRole('button', { name: '새 기본자격 만들기', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('인증 유형', { exact: true }).selectOption('auditor');
  await editor.getByLabel('Auditor 등급', { exact: true }).selectOption('general');
  await editor.getByLabel('기본자격명', { exact: true }).fill(title);
  await editor.getByRole('button', { name: '기본자격 저장', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications?type=auditor');
  await page.getByRole('button', { name: 'Auditor 자격 등록', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: new RegExp(title) }).check();
  await dialog.getByRole('button', { name: '팀 자격 등록', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
