import { test, expect, actor, answerConfirmation } from './fixtures';
import { courseSection, createCourse, saveCriterion } from './catalog-helpers';
import { randomUUID } from 'node:crypto';
const address = '/qualifications/assignment-1/courses/demo-course-2/subjective-response';
async function configure(backend: any) {
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    'subjective-fixture',
    () => {},
    (s: any) => {
      const c = s.courses.find((c: any) => c.id === 'demo-course-2');
      c.subjectiveEnabled = true;
      c.subjectiveQuestions = [
        { id: 'essay-1', prompt: '문제 본문 '.repeat(70) },
        { id: 'essay-2', prompt: '대응 방법을 설명하세요.' },
      ];
      return {};
    },
  );
}
test('공통·특화 편집에서 주관식 문항·순서·사용 해제 보존과 미완성 저장을 지원한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/common-courses');
  await page.getByRole('button', { name: '새 공통인증Set 만들기', exact: true }).click();
  await page.getByLabel('인증Set명', { exact: true }).fill('주관식 공통');
  await page.getByRole('checkbox', { name: /주관식 평가/ }).check();
  await courseSection(page, '주관식 평가');
  await page.getByRole('button', { name: '주관식 문항 추가', exact: true }).click();
  await page.getByLabel('주관식 문제', { exact: true }).fill('공통 문제');
  await page.getByRole('button', { name: '공통인증Set 저장', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(page.getByRole('heading', { name: '공통인증Set 관리', exact: true })).toBeVisible();
  expect(backend.store.snapshot().commonCourses[0]!.subjectiveQuestions[0]!.prompt).toBe(
    '공통 문제',
  );
  await actor(page, 'admin-1');
  await page.goto('/admin/courses');
  await createCourse(page, 'Auditee', '주관식 특화');
  await page.getByRole('checkbox', { name: /주관식 평가/ }).check();
  await courseSection(page, '주관식 평가');
  await page.getByRole('button', { name: '주관식 문항 추가', exact: true }).click();
  await page.getByLabel('주관식 문제', { exact: true }).fill('첫 문제');
  await page.getByRole('button', { name: '주관식 문항 추가', exact: true }).click();
  await page.getByLabel('주관식 문제', { exact: true }).fill('둘째 문제');
  await page.getByRole('button', { name: '문항 위로', exact: true }).click();
  await courseSection(page, '기본정보');
  await page.getByRole('checkbox', { name: /주관식 평가/ }).uncheck();
  await saveCriterion(page);
  await expect(page).toHaveURL(/\/admin\/courses(?:\?|$)/);
  const c = backend.store
    .snapshot()
    .courses.filter((c) => c.title === '주관식 특화')
    .sort((a, b) => b.version - a.version)[0]!;
  expect(c.subjectiveEnabled).toBe(false);
  expect(c.subjectiveQuestions.map((q) => q.prompt)).toEqual(['둘째 문제', '첫 문제']);
});
test('주관식 자동 저장·전 문항 제출·관리자 제출 조회와 네 화면 폭', async ({
  page,
  backend,
}, info) => {
  await configure(backend);
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto(address);
  await page.getByRole('button', { name: '주관식 답변 시작', exact: true }).click();
  await page.getByLabel('주관식 답변', { exact: true }).fill('긴 답변 '.repeat(250));
  await expect(page.getByRole('status')).toContainText('저장됨');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`subjective-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: '제출 전 답변 확인', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('모든 문항');
  await expect(page.getByLabel('주관식 답변', { exact: true })).toBeFocused();
  await page.getByLabel('주관식 답변', { exact: true }).fill('대응 답변\n두 번째 줄');
  await page.getByRole('button', { name: '제출 전 답변 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '제출 전 답변 확인', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '답변 최종 제출', exact: true }).click();
  await expect(page.getByRole('heading', { name: '제출한 답변', exact: true })).toBeVisible();
  expect(backend.store.snapshot().subjectiveResponses[0]!.status).toBe('submitted');
  await expect(page.getByLabel('주관식 답변', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1920, height: 900 });
  await actor(page, 'admin-1');
  await page.goto('/admin/results?assignmentId=assignment-1');
  await page.getByText(/주관식 평가 · 답변 제출 완료/).click();
  await expect(page.getByText('대응 답변\n두 번째 줄', { exact: true })).toBeVisible();
});
test('저장 실패·이동 취소와 서버 Hold 잠금에서도 입력을 보존한다', async ({ page, backend }) => {
  await configure(backend);
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto(address);
  await page.getByRole('button', { name: '주관식 답변 시작', exact: true }).click();
  await page.route('**/api/subjective-responses/*/draft', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: '저장 실패 시험' }),
    }),
  );
  await page.getByLabel('주관식 답변', { exact: true }).fill('보존할 입력');
  await expect(page.getByRole('alert')).toContainText('저장 실패');
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: '홈', exact: true })
    .click();
  await answerConfirmation(page, false);
  await expect(page.getByLabel('주관식 답변', { exact: true })).toHaveValue('보존할 입력');
  await page.unroute('**/api/subjective-responses/*/draft');
  await page.getByRole('button', { name: '답변 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('저장됨');
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    'hold',
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'learner-1')!.certificationEligibility = 'hold';
      return {};
    },
  );
  await page.getByLabel('주관식 답변', { exact: true }).fill('충돌 후에도 보존');
  await expect(page.getByRole('alert')).toContainText('Hold');
  await expect(page.getByLabel('주관식 답변', { exact: true })).toHaveValue('충돌 후에도 보존');
});

test('주관식 제출 응답 유실은 같은 요청으로 복구하고 단일 제출을 보존한다', async ({
  page,
  backend,
}) => {
  await configure(backend);
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto(address);
  await page.getByRole('button', { name: '주관식 답변 시작', exact: true }).click();
  await page.getByLabel('주관식 답변', { exact: true }).fill('첫 답변');
  await page.getByRole('tablist', { name: '주관식 답변 문항' }).getByRole('tab').nth(1).click();
  await page.getByLabel('주관식 답변', { exact: true }).fill('두 번째 답변');
  await page.getByRole('button', { name: '제출 전 답변 확인', exact: true }).click();
  const keys: string[] = [];
  await page.route('**/api/subjective-responses/*/submit', async (route) => {
    keys.push(route.request().headers()['idempotency-key']!);
    if (keys.length === 1) {
      expect((await route.fetch()).ok()).toBe(true);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"제출 응답 유실 시험"}',
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '답변 최종 제출', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('응답 유실');
  await expect(page.getByRole('button', { name: '답변 수정', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '답변 최종 제출', exact: true }).click();
  await expect(page.getByRole('heading', { name: '제출한 답변', exact: true })).toBeVisible();
  expect(keys.length).toBe(2);
  expect(new Set(keys).size).toBe(1);
  expect(
    backend.store.snapshot().audits.filter((a) => a.action === 'subjective.submit'),
  ).toHaveLength(1);
});

test('주관식 미제출 상태로 필수 평가를 수료하면 초안은 본인 읽기 전용으로 잠긴다', async ({
  page,
  backend,
}) => {
  const { assessmentQuestions } = await import('@eks/contracts');
  await configure(backend);
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto(address);
  await page.getByRole('button', { name: '주관식 답변 시작', exact: true }).click();
  await page.getByLabel('주관식 답변', { exact: true }).fill('수료 전 비공개 초안');
  await expect(page.getByRole('status')).toContainText('저장됨');
  const tab = await page.evaluate(() => sessionStorage.getItem('eks-session-tab')!);
  async function call(url: string, body: any, method = 'POST') {
    const r = await page.request.fetch(`/api${url}`, {
      method,
      data: body,
      headers: {
        'X-Session-Tab': tab,
        'Idempotency-Key': randomUUID(),
        Origin: 'http://127.0.0.1:5286',
      },
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  }
  const c = backend.store.snapshot().courses.find((c) => c.id === 'demo-course-2')!;
  for (const kind of c.assessmentKinds) {
    const a = await call('/enrollments/assignment-1:demo-course-2/attempts', { kind });
    const saved = await call(
      `/attempts/${a.id}/draft`,
      {
        revision: a.revision,
        answers: Object.fromEntries(assessmentQuestions(c, kind).map((q) => [q.id, q.correct])),
      },
      'PUT',
    );
    await call(`/attempts/${a.id}/submit`, { revision: saved.revision });
  }
  await page.reload();
  await expect(page.getByText(/수료로 작성 종료/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '보존된 답변', exact: true })).toBeVisible();
  await expect(page.getByText('수료 전 비공개 초안', { exact: true })).toBeVisible();
  await expect(page.getByLabel('주관식 답변', { exact: true })).toHaveCount(0);
  await actor(page, 'admin-1');
  await page.goto('/admin/results?assignmentId=assignment-1');
  await expect(page.getByText('수료 전 비공개 초안', { exact: true })).toHaveCount(0);
});
