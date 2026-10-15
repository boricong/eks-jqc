import { test, expect, actor } from './fixtures';

for (const failure of ['response', 'refresh'] as const) {
  test(`제출 저장 후 ${failure === 'response' ? '응답 유실' : '화면 갱신 실패'} 재시도`, async ({
    page,
    backend,
  }) => {
    await page.goto('/');
    await actor(page, 'learner-1');
    await page.getByRole('link', { name: '이어서 진행' }).click();
    await page.getByRole('button', { name: /02 기록 작성/ }).click();
    await page.getByRole('link', { name: '응시하기', exact: true }).click();
    await page.getByLabel('대상 이름과 확인한 값', { exact: true }).check();
    await page.getByLabel('항목의 누락 여부', { exact: true }).check();
    await page.getByRole('button', { name: '답안 확인', exact: true }).click();
    let requests = 0;
    const keys: string[] = [];
    await page.route('**/api/attempts/*/submit', async (route) => {
      requests++;
      keys.push(route.request().headers()['idempotency-key']!);
      if (failure === 'response' && requests === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"제출 응답 유실 시험"}',
        });
      } else await route.continue();
    });
    if (failure === 'refresh')
      await page.route('**/api/workspace', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"목록 갱신 실패 시험"}',
        }),
      );
    await page.getByRole('button', { name: '제출', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      failure === 'response' ? '제출 응답 유실 시험' : '목록 갱신 실패 시험',
    );
    expect(
      backend.store
        .snapshot()
        .attempts.filter(
          (t) =>
            t.courseId === 'demo-course-2' && t.kind === 'objective' && t.status === 'submitted',
        ),
    ).toHaveLength(1);
    if (failure === 'refresh') await page.unroute('**/api/workspace');
    await page.getByRole('button', { name: '제출', exact: true }).click();
    await expect(page.getByRole('heading', { name: '평가를 통과했습니다.' })).toBeVisible();
    expect(requests).toBe(failure === 'response' ? 2 : 1);
    expect(new Set(keys).size).toBe(1);
  });
}

test('자동 저장·실패 재시도·재시작 후 응시 복원', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.getByRole('link', { name: '이어서 진행' }).click();
  await page.getByRole('button', { name: /02 기록 작성/ }).click();
  await page.getByRole('link', { name: '응시하기', exact: true }).click();
  await expect(page.getByRole('button', { name: '답안 확인', exact: true })).toBeEnabled();
  await page.getByLabel('대상 이름과 확인한 값', { exact: true }).check();
  await expect(page.locator('.save-status')).toHaveText('저장됨');
  await page.reload();
  await expect(page.getByLabel('대상 이름과 확인한 값', { exact: true })).toBeChecked();
  await page.route('**/api/attempts/*/draft', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: '저장 실패 시험' }),
    }),
  );
  await page.getByLabel('항목의 누락 여부', { exact: true }).check();
  await expect(page.locator('.save-error')).toContainText('저장 실패 시험');
  await expect(page.getByLabel('항목의 누락 여부', { exact: true })).toBeChecked();
  await page.unroute('**/api/attempts/*/draft');
  await page.getByRole('button', { name: '저장 재시도' }).click();
  await expect(page.locator('.save-status')).toHaveText('저장됨');
  await backend.restart();
  await page.reload();
  await expect(page.getByRole('heading', { name: '접속 계정 선택' })).toBeVisible();
  await actor(page, 'learner-1');
  await page.getByRole('link', { name: '이어서 진행' }).click();
  await page.getByRole('button', { name: /02 기록 작성/ }).click();
  await page.getByRole('link', { name: '이어서 응시', exact: true }).click();
  await expect(page.getByLabel('대상 이름과 확인한 값', { exact: true })).toBeChecked();
  await expect(page.getByLabel('항목의 누락 여부', { exact: true })).toBeChecked();
});

test('다른 창의 답안 수정과 충돌 복구', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.getByRole('link', { name: '이어서 진행' }).click();
  await page.getByRole('button', { name: /02 기록 작성/ }).click();
  await page.getByRole('link', { name: '응시하기', exact: true }).click();
  await expect(page.getByRole('button', { name: '답안 확인', exact: true })).toBeEnabled();
  const view = await (await page.request.get('/api/workspace')).json(),
    attempt = view.assignments[0].enrollments[1].activeAttempts.objective;
  const response = await page.request.put(`/api/attempts/${attempt.id}/draft`, {
    headers: { 'Idempotency-Key': 'other-tab-save' },
    data: { revision: attempt.revision, answers: { 'd2-q1': 1 }, verdicts: {} },
  });
  expect(response.ok()).toBeTruthy();
  await page.getByLabel('대상 이름과 확인한 값', { exact: true }).check();
  await expect(page.locator('.save-error')).toContainText('다른 창에서 변경');
  await expect(page.getByRole('button', { name: '답안 확인', exact: true })).toBeDisabled();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '다시 불러오기' }).click();
  await expect(page.getByLabel('파일 색상', { exact: true })).toBeChecked();
});

