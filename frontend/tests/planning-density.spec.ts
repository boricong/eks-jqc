import { test, expect, actor, answerConfirmation } from './fixtures';
import type { JsonStore } from '../../server/src/storage';
import type { Page } from '@playwright/test';

const longOrganization = '길이가 긴 조직의 공정 조건 및 설비 운영 담당 부서 '.repeat(3).trim();
async function people(store: JsonStore) {
  await store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (doc) => {
      const team = doc.roots.find((o) => o.id === 'org-photo')!;
      team.children.push(
        { id: 'density-a', name: '밀도 A조', active: true, children: [] },
        { id: 'density-b', name: longOrganization, active: true, children: [] },
        { id: 'density-inactive', name: '중지 조직', active: false, children: [] },
      );
      return {};
    },
  );
  await store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      for (let i = 1; i <= 30; i++)
        s.users.push({
          id: `density-${i}`,
          name: `밀도 ${String(i).padStart(2, '0')}`,
          roles: ['learner'],
          revision: 1,
          organizationId: 'density-a',
        });
      s.users.push(
        {
          id: 'density-long',
          name: '긴이름'.repeat(20),
          roles: ['learner'],
          revision: 1,
          organizationId: 'density-b',
        },
        {
          id: 'density-twin-a',
          name: '동명이인',
          roles: ['learner'],
          revision: 1,
          organizationId: 'density-a',
        },
        {
          id: 'density-twin-b',
          name: '동명이인',
          roles: ['learner'],
          revision: 1,
          organizationId: 'density-b',
        },
        {
          id: 'density-hold',
          name: '취득 보류',
          roles: ['learner'],
          revision: 1,
          organizationId: 'density-a',
          certificationEligibility: 'hold',
        },
        {
          id: 'density-inactive',
          name: '소속 중지 인원',
          roles: ['learner'],
          revision: 1,
          organizationId: 'density-inactive',
        },
      );
      for (const [id, createdAt, dueOn, complete] of [
        ['request-new-a', '2026-10-24T00:00:00.000Z', '2031-01-01', true],
        ['request-old', '2026-01-01T00:00:00.000Z', '2020-01-01', false],
        ['request-new-z', '2026-10-24T00:00:00.000Z', '2032-01-01', false],
      ] as const)
        s.planningRequests.push({
          qualificationType: 'auditee',
          id,
          createdAt,
          dueOn,
          learnerId: 'learner-1',
          requestedBy: 'admin-1',
          lv1OrganizationId: 'org-photo',
          organizationId: 'org-photo',
          revision: 1,
          mode: 'learner_choice',
          targets: [],
          selections: [],
          source: 'migration',
          message: `${id} 보존된 안내`,
          ...(complete
            ? {
                completion: {
                  date: '2026-10-24T01:00:00.000Z',
                  reason: 'no_additional' as const,
                  evidence: [{ entityId: 'demo-qualification', assignmentId: 'assignment-1' }],
                },
              }
            : {}),
        });
      return {};
    },
  );
}
async function enter(page: Page) {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin');
  await page.getByRole('link', { name: '계획 요청·진행', exact: true }).click();
  await expect(page.getByRole('table', { name: '계획 요청 대상자 현황' })).toBeVisible();
}
async function requestDialog(page: Page) {
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  return page.getByRole('dialog', { name: 'Auditee 계획 수립 요청', exact: true });
}

