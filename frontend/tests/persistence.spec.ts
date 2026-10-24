import { answerConfirmation } from './fixtures';
import { test, expect, actor } from './fixtures';

for (const failure of ['response', 'refresh'] as const) {
  test(`제출 저장 후 ${failure === 'response' ? '응답 유실' : '화면 갱신 실패'} 재시도`, async ({
    page,
    backend,
  }) => {
    await page.goto('/');
    await actor(page, 'learner-1');
    await page.getByRole('link', { name: '상세정보 보기' }).click();
    await page.getByRole('button', { name: /02 기록 작성/ }).click();
    await page.getByRole('link', { name: '평가로 이동', exact: true }).click();
    await page.getByRole('link', { name: '응시하기', exact: true }).first().click();
    await page.getByLabel('대상 이름과 확인한 값', { exact: true }).check();
    await page.getByRole('tablist', { name: '응시 문항' }).getByRole('tab').nth(1).click();
    await page.getByLabel('항목의 누락 여부', { exact: true }).check();
    await page.getByRole('button', { name: '제출', exact: true }).click();
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
    await page.getByRole('button', { name: '최종 제출', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      failure === 'response' ? '제출 응답 유실 시험' : '목록 갱신 실패 시험',
    );
    expect(
      backend.store
        .snapshot()
        .attempts.filter(
          (t) => t.courseId === 'demo-course-2' && t.kind === 'objective' && t.status === 'graded',
        ),
    ).toHaveLength(1);
    if (failure === 'refresh') await page.unroute('**/api/workspace');
    await page.getByRole('button', { name: '최종 제출', exact: true }).click();
    await expect(page.getByRole('heading', { name: '평가 통과', exact: true })).toBeVisible();
    expect(requests).toBe(failure === 'response' ? 2 : 1);
    expect(new Set(keys).size).toBe(1);
  });
}

test('자동 저장·실패 재시도·재시작 후 응시 복원', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.getByRole('link', { name: '상세정보 보기' }).click();
  await page.getByRole('button', { name: /02 기록 작성/ }).click();
  await page.getByRole('link', { name: '평가로 이동', exact: true }).click();
  await page.getByRole('link', { name: '응시하기', exact: true }).first().click();
  await expect(page.getByRole('button', { name: '제출', exact: true })).toBeEnabled();
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
  await page.getByRole('tablist', { name: '응시 문항' }).getByRole('tab').nth(1).click();
  await page.getByLabel('항목의 누락 여부', { exact: true }).check();
  await expect(page.locator('.save-error')).toContainText('저장 실패 시험');
  await page.getByRole('tablist', { name: '응시 문항' }).getByRole('tab').nth(1).click();
  await expect(page.getByLabel('항목의 누락 여부', { exact: true })).toBeChecked();
  await page.unroute('**/api/attempts/*/draft');
  await page.getByRole('button', { name: '저장 재시도' }).click();
  await expect(page.locator('.save-status')).toHaveText('저장됨');
  await backend.restart();
  await page.reload();
  await expect(page.getByRole('heading', { name: '접속 계정 선택', exact: true })).toBeVisible();
  await actor(page, 'learner-1');
  await page.getByRole('link', { name: '상세정보 보기' }).click();
  await page.getByRole('button', { name: /02 기록 작성/ }).click();
  await page.getByRole('link', { name: '평가로 이동', exact: true }).click();
  await page.getByRole('link', { name: '답안 이어 쓰기', exact: true }).click();
  await expect(page.getByLabel('대상 이름과 확인한 값', { exact: true })).toBeChecked();
  await page.getByRole('tablist', { name: '응시 문항' }).getByRole('tab').nth(1).click();
  await expect(page.getByLabel('항목의 누락 여부', { exact: true })).toBeChecked();
});

test('다른 창의 답안 수정과 충돌 복구', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.getByRole('link', { name: '상세정보 보기' }).click();
  await page.getByRole('button', { name: /02 기록 작성/ }).click();
  await page.getByRole('link', { name: '평가로 이동', exact: true }).click();
  await page.getByRole('link', { name: '응시하기', exact: true }).first().click();
  await expect(page.getByRole('button', { name: '제출', exact: true })).toBeEnabled();
  const tabId = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  const view = await (
      await page.request.get('/api/workspace', { headers: { 'X-Session-Tab': tabId! } })
    ).json(),
    attempt = view.assignments[0].enrollments[1].activeAttempts.objective;
  const response = await page.request.put(`/api/attempts/${attempt.id}/draft`, {
    headers: { 'Idempotency-Key': 'other-tab-save', 'X-Session-Tab': tabId! },
    data: { revision: attempt.revision, answers: { 'd2-q1': 1 } },
  });
  expect(response.ok()).toBeTruthy();
  await page.getByLabel('대상 이름과 확인한 값', { exact: true }).check();
  await expect(page.locator('.save-error')).toContainText('다른 창에서 변경');
  await expect(page.getByRole('button', { name: '제출', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '다시 불러오기' }).click();
  await answerConfirmation(page, true);
  await expect(page.getByLabel('파일 색상', { exact: true })).toBeChecked();
});

test('개발 서버에서 서버 초기 데이터와 런타임 파일 노출 차단', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  const root = process
    .cwd()
    .replaceAll('\\', '/')
    .replace(/\/frontend$/, '');
  for (const file of [
    `${root}/server/src/seed-source.json`,
    `${root}/server/tests/fixtures/seed-source.json`,
    `${root}/server/src/organization-seed.json`,
    backend.store.file,
    backend.store.organizations.file,
    `${root}/.git/config`,
  ]) {
    const response = await page.request.get(
      `/@fs/${file.replaceAll('\\', '/').replace(/^\//, '')}`,
    );
    expect(response.status()).toBe(403);
  }
  const tabId = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  const view = await (
    await page.request.get('/api/workspace', { headers: { 'X-Session-Tab': tabId! } })
  ).json();
  expect(
    view.courses.every((c: any) => c.questions.every((q: any) => q.correct === undefined)),
  ).toBeTruthy();
});
