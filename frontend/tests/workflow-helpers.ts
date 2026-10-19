import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export async function requestPlan(page: Page, learnerName: string, ftId?: string) {
  await page.getByRole('link', { name: '대상자·계획', exact: true }).click();
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: learnerName, exact: true }).check();
  await dialog.getByLabel('계획 작성 기한').fill('2026-12-31');
  await dialog.getByLabel('안내문').fill('직무 수행에 필요한 자격별 계획을 작성해 주세요.');
  if (ftId) await dialog.getByLabel('담당 FT · 선택').selectOption(ftId);
  await dialog.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
export async function completePlan(page: Page, title: string, recordLearning = true) {
  await page.goto('/plans');
  await page.getByLabel('취득할 자격').selectOption({ label: `${title} · v1` });
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await expect(page.getByRole('heading', { name: '개인 인증 계획', exact: true })).toBeVisible();
  await page.getByLabel('목표 인증일', { exact: true }).fill('2027-02-01');
  for (const el of await page.getByLabel('학습 시작 예정일', { exact: true }).all())
    await el.fill('2026-10-01');
  for (const el of await page.getByLabel('학습 완료 예정일', { exact: true }).all())
    await el.fill('2026-10-15');
  for (const el of await page.getByLabel('평가 예정일', { exact: true }).all())
    await el.fill('2026-12-01');
  await page.getByRole('button', { name: '학습 목표 설정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '학습 목표 설정', exact: true })).toBeVisible();
  for (const el of await page.getByRole('textbox').all())
    await el.fill('판단 근거를 설명하고 도움 없이 독립적으로 수행한다.');
  await page.getByRole('button', { name: '최종 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '계획 최종 확인', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '계획 완료', exact: true }).click();
  await expect(page).toHaveURL(/\/qualifications\/[^/?]+$/);
  if (recordLearning) {
    await expect(page.locator('.course-workspace')).toBeVisible();
    const courses = page.locator('button.course-nav');
    for (let index = 0; index < (await courses.count()); index++) {
      await courses.nth(index).click();
      await expect(courses.nth(index)).toHaveAttribute('aria-current', 'step');
      while (await page.getByRole('button', { name: '학습 완료 기록', exact: true }).count()) {
        await page.getByRole('button', { name: '학습 완료 기록', exact: true }).first().click();
        await page
          .getByLabel('완료 내용', { exact: true })
          .fill('가상 교육의 독립 수행을 학습했습니다.');
        await page.getByRole('button', { name: '학습 기록 저장', exact: true }).click();
        await expect(page.getByRole('button', { name: '학습 기록 저장', exact: true })).toHaveCount(
          0,
        );
      }
    }
  }
}
export async function practicalOnly(page: Page) {
  await page.getByRole('checkbox', { name: '객관식', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '주관식', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '실기', exact: true }).check();
  if (!(await page.getByLabel('학습 항목명', { exact: true }).count())) {
    await page.getByRole('button', { name: '학습 항목 추가', exact: true }).click();
    await page.getByLabel('학습 항목명', { exact: true }).fill('가상 수행 연습');
  }
}
export async function qualificationPolicy(page: Page) {
  await page
    .getByLabel('자격 설명', { exact: true })
    .fill('가상 직무 기준의 독립 수행을 확인하는 검증 자격');
  await page.getByLabel('인증기간', { exact: true }).selectOption('unlimited');
}