test('FT 변경 후 이전 초안 보존과 새 FT 빈 입력', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.getByRole('link', { name: '이어서 진행' }).click();
  await page.getByRole('link', { name: '다시 요청' }).click();
  await page.getByRole('button', { name: '다시 요청', exact: true }).click();
  await expect(page.getByText('박준호 FT 평가 대기')).toBeVisible();
  await actor(page, 'ft-1');
  await page.getByRole('link', { name: 'FT 평가', exact: true }).click();
  await page.getByRole('link', { name: '평가하기' }).click();
  const item = page.locator('.ft-item').first();
  await item.getByLabel('통과', { exact: true }).check();
  await item.getByLabel('판정 근거').fill('이전 FT가 관찰한 초안');
  await expect(page.locator('.save-status')).toHaveText('저장됨');
  await actor(page, 'admin-1');
  await page.getByRole('link', { name: '관리', exact: true }).click();
  await page.getByRole('link', { name: '자격 배정', exact: true }).click();
  await page.locator('tbody tr summary').click();
  await page.getByRole('button', { name: 'FT 변경' }).click();
  await page.getByRole('dialog').getByLabel('담당 FT').selectOption('ft-2');
  await page.getByLabel('변경 사유').fill('교대 근무');
  await page.getByRole('button', { name: '변경', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await actor(page, 'ft-2');
  await page.getByRole('link', { name: 'FT 평가', exact: true }).click();
  await page.getByRole('link', { name: '평가하기' }).click();
  await expect(page.locator('.ft-item').first().getByLabel('판정 근거')).toHaveValue('');
  await expect(
    page.locator('.ft-item').first().getByLabel('통과', { exact: true }),
  ).not.toBeChecked();
  expect(
    JSON.stringify(
      backend.store.snapshot().audits.find((a) => a.action === 'assignment.ft')?.details,
    ),
  ).toContain('이전 FT가 관찰한 초안');
});

test('과정별 실제 수행 비교·확정·정정 원본 보존', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.getByRole('link', { name: '관리', exact: true }).click();
  await page.getByRole('link', { name: '기준 검증', exact: true }).click();
  await page.getByRole('button', { name: '비교 기록 추가' }).click();
  await page.getByLabel('객관식 회차').selectOption('attempt-1');
  await page.getByLabel('실기 회차').selectOption('attempt-2');
  await page.getByLabel('관찰일', { exact: true }).fill('2026-10-16');
  await page.getByLabel('관찰자', { exact: true }).fill('현장 관찰자');
  await page.getByLabel('수행 작업', { exact: true }).fill('별도의 직무 수행 과제');
  await page.getByLabel('실제 수행 판정 기준', { exact: true }).fill('최소 항목 독립 수행');
  await page
    .getByLabel('근거 요약', { exact: true })
    .fill('평가와 별도로 작업을 수행하는 모습을 관찰함');
  await page.getByLabel('근거 구분').selectOption('independent');
  await page.getByLabel('실제 수행 판정', { exact: true }).selectOption('met');
  await page.getByRole('button', { name: '비교 확정' }).click();
  await expect(page.locator('.comparison-panel .status-badge')).toHaveText('실제 수행만 충족');
  await page.reload();
  await expect(page.getByLabel('관찰자', { exact: true })).toHaveValue('현장 관찰자');
  await expect(page.getByLabel('관찰자', { exact: true })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('comparison-1920x900.png') });
  await page.getByRole('button', { name: '정정 기록 만들기' }).click();
  await page.getByLabel('정정 사유').fill('근거 출처 확인');
  await page.getByRole('button', { name: '정정 초안 생성' }).click();
  await page.getByLabel('근거 구분').selectOption('same_assessment');
  await page.getByRole('button', { name: '비교 확정' }).click();
  await expect(page.locator('.comparison-panel .status-badge')).toHaveText('비교 보류');
  const records = backend.store.snapshot().comparisons;
  expect(records).toHaveLength(2);
  expect(records[0]!.outcome).toBe('performance_only');
  expect(records[1]!.supersedesId).toBe(records[0]!.id);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('개발 서버에서 서버 초기 데이터와 런타임 파일 노출 차단', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  const root = process.cwd().replace(/\/frontend$/, '');
  for (const file of [
    `${root}/server/src/seed-source.json`,
    backend.store.file,
    `${root}/.git/config`,
  ]) {
    const response = await page.request.get(`/@fs${file}`);
    expect(response.status()).toBe(403);
  }
  const view = await (await page.request.get('/api/workspace')).json();
  expect(
    view.courses.every((c: any) => c.questions.every((q: any) => q.correct === undefined)),
  ).toBeTruthy();
});
