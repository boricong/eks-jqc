import { test, expect, actor, answerConfirmation } from './fixtures';
import { randomUUID } from 'node:crypto';

test('이전 조직 주소는 새 정보·관리자 화면으로 이동하며 저장·미저장 보호와 네 폭을 유지한다', async ({
  page,
  backend,
}, info) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/policies?lv1OrganizationId=org-photo');
  await expect(page).toHaveURL(/\/admin\/organization-settings\?lv1OrganizationId=org-photo$/);
  await expect(
    page.getByRole('heading', { name: '조직 정보·필요자격', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '조직 필수 자격 설정', exact: true })).toHaveCount(0);
  await expect(page.getByText('필수 자격 · 선택 사항', { exact: true })).toHaveCount(0);
  await page.getByLabel('조직 설명', { exact: true }).fill('팀 운영 설명');
  await page.getByLabel('담당 업무', { exact: true }).fill('담당 업무 보존');
  await page.getByRole('button', { name: '조직 설정 변경 확인', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(
    backend.store.organizations.snapshot().roots.find((o) => o.id === 'org-photo')!.description,
  ).toBe('팀 운영 설명');
  const before = backend.store.snapshot(),
    org = backend.store.organizations.snapshot();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`organization-settings-${width}.png`),
      fullPage: true,
    });
  }
  expect(backend.store.snapshot()).toEqual(before);
  expect(backend.store.organizations.snapshot()).toEqual(org);
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByLabel('조직 설명', { exact: true }).fill('미저장 입력');
  await page.getByRole('link', { name: '인증Set 설정', exact: true }).click();
  await page
    .getByTestId('app-confirmation')
    .getByRole('button', { name: '취소', exact: true })
    .click();
  await expect(page.getByLabel('조직 설명', { exact: true })).toHaveValue('미저장 입력');
});

test('이전 필수 현황 조건은 정리하고 조직·유형과 일반 현황·직접 조회를 유지한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  const before = backend.store.snapshot();
  await page.goto(
    '/admin/dashboard?lv1OrganizationId=org-photo&organizationId=org-photo&qualificationType=auditee&required=required&metric=requiredCoverage&sort=coverage',
  );
  await expect(page).not.toHaveURL(/required=|requiredCoverage|coverage/);
  await expect(page).toHaveURL(/organizationId=org-photo/);
  await expect(page.getByRole('heading', { name: '인증 현황', exact: true })).toBeVisible();
  await expect(page.getByText('필수 자격 충족률', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('필수 여부', { exact: true })).toHaveCount(0);
  await expect(page.locator('.dashboard-metrics')).toContainText('유효 자격 보유 인원');
  await page.goto(
    '/admin/dashboard?lv1OrganizationId=org-photo&organizationId=org-photo&qualificationType=auditee&metric=overdueAssessments&sort=targetOn',
  );
  await expect(page).not.toHaveURL(/overdueAssessments|targetOn/);
  await expect(page).toHaveURL(/organizationId=org-photo/);
  await expect(page).toHaveURL(/sort=endOn/);
  await expect(page.getByText('평가 예정일 경과', { exact: true })).toHaveCount(0);
  expect(backend.store.snapshot()).toEqual(before);
});

test('선택 상태로 전환된 이전 대상에는 필수 표시·강제가 없고 제외 후 최소1개 계획 조건을 유지한다', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      s.planningRequests.push({
        qualificationType: 'auditee',
        id: 'converted-request',
        lv1OrganizationId: 'org-photo',
        learnerId: 'learner-2',
        requestedBy: 'admin-1',
        organizationId: 'org-photo',
        dueOn: '2030-12-31',
        message: '선택 항목으로 전환한 요청',
        createdAt: new Date().toISOString(),
        revision: 2,
        mode: 'learner_choice',
        selections: [
          { entityId: q.entityId, qualificationId: q.id, title: q.title, version: q.version! },
        ],
      });
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.goto('/plans?request=converted-request');
  await expect(page.getByText('[필수]', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: '요청에서 제외', exact: true }).click();
  await answerConfirmation(page, true);
  await expect
    .poll(
      () =>
        backend.store.snapshot().planningRequests.find((r) => r.id === 'converted-request')!
          .selections.length,
    )
    .toBe(0);
  await expect(page.getByRole('button', { name: '계획 수립 완료', exact: true })).toBeDisabled();
  await page.getByLabel('취득할 자격', { exact: true }).selectOption('demo-qualification');
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await expect(page).toHaveURL(/\/plans\/[^/?]+/);
  expect(
    backend.store.snapshot().planningRequests.find((r) => r.id === 'converted-request')!.selections,
  ).toHaveLength(1);
});
