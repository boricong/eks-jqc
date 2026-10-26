import { test, expect, actor, answerConfirmation } from './fixtures';
import { randomUUID } from 'node:crypto';
async function setup(backend: any) {
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    'needs-fixture',
    () => {},
    (s: any) => {
      s.organizationQualificationRequirements = [
        {
          organizationId: 'org-photo',
          entityIds: ['demo-qualification'],
          revision: 1,
          updatedAt: new Date().toISOString(),
          updatedBy: 'admin-1',
        },
      ];
      return {};
    },
  );
}
test('조직 직접 지정·상속과 미저장 보호·네 화면 폭', async ({ page, backend }, info) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/organization-settings');
  const title = backend.store
    .snapshot()
    .qualifications.find((q) => q.id === 'demo-qualification')!.title;
  const box = page.getByRole('checkbox', { name: `${title} · v1`, exact: true });
  await box.check();
  await page.getByRole('link', { name: '팀 자격 설정', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(box).toBeChecked();
  await page.getByRole('button', { name: '필요자격 변경 확인', exact: true }).click();
  await expect(page.getByText(/이미 발송한 요청과 기존 학습 기록/)).toBeVisible();
  await page.getByRole('button', { name: '필요자격 저장', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '최종 적용 목록 · 저장된 기준 1개', exact: true }),
  ).toBeVisible();
  expect(backend.store.snapshot().organizationQualificationRequirements[0]!.entityIds).toEqual([
    'demo-qualification',
  ]);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`needs-${width}.png`), fullPage: true });
  }
});
test('팀 자격에서 필요 조직을 지정하고 소속별 전체 계획 요청·교체 종료를 확인한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification');
  await page.getByRole('button', { name: '필요 조직 설정', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').first().check();
  await dialog.getByRole('button', { name: '필요자격 변경 확인', exact: true }).click();
  await dialog.getByRole('button', { name: '필요자격 저장', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: '필요자격 변경 확인', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  const name = backend.store.snapshot().users.find((u) => u.id === 'learner-2')!.name;
  await page.getByRole('dialog').getByRole('checkbox', { name, exact: true }).check();
  await page.getByRole('button', { name: '요청 대상 확인', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '조직별 필요자격 확인', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const old = backend.store.snapshot().planningRequests.at(-1)!;
  expect(old.mode).toBe('organization_required');
  await actor(page, 'learner-2');
  await page.goto(`/plans?request=${old.id}`);
  await expect(page.getByText(/임의 제외·목록 밖 추가/)).toBeVisible();
  await expect(page.getByRole('button', { name: '요청에서 제외', exact: true })).toHaveCount(0);
  await page.getByLabel('취득할 자격', { exact: true }).selectOption('demo-qualification');
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await expect(page).toHaveURL(/\/plans\/[^/?]+/);
  const plan = backend.store.snapshot().plans.find((p) => p.requestId === old.id)!;
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name, exact: true }).check();
  await page.getByRole('button', { name: '요청 대상 확인', exact: true }).click();
  await page.getByRole('checkbox', { name: /이전 요청 교체 종료/ }).check();
  await page.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    backend.store.snapshot().planningRequests.find((r) => r.id === old.id)!.closed,
  ).toBeTruthy();
  await actor(page, 'learner-2');
  await page.goto(`/plans/${plan.id}`);
  await expect(page.getByRole('button', { name: '계획 완료', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('종료일', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '계획 내용', exact: true })).toBeVisible();
});
test('필요자격 미지정·저장 충돌·발송 응답 유실을 안내하고 입력·단일 요청을 유지한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  await expect(page.getByRole('button', { name: '계획 수립 요청', exact: true })).toBeDisabled();
  await setup(backend);
  await page.reload();
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('checkbox', {
      name: backend.store.snapshot().users.find((u) => u.id === 'learner-2')!.name,
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: '요청 대상 확인', exact: true }).click();
  let count = 0;
  await page.route('**/api/planning-requests?*', async (route) => {
    if (route.request().method() === 'POST' && ++count === 1) {
      expect((await route.fetch()).ok()).toBe(true);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"발송 응답 유실"}',
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('발송 응답 유실');
  await page.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    backend.store.snapshot().planningRequests.filter((r) => r.mode === 'organization_required'),
  ).toHaveLength(1);
});

test('세부 관리자는 상속 출처를 읽고 자기 조직의 직접 지정만 해제하며 시스템 운영자는 선택 팀에 저장한다', async ({
  page,
  backend,
}) => {
  await setup(backend);
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    'sub-admin',
    () => {},
    (s) => {
      const u = s.users.find((u) => u.id === 'learner-2')!;
      u.organizationId = 'org-photo-fmg';
      u.organizationAdministration = {
        organizationId: u.organizationId,
        grantedBy: 'admin-1',
        grantedAt: new Date().toISOString(),
      };
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.goto('/admin/organization-settings');
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.getByText(/해당 상위 조직에서만 해제/)).toBeVisible();
  const title = backend.store
      .snapshot()
      .qualifications.find((q) => q.id === 'demo-qualification')!.title,
    box = page.getByRole('checkbox', { name: `${title} · v1`, exact: true });
  await box.check();
  await page.getByRole('button', { name: '필요자격 변경 확인', exact: true }).click();
  await page.getByRole('button', { name: '필요자격 저장', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '최종 적용 목록 · 저장된 기준 1개', exact: true }),
  ).toBeVisible();
  await expect(box).toBeChecked();
  await box.uncheck();
  await page.getByRole('button', { name: '필요자격 변경 확인', exact: true }).click();
  await page.getByRole('button', { name: '필요자격 저장', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '필요자격 변경 확인', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('heading', { name: '최종 적용 목록 · 저장된 기준 1개', exact: true }),
  ).toBeVisible();
  await actor(page, 'operator-1');
  await page.goto('/admin/organization-settings?lv1OrganizationId=org-photo');
  await page.getByRole('checkbox', { name: `${title} · v1`, exact: true }).uncheck();
  await page.getByRole('button', { name: '필요자격 변경 확인', exact: true }).click();
  await page.getByRole('button', { name: '필요자격 저장', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '최종 적용 목록 · 저장된 기준 0개', exact: true }),
  ).toBeVisible();
  expect(
    backend.store
      .snapshot()
      .organizationQualificationRequirements.every((r) => !r.entityIds.length),
  ).toBe(true);
});

test('필요자격 검토 충돌은 입력을 유지하고 최신 기준으로 재검토한다', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/organization-settings');
  const title = backend.store
      .snapshot()
      .qualifications.find((q) => q.id === 'demo-qualification')!.title,
    box = page.getByRole('checkbox', { name: `${title} · v1`, exact: true });
  await box.check();
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    'unrelated-change',
    () => {},
    () => ({}),
  );
  await page.getByRole('button', { name: '필요자격 변경 확인', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('변경');
  await expect(box).toBeChecked();
  await page.getByRole('button', { name: '입력 유지하고 기준 갱신', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(box).toBeChecked();
  await page.getByRole('button', { name: '필요자격 변경 확인', exact: true }).click();
  await page.getByRole('button', { name: '필요자격 저장', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '최종 적용 목록 · 저장된 기준 1개', exact: true }),
  ).toBeVisible();
});
