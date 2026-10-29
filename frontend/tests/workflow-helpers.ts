import { qualificationUseErrors, type PersonalPlan } from '@eks/contracts';
import type { Page } from '@playwright/test';
import { expect } from './fixtures';

// The API still accepts completed-plan changes; learner screens are read-only.
export async function savePlanViaApi(
  page: Page,
  id: string,
  fields: Partial<Pick<PersonalPlan, 'startOn' | 'endOn' | 'goal'>>,
  reason: string,
) {
  const tab = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  const headers = {
    'X-Session-Tab': tab!,
    'X-EKS-Release-Contract': '2',
    'Idempotency-Key': crypto.randomUUID(),
  };
  const workspace = await (await page.request.get('/api/workspace', { headers })).json();
  const plan = workspace.plans.find((p: PersonalPlan) => p.id === id) as PersonalPlan;
  const response = await page.request.put(`/api/plans/${id}`, {
    headers,
    data: {
      endOn: plan.endOn,
      startOn: plan.startOn,
      goal: plan.goal,
      ...fields,
      revision: plan.revision,
      reason,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

// Explicitly configure current organizational needs before testing new requests.
export async function configureNeeds(page: Page) {
  const tab = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  const scope = new URL(page.url()).searchParams.get('lv1OrganizationId') || 'org-photo';
  const headers = {
    'X-Session-Tab': tab!,
    'X-EKS-Release-Contract': '2',
    'Idempotency-Key': crypto.randomUUID(),
  };
  const url = `/api/organization-qualification-requirements?lv1OrganizationId=${scope}`;
  const view = await (await page.request.get(url, { headers })).json();
  const response = await page.request.put(url, {
    headers,
    data: {
      contractVersion: 2,
      stateRevision: view.stateRevision,
      organizationRevision: view.organizationRevision,
      changes: [
        {
          organizationId: scope,
          exclusions:
            view.entries
              .find((e: any) => e.id === scope)
              ?.exclusions.map((e: any) => ({ entityId: e.entityId, reason: e.reason })) || [],
          removalReasons: [],
          entityIds: view.qualifications
            .filter((q: any) => !q.issues.length)
            .map((q: any) => q.entityId),
        },
      ],
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function requestPlan(page: Page, learnerName: string) {
  const tab = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  const scope = new URL(page.url()).searchParams.get('lv1OrganizationId') || 'org-photo';
  const headers = {
    'X-Session-Tab': tab!,
    'X-EKS-Release-Contract': '2',
    'Idempotency-Key': crypto.randomUUID(),
  };
  const ws = await (
    await page.request.get(`/api/workspace?lv1OrganizationId=${scope}`, { headers })
  ).json();
  await configureNeeds(page);
  await page.goto(`/admin/assignments?lv1OrganizationId=${scope}`);
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: learnerName, exact: true }).check();
  await dialog.getByLabel('계획 작성 기한').fill('2026-12-31');
  await dialog.getByLabel('안내문').fill('직무 수행에 필요한 자격별 계획을 작성해 주세요.');
  await dialog.getByRole('button', { name: '요청 대상 확인', exact: true }).click();
  await dialog.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
export async function completePlan(page: Page, title: string, recordLearning = true) {
  await page.goto('/plans');
  await expect(page.getByRole('heading', { name: '자격 일정 수립', exact: true })).toBeVisible();
  if (await page.getByRole('button', { name: '전체 계획 확인', exact: true }).count()) {
    const extra = page.locator('.request-schedule-extras > div').filter({ hasText: title });
    if (await extra.count())
      await extra.first().getByRole('button', { name: '계획에 추가' }).click();
    for (const row of await page.locator('.request-schedule-row').all()) {
      if (!(await row.getByLabel('시작일', { exact: true }).count())) continue;
      await row.getByLabel('시작일', { exact: true }).fill('2026-10-01');
      await row.getByLabel('완료일', { exact: true }).fill('2027-02-01');
      await row.locator('summary').click();
      await row
        .getByLabel('학습 목표(선택)', { exact: true })
        .fill('판단 근거를 설명하고 도움 없이 독립적으로 수행한다.');
    }
    await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '전체 계획 최종 확인', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '전체 계획 확정', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '전체 계획 확정 완료', exact: true }),
    ).toBeVisible();
  }
  await page
    .locator('.request-schedule-read-row')
    .filter({ hasText: title })
    .first()
    .getByRole('link', { name: '학습·평가로 이동' })
    .click();
  await expect(page).toHaveURL(/\/qualifications\/[^/?]+$/);
  if (recordLearning) {
    await expect(page.getByRole('region', { name: '학습 안내' })).toBeVisible();
    await page.getByRole('link', { name: '평가 시작', exact: true }).click();
  }
}
export async function practicalOnly(page: Page) {
  await page.getByRole('checkbox', { name: '객관식 · 지식 평가 수료 필수', exact: true }).uncheck();
  await page
    .getByRole('checkbox', { name: '실기 · 상황 대응 평가 수료 필수', exact: true })
    .check();
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
