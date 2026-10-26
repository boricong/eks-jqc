import { test, expect, actor, answerConfirmation } from './fixtures';
import { completePlan } from './workflow-helpers';
async function send(page: any) {
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: '정하린', exact: true }).check();
  await dialog.getByRole('button', { name: '대상자에게 요청' }).click();
  await expect(dialog).not.toBeVisible();
}
test('필수 0개 요청에서 Backup 자격 직접 시작·전체 완료와 네 화면 폭', async ({
  page,
  backend,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await actor(page, 'admin-1');
  await send(page);
  expect(backend.store.snapshot().planningRequests[0]!.targets).toEqual([]);
  await actor(page, 'learner-2');
  await page.goto('/plans');
  const region = page.getByRole('region', { name: '이번 요청의 계획 현황' });
  await expect(region).toContainText('이번 요청 · 미착수');
  await expect(
    page.getByLabel('취득할 자격').locator('option[value="demo-qualification"]'),
  ).toHaveCount(1);
  await expect(region.getByRole('button', { name: '계획 수립 완료', exact: true })).toBeDisabled();
  await page.reload();
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      s.qualificationTemplates.find((t) => t.id === q.templateId)!.title = '설비 Backup 검증 자격';
      return {};
    },
  );
  await page.reload();
  const select = page.getByLabel('취득할 자격');
  await expect(page.getByRole('region', { name: '내 소속 필수 자격' })).toHaveCount(0);
  await expect(select.locator('option')).toContainText(['자격 선택', '설비 Backup 검증 자격 · v1']);
  await expect(page.getByText('추가로 선택할 팀 자격', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '선택 저장', exact: true })).toHaveCount(0);
  const before = backend.store.snapshot();
  await select.selectOption('demo-qualification');
  await select.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '계획 시작', exact: true })).toBeFocused();
  await expect(select).toHaveValue('demo-qualification');
  expect(backend.store.snapshot()).toEqual(before);
  let starts = 0,
    selections = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/plans')) starts++;
    if (r.url().endsWith('/selection')) selections++;
  });
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await expect(region.getByRole('heading').first()).toHaveCSS('font-size', '18px');
    await expect(select).toHaveCSS('font-size', width <= 768 ? '16px' : '14px');
    if (width === 390)
      expect(
        (await page.getByRole('button', { name: '계획 시작', exact: true }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
    if (width === 390 && (await page.locator('.toast').count()))
      expect((await page.locator('.toast').boundingBox())!.height).toBeLessThan(100);
    await page.screenshot({
      path: test.info().outputPath(`planning-choice-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  await completePlan(page, '설비 Backup 검증 자격', false);
  expect(starts).toBe(1);
  expect(selections).toBe(0);
  expect(backend.store.snapshot().planningRequests[0]!.selections).toHaveLength(1);
  await page.goto('/plans');
  await expect(region).toContainText('계획 확정');
  await expect(
    page.getByLabel('취득할 자격').locator('option[value="demo-qualification"]'),
  ).toHaveCount(0);
  await region.getByRole('button', { name: '계획 수립 완료', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(region.getByRole('button', { name: '계획 수립 완료', exact: true })).toBeFocused();
  await region.getByRole('button', { name: '계획 수립 완료', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(
    region.getByRole('heading', { name: '이번 요청 · 계획 완료', exact: true }),
  ).toBeVisible();
  expect(backend.store.snapshot().planningRequests[0]!.completion?.evidence).toHaveLength(1);
  await backend.restart();
  await page.reload();
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await expect(region).toContainText('계획 완료');
  expect(errors).toEqual([]);
});
test('세부 관리자 선택 사항·검색·빈 저장·다른 조직 노출 제한과 네 화면 폭', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'learner-2')!.organizationAdministration = {
        organizationId: 'org-photo',
        grantedBy: 'admin-1',
        grantedAt: new Date().toISOString(),
      };
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.goto('/admin/policies');
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.getByText('필수 자격 · 선택 사항', { exact: true })).toBeVisible();
  await expect(page.getByLabel('필수 자격 선정을 완료합니다')).toHaveCount(0);
  await page.getByLabel('자격 검색', { exact: true }).fill('없는 자격');
  await expect(page.getByText('검색 결과가 없습니다.', { exact: true })).toBeVisible();
  await page.getByLabel('자격 검색', { exact: true }).fill('평가');
  const check = page.getByRole('checkbox', { name: /평가 흐름 체험 · v1/ });
  await check.focus();
  await page.keyboard.press('Space');
  await expect(check).toBeChecked();
  await page.getByRole('button', { name: '조직 설정 변경 확인' }).click();
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: test.info().outputPath(`optional-policy-${width}.png`),
      fullPage: true,
    });
  }
  await check.uncheck();
  await page.getByRole('button', { name: '조직 설정 변경 확인' }).click();
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(backend.store.organizations.snapshot().roots[0]!.requiredQualifications).toEqual([]);
});
test('계획 시작 저장 실패·revision 충돌은 선택 유지, 재시도·조회로 복구', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await send(page);
  await actor(page, 'learner-2');
  await page.goto('/plans');
  const select = page.getByLabel('취득할 자격');
  await select.selectOption('demo-qualification');
  await page.route('**/api/plans', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: '저장 실패 시험' }),
    }),
  );
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('저장 실패 시험');
  await expect(select).toHaveValue('demo-qualification');
  expect(backend.store.snapshot().plans).toHaveLength(0);
  expect(backend.store.snapshot().planningRequests[0]!.selections).toHaveLength(0);
  await page.unroute('**/api/plans');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      s.planningRequests[0]!.revision++;
      return {};
    },
  );
  await page.getByRole('button', { name: '계획 시작 재시도', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('다른 창');
  await expect(select).toHaveValue('demo-qualification');
  await expect(page.getByRole('button', { name: '계획 시작', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await expect(page.getByRole('button', { name: '계획 시작', exact: true })).toBeEnabled();
  await expect(select).toHaveValue('demo-qualification');
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await expect(page.getByRole('heading', { name: '개인 인증 계획', exact: true })).toBeVisible();
});
test('저장 응답 유실 후 조회가 바뀌어도 최초 revision·키로 재시도하며 초안을 중복 생성하지 않는다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await send(page);
  await send(page);
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await page.getByLabel('취득할 자격').selectOption('demo-qualification');
  const bodies: unknown[] = [],
    keys: string[] = [];
  let lose = true;
  await page.route('**/api/plans', async (route) => {
    bodies.push(route.request().postDataJSON());
    keys.push(route.request().headers()['idempotency-key']!);
    if (lose) {
      lose = false;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('서버에 연결');
  expect(backend.store.snapshot().plans).toHaveLength(1);
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '계획 시작 재시도', exact: true }).click();
  await expect(page.getByRole('heading', { name: '개인 인증 계획', exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(keys[0]).toBe(keys[1]);
  expect(backend.store.snapshot().plans).toHaveLength(1);
});
test('선택만 남은 항목은 계획 미작성으로 제외할 수 있고 비필수 초안 삭제는 요청에서도 제외한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await send(page);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      s.planningRequests[0]!.selections = [
        { entityId: q.entityId, qualificationId: q.id, title: q.title, version: q.version! },
      ];
      return {};
    },
  );
  await actor(page, 'learner-2');
  await page.goto('/plans');
  const region = page.getByRole('region', { name: '이번 요청의 계획 현황' });
  await expect(region).toContainText('계획 미작성');
  await region.getByRole('button', { name: '요청에서 제외', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(region.getByRole('button', { name: '요청에서 제외', exact: true })).toHaveCount(0);
  await page.getByLabel('취득할 자격').selectOption('demo-qualification');
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await expect(page.getByRole('heading', { name: '개인 인증 계획', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '내 계획으로', exact: true }).click();
  await expect(region).toContainText('작성 중');
  await page.getByRole('button', { name: '평가 흐름 체험 계획 삭제', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '계획 삭제', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(region).toContainText('아직 시작한 계획이 없습니다.');
  expect(backend.store.snapshot().planningRequests[0]!.selections).toHaveLength(0);
  await expect(region.getByRole('button', { name: '계획 수립 완료', exact: true })).toBeDisabled();
});

test('시작 중 요청·계정 전환을 막고 저장 후 재조회 실패를 추가 POST 없이 복구한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await send(page);
  await send(page);
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await page.getByLabel('취득할 자격').selectOption('demo-qualification');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0,
    failRefresh = false;
  await page.route('**/api/plans', async (route) => {
    posts++;
    await held;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    failRefresh = true;
    await route.fulfill({ response });
  });
  await page.route('**/api/workspace**', async (route) => {
    if (failRefresh)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '재조회 실패 시험' }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await expect(page.getByLabel('접속 계정')).toBeDisabled();
  await expect(page.getByLabel('계획 수립 요청')).toBeDisabled();
  await expect(page.getByLabel('취득할 자격')).toBeDisabled();
  release();
  await expect(page.getByRole('alert')).toContainText('재조회 실패 시험');
  expect(backend.store.snapshot().plans).toHaveLength(1);
  failRefresh = false;
  await page.getByRole('button', { name: '계획 시작 재시도', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '개인 인증 계획', exact: true })).toBeVisible();
  expect(posts).toBe(1);
  expect(backend.store.snapshot().plans).toHaveLength(1);
});

test('상단 영역 없이 드롭다운의 요청 당시 필수를 유지하며 요청 전환·반응형·키보드를 지원한다', async ({
  page,
  backend,
}, info) => {
  const required = async (ids: string[]) =>
    backend.store.organizations.transact(
      'admin-1',
      crypto.randomUUID(),
      crypto.randomUUID(),
      () => {},
      (doc) => {
        doc.roots[0]!.requiredQualifications = ids;
        return {};
      },
    );
  await required(['demo-qualification']);
  await page.goto('/');
  await actor(page, 'admin-1');
  await send(page);
  const first = backend.store.snapshot().planningRequests[0]!.id;
  await required([]);
  await send(page);
  const second = backend.store.snapshot().planningRequests[1]!.id;
  await actor(page, 'learner-2');
  await page.goto(`/plans?request=${first}`);
  const select = page.getByLabel('취득할 자격'),
    option = select.locator('option[value="demo-qualification"]');
  await expect(option).toHaveText('[필수] 평가 흐름 체험 · v1');
  const before = backend.store.snapshot();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('region', { name: '내 소속 필수 자격' })).toHaveCount(0);
    await expect(page.locator('main h1, main h2').first()).toHaveText('내 계획');
    await expect(page.getByRole('heading', { name: '내 계획', exact: true })).toHaveCSS(
      'font-size',
      '24px',
    );
    await expect(select).toHaveCSS('font-size', width <= 768 ? '16px' : '14px');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    expect((await select.boundingBox())!.y).toBeLessThan(900);
    await select.selectOption('demo-qualification');
    await select.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '계획 시작', exact: true })).toBeFocused();
    if (width === 390)
      expect(
        (await page.getByRole('button', { name: '계획 시작', exact: true }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath(`plans-required-${width}.png`), fullPage: true });
  }
  await page.getByLabel('계획 수립 요청').selectOption(second);
  await expect(option).toHaveText('평가 흐름 체험 · v1');
  await expect(select).toHaveValue('');
  await required(['demo-qualification']);
  await page.reload();
  await expect(option).toHaveText('평가 흐름 체험 · v1');
  await page.getByLabel('계획 수립 요청').selectOption(first);
  await expect(option).toHaveText('[필수] 평가 흐름 체험 · v1');
  expect(backend.store.snapshot()).toEqual(before);
});
