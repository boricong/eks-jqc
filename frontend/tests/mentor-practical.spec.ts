import { test, expect, actor, answerConfirmation } from './fixtures';
import { executeMentor } from '../../server/src/mentor-practical';
import { userView } from '../../server/src/organizations';
import { mentorNow } from '../../server/tests/mentor-practical-fixture';
test.use({ mentorPractical: true });
test('관리자 배정·다중 답변 제출·FT 전용 채점·수료 근거와 반응형 화면', async ({
  page,
  backend,
}, info) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/mentor-practicals');
  await page.locator('.mentor-list a').first().click();
  await page.getByLabel('FT 멘토', { exact: true }).selectOption('ft-1');
  await page.getByRole('button', { name: '멘토 지정', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '담당 FT 멘토를 지정했습니다.' }),
  ).toBeVisible();
  await page.goto('/');
  await actor(page, 'learner-1');
  const assignment = backend.store.snapshot().assignments[0]!.id;
  await page.goto(`/qualifications/${assignment}?stage=assessment`);
  await page.getByRole('link', { name: '실기 답변·평가 결과 보기' }).click();
  await page.getByRole('button', { name: '실기 답변 작성 시작' }).click();
  const answers = page.getByLabel('수행 내용·답변');
  await expect(answers).toHaveCount(3);
  for (let i = 0; i < 3; i++) await answers.nth(i).fill(`문항 ${i + 1} 수행 완료 · 결과 확인`);
  await page.getByRole('link', { name: '인증Set 평가로' }).click();
  await answerConfirmation(page, false);
  await expect(answers.nth(1)).toHaveValue('문항 2 수행 완료 · 결과 확인');
  await page.getByRole('button', { name: '답변 제출', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(
    page.getByRole('heading', { name: '1차 실기 · 제출 완료 · 채점 대기' }),
  ).toBeVisible();
  expect(backend.store.snapshot().completions).toHaveLength(0);
  await page.goto('/');
  await actor(page, 'ft-1');
  await expect(page.getByRole('link', { name: '담당 실기 평가 보기' })).toBeVisible();
  await page.getByRole('link', { name: '담당 실기 평가 보기' }).click();
  await page.locator('.mentor-list a').first().click();
  for (let i = 1; i <= 3; i++)
    await page.getByLabel(new RegExp(`문항 ${i} 점수`)).fill(String([20, 30, 50][i - 1]));
  await page.getByLabel('문항 1 피드백').fill('점검 절차를 정확히 수행했습니다.');
  await page.getByLabel('종합 평가 의견').fill('실기 수행 기준 충족');
  await page.getByRole('button', { name: '임시 채점 저장' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '임시 채점을 저장했습니다.' }),
  ).toBeVisible();
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/mentor-practicals/mentor-enrollment');
  await expect(page.getByText('실기 수행 기준 충족')).toHaveCount(0);
  await expect(page.getByText('점검 절차를 정확히 수행했습니다.')).toHaveCount(0);
  await page.goto('/');
  await actor(page, 'ft-1');
  await page.goto('/mentoring/mentor-enrollment');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.screenshot({ path: info.outputPath(`mentor-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: '평가 결과 검토' }).click();
  const dialog = page.getByRole('dialog', { name: '실기 평가 결과 검토' });
  await expect(dialog).toContainText('100 / 100점 · 합격');
  await expect(dialog).toContainText('자격 인증 발급도 함께 처리됩니다.');
  await dialog.getByRole('button', { name: '채점으로 돌아가기' }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '평가 결과 검토' })).toBeFocused();
  await page.getByRole('button', { name: '평가 결과 검토' }).click();
  let dropped = false;
  await page.route('**/api/mentor-practicals/*/finalize', async (route) => {
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: '평가 확정', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('서버에 연결');
  await dialog.getByRole('button', { name: '평가 확정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1차 평가 결과 · 합격' })).toBeVisible();
  expect(backend.store.snapshot().completions).toHaveLength(1);
  expect(backend.store.snapshot().certifications).toHaveLength(1);
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/mentor-practicals/mentor-enrollment');
  await expect(page.getByText('종합 의견: 실기 수행 기준 충족')).toBeVisible();
  await page.getByText('문항별 답변·점수·피드백', { exact: true }).click();
  await expect(page.getByText('피드백: 점검 절차를 정확히 수행했습니다.')).toBeVisible();
  await page.goto(`/completions/${backend.store.snapshot().completions[0]!.id}`);
  await expect(page.getByText(/실기\(주관식\) 합격 · 100 \/ 100점/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('다중 실기 문항·배점을 인증Set 새 버전에 저장한다', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-2');
  await page.getByLabel('실기(주관식) · FT 멘토 평가').check();
  await page.getByRole('tab', { name: '실기(주관식)', exact: true }).click();
  await page.getByLabel('실기 합격 기준 (%)').fill('75');
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: '실기 문항 추가' }).click();
    await page
      .getByLabel('실기 수행 지시·문항')
      .nth(i)
      .fill(`실기 과제 ${i + 1}`);
    await page
      .getByLabel('문항 배점')
      .nth(i)
      .fill(String([40, 60][i]));
  }
  await page.getByRole('button', { name: '저장', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '기준 저장 확인' });
  await expect(dialog).toContainText('v1.0 → v2.0');
  await dialog.getByRole('button', { name: '저장 확인', exact: true }).click();
  await expect
    .poll(
      () => backend.store.snapshot().courses.filter((c) => c.entityId === 'demo-course-2').length,
    )
    .toBe(2);
  const courses = backend.store.snapshot().courses.filter((c) => c.entityId === 'demo-course-2');
  expect(courses.find((c) => c.version === 1)!.mentorPractical).toBeUndefined();
  expect(courses.find((c) => c.releaseVersion?.major === 2)!.mentorPractical).toMatchObject({
    passScore: 75,
    questions: [{ points: 40 }, { points: 60 }],
  });
});

test('FT 역할 부여와 채점 충돌 시 입력 보존·다시 불러오기', async ({ page, backend }) => {
  page.setDefaultTimeout(15000);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '정하린 수정', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('FT 멘토', { exact: true }).check();
  await dialog.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(backend.store.snapshot().users.find((u) => u.id === 'learner-2')!.roles).toContain('ft');
  async function action(actorId: string, name: string, body: Record<string, unknown>) {
    await backend.store.transact(
      actorId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      () => {},
      (s) =>
        executeMentor(
          s,
          backend.store.organizations.snapshot(),
          userView(
            s.users.find((u) => u.id === actorId)!,
            backend.store.organizations.snapshot(),
          ),
          'mentor-enrollment',
          name,
          body,
          mentorNow,
        ),
    );
  }
  await action('admin-1', 'assign', { mentorId: 'learner-2', revision: 0, reason: '' });
  await action('learner-1', 'start', {});
  const id = backend.store.snapshot().mentorAttempts[0]!.id;
  await action('learner-1', 'save', {
    attemptId: id,
    revision: 1,
    answers: { m1: '점검', m2: '측정', m3: '조치' },
  });
  await action('learner-1', 'submit', { attemptId: id, revision: 2 });
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.goto('/mentoring/mentor-enrollment');
  await page.getByLabel(/문항 1 점수/).fill('12');
  await page.getByLabel('문항 1 피드백').fill('보존할 입력');
  await action('learner-2', 'grade', {
    attemptId: id,
    revision: 3,
    scores: { m1: 15 },
    feedback: {},
    comment: '다른 창 저장',
  });
  await page.getByRole('button', { name: '임시 채점 저장' }).click();
  await expect(page.getByRole('alert')).toContainText('다른 창');
  await expect(page.getByLabel(/문항 1 점수/)).toHaveValue('12');
  await expect(page.getByLabel('문항 1 피드백')).toHaveValue('보존할 입력');
  await page.getByRole('button', { name: '최신 내용 다시 불러오기' }).click();
  await answerConfirmation(page, false);
  await expect(page.getByLabel('문항 1 피드백')).toHaveValue('보존할 입력');
  await page.getByRole('button', { name: '최신 내용 다시 불러오기' }).click();
  await answerConfirmation(page, true);
  await expect(page.getByLabel(/문항 1 점수/)).toHaveValue('15');
  await expect(page.getByLabel('종합 평가 의견')).toHaveValue('다른 창 저장');
});