test('대상자 한 줄과 모달 밀도·최신 요청·긴 이름·네 화면 폭·상세 초점 복귀', async ({
  page,
  backend,
}) => {
  test.setTimeout(60000);
  await people(backend.store);
  await enter(page);
  const before = backend.store.snapshot();
  const teamName = backend.store.organizations
    .snapshot()
    .roots.find((o) => o.id === 'org-photo')!.name;
  const table = page.getByRole('table', { name: '계획 요청 대상자 현황' });
  await expect(table.locator('thead th')).toHaveText([
    '이름',
    '소속',
    '요청 가능',
    '최근 요청 상태',
    '최근 요청 기한',
    '상세',
  ]);
  await expect(table.locator('details')).toHaveCount(0);
  const row = table.getByRole('row').filter({ hasText: '김민서' });
  await expect(row).toContainText('추가 계획 대상 없음');
  await expect(row).toContainText('미완료 2건');
  await expect(row).toContainText('기한 경과');
  await expect(row).toContainText('2031-01-01');
  await expect(row).not.toContainText('2032-01-01');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const sizes = await table.locator('tbody tr').evaluateAll((rows) =>
      rows.map((row) => ({
        height: row.getBoundingClientRect().height,
        font: getComputedStyle(row.querySelector('td')!).fontSize,
      })),
    );
    expect(sizes.every((s) => s.font === '14px')).toBe(true);
    expect(sizes.every((s) => (width > 768 ? s.height === 40 : s.height >= 44))).toBe(true);
    if (width === 1920) {
      expect(
        await table.locator('tbody tr').evaluateAll(
          (rows) =>
            rows.filter((row) => {
              const b = row.getBoundingClientRect();
              return b.top >= 0 && b.bottom <= innerHeight;
            }).length,
        ),
        // 유형 선택 44px와 구분 여백이 추가되어도 기존 40px 행 밀도는 유지한다.
      ).toBeGreaterThanOrEqual(13);
    }
    await page.screenshot({ path: test.info().outputPath(`request-table-${width}.png`) });
    const dialog = await requestDialog(page);
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(960);
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(dialog.getByText('신규 가능', { exact: false })).toHaveCount(0);
    await expect(dialog.getByRole('checkbox', { name: '취득 보류', exact: true })).toBeDisabled();
    await expect(
      dialog.getByRole('checkbox', { name: '소속 중지 인원', exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole('checkbox', { name: '동명이인', exact: true }).first(),
    ).toHaveAccessibleDescription(`${teamName} › 밀도 A조 · 계획 요청 가능`);
    await expect(
      dialog.getByRole('checkbox', { name: '동명이인', exact: true }).last(),
    ).toHaveAccessibleDescription(`${teamName} › ${longOrganization} · 계획 요청 가능`);
    if (width === 1920) {
      expect(
        await dialog.locator('.planning-target-option').evaluateAll((rows) => {
          const box = rows[0]!.parentElement!.getBoundingClientRect();
          return rows.filter((r) => {
            const b = r.getBoundingClientRect();
            return b.top >= box.top && b.bottom <= Math.min(box.bottom, innerHeight);
          }).length;
        }),
      ).toBeGreaterThanOrEqual(12);
    }
    if (width <= 768) {
      expect(
        await dialog
          .locator('.planning-target-option')
          .first()
          .evaluate((e) => e.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(44);
      expect(
        (await dialog.getByRole('button', { name: '대상자에게 요청' }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: test.info().outputPath(`request-dialog-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: '계획 수립 요청', exact: true })).toBeFocused();
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByLabel('요청 현황 필터').selectOption('late');
  const detailButton = row.getByRole('button', { name: /계획 요청 상세$/ });
  await detailButton.focus();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('dialog', { name: '김민서 · 계획 요청 상세', exact: true });
  await expect(detail).toContainText('요청 이력 3건');
  await expect(detail).toContainText('request-old 보존된 안내');
  await expect(detail).toContainText('당시 원본에 없는 요청 범위를 추정하지 않았습니다.');
  await expect(detail).toContainText('개인 계획 0건');
  await page.keyboard.press('Escape');
  await expect(detailButton).toBeFocused();
  await expect(page.getByLabel('요청 현황 필터')).toHaveValue('late');
  expect(backend.store.snapshot()).toEqual(before);
});

test('검색 밖 선택 유지·빈 결과·이동 취소·전송 실패 재시도와 중복 클릭 방지', async ({
  page,
  backend,
}) => {
  await people(backend.store);
  await enter(page);
  const dialog = await requestDialog(page);
  const search = dialog.getByLabel('이름·조직 검색');
  await search.fill('밀도 01');
  await dialog.getByRole('checkbox', { name: '밀도 01', exact: true }).check();
  await search.fill('밀도 02');
  await dialog.getByRole('checkbox', { name: '밀도 02', exact: true }).check();
  await search.fill('없는 사람');
  await expect(dialog.getByText('검색 결과가 없습니다.')).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('선택 2명');
  await search.fill('밀도 01');
  await expect(dialog.getByRole('checkbox', { name: '밀도 01', exact: true })).toBeChecked();
  await dialog.getByLabel('계획 작성 기한').fill('2030-12-31');
  await dialog.getByLabel('안내문').fill('검색으로 가려진 인원도 요청합니다.');
  await page.evaluate(() => history.back());
  await answerConfirmation(page, false);
  await expect(dialog).toBeVisible();
  await expect(search).toHaveValue('밀도 01');
  const keys: string[] = [];
  await page.route('**/api/planning-requests?*', async (route) => {
    keys.push(route.request().headers()['idempotency-key']!);
    if (keys.length === 1)
      await route.fulfill({ status: 503, json: { message: '요청 저장 실패 시험' } });
    else await route.continue();
  });
  await dialog.getByRole('button', { name: '대상자에게 요청' }).evaluate((el) => {
    (el as HTMLButtonElement).click();
    (el as HTMLButtonElement).click();
  });
  await expect(dialog.getByRole('alert')).toHaveText('요청 저장 실패 시험');
  expect(keys).toHaveLength(1);
  await expect(dialog.getByRole('status')).toContainText('선택 2명');
  await expect(dialog.getByLabel('계획 작성 기한')).toHaveValue('2030-12-31');
  await expect(dialog.getByLabel('안내문')).toHaveValue('검색으로 가려진 인원도 요청합니다.');
  await dialog.getByRole('button', { name: '대상자에게 요청' }).click();
  await expect(dialog).not.toBeVisible();
  expect(keys).toHaveLength(2);
  expect(new Set(keys).size).toBe(1);
  const requests = backend.store
    .snapshot()
    .planningRequests.filter((r) => r.learnerId.startsWith('density-'));
  expect(requests.map((r) => r.learnerId).sort()).toEqual(['density-1', 'density-2']);
  expect(requests.every((r) => r.targets?.length === 0)).toBe(true);
});

test('조회 권한 회수 시 열린 대상자 상세와 이전 인물 정보 제거', async ({ page, backend }) => {
  await people(backend.store);
  await enter(page);
  await page.getByRole('button', { name: /김민서.*계획 요청 상세$/ }).click();
  await expect(page.getByRole('dialog')).toContainText('request-old 보존된 안내');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'admin-1')!.roles = ['learner'];
      return {};
    },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('request-old 보존된 안내')).toHaveCount(0);
});

test('대시보드의 과거 여유 밀도 무시·페이지 크기 및 URL 조건 보존', async ({ page, backend }) => {
  await people(backend.store);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.evaluate(() =>
    localStorage.setItem(
      'eks-dashboard-list-admin-1-org-photo-members',
      JSON.stringify({ density: 'roomy', pageSize: 50 }),
    ),
  );
  await page.goto('/admin/dashboard?tab=members&search=밀도&sort=name&order=desc');
  await expect(page.getByLabel('페이지 크기')).toHaveValue('50');
  await expect(page.getByLabel('목록 밀도')).toHaveCount(0);
  await expect(page.getByLabel('구성원 검색', { exact: true })).toHaveValue('밀도');
  await expect(page.locator('.dashboard-table tbody tr').first()).toBeVisible();
  await expect(page.locator('.dashboard-table')).toHaveCSS('font-size', '14px');
  expect(
    await page
      .locator('.dashboard-table tbody tr')
      .first()
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBe(40);
  await page.getByLabel('페이지 크기').selectOption('100');
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('eks-dashboard-list-admin-1-org-photo-members')!),
    ),
  ).toEqual({ pageSize: 100 });
  await page.reload();
  await expect(page.getByLabel('페이지 크기')).toHaveValue('100');
  await expect(page.getByLabel('구성원 검색', { exact: true })).toHaveValue('밀도');
  expect(new URL(page.url()).searchParams.get('sort')).toBe('name');
  expect(new URL(page.url()).searchParams.get('order')).toBe('desc');
});

test('시스템 공지와 사용자 표의 한 줄·행 작업 버튼도 촘촘하게 고정', async ({ page, backend }) => {
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      s.notices.push({
        id: 'density-system-notice',
        title: '시스템 안내',
        body: '밀도 확인 안내',
        date: '2026-10-24',
        published: true,
        revision: 1,
        scope: 'system',
      });
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/notices');
  const row = page.getByRole('row').filter({ hasText: '시스템 안내' });
  await expect(row).toBeVisible();
  expect(await row.evaluate((el) => el.getBoundingClientRect().height)).toBe(40);
  await expect(row.getByRole('button', { name: '편집' })).toHaveCSS('font-size', '14px');
  await row.getByRole('button', { name: '편집' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '시스템 공지 편집' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row.getByRole('button', { name: '편집' })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    (await row.getByRole('button', { name: '편집' }).boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/system/users');
  await expect(page.locator('.table-wrap tbody tr').first()).toBeVisible();
  expect(
    await page
      .locator('.table-wrap tbody tr')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBe(40);
  await expect(page.getByLabel('목록 밀도')).toHaveCount(0);
});
