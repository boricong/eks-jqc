import { test, expect, actor } from './fixtures';
import { assessmentQuestions } from '@eks/contracts';
async function headers(page: any) {
  return {
    'X-Session-Tab': (await page.evaluate(() => sessionStorage.getItem('eks-session-tab')))!,
    'Idempotency-Key': crypto.randomUUID(),
  };
}
for (const count of [1, 10, 30, 500])
  test(`${count}문항 마지막 안내·미응답 팝업·20개 답안 검토·최종 제출`, async ({
    page,
    backend,
  }, info) => {
    test.setTimeout(60000);
    await backend.store.transact(
      'admin-1',
      crypto.randomUUID(),
      'questions',
      () => {},
      (s) => {
        const c = s.courses.find((c) => c.id === 'demo-course-2')!,
          base = c.questions[0]!;
        c.passScore = 100;
        c.questions = Array.from({ length: count }, (_, i) => ({
          ...base,
          id: `review-${i}`,
          prompt: `긴 질문 ${i + 1} · 현재 기준과 기록을 확인하는 올바른 방법은 무엇인가요?`,
          choices: ['기준과 기록을 대조하여 확인한다', '확인하지 않고 진행한다'],
          correct: 0,
        }));
        return {};
      },
    );
    await page.goto('/');
    await actor(page, 'learner-1');
    await page.goto('/qualifications/assignment-1/courses/demo-course-2/objective');
    const tabs = page.getByRole('tablist', { name: '응시 문항', exact: true });
    await tabs.getByRole('tab').last().click();
    await page.getByRole('button', { name: '다음 문항', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName('마지막 문항입니다');
    await expect(dialog).toContainText('최종 제출할 수 있습니다.');
    await dialog.getByRole('button', { name: '확인', exact: true }).click();
    expect(
      backend.store
        .snapshot()
        .attempts.filter((a) => a.courseId === 'demo-course-2' && a.status === 'graded'),
    ).toHaveLength(0);
    await page.getByRole('button', { name: '제출', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`미응답 ${count}문항`);
    await dialog.getByRole('button', { name: '확인', exact: true }).click();
    await expect(tabs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('radio').first()).toBeFocused();
    await page.getByRole('radio').first().check();
    await expect(page.locator('.save-status')).toHaveText('저장됨');
    const a = backend.store
      .snapshot()
      .attempts.find((a) => a.courseId === 'demo-course-2' && a.status === 'in_progress')!;
    const res = await page.request.put(`/api/attempts/${a.id}/draft`, {
      headers: await headers(page),
      data: {
        revision: a.revision,
        answers: Object.fromEntries(Array.from({ length: count }, (_, i) => [`review-${i}`, 0])),
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    await page.reload();
    await expect(page.locator('.assessment-progress')).toContainText(`${count} / ${count} 응답`);
    await page.getByRole('button', { name: '제출', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '제출 전 답안 확인', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.review-question')).toHaveCount(Math.min(20, count));
    await expect(page.locator('.submission-warning')).toContainText(
      '최종 제출 후에는 답안을 수정할 수 없습니다.',
    );
    if (count > 20) {
      await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
      await expect(page.locator('.review-number').first()).toHaveText('21');
      await page.getByRole('button', { name: '이전 페이지', exact: true }).click();
    }
    await page.getByRole('button', { name: '1번 답안 수정', exact: true }).click();
    await expect(tabs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('radio').first()).toBeChecked();
    await page.getByRole('button', { name: '제출', exact: true }).click();
    if (count === 30)
      for (const width of [1920, 1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: info.outputPath(`review-${width}.png`) });
      }
    await page.getByRole('button', { name: '최종 제출', exact: true }).click();
    await expect(page.getByRole('heading', { name: '평가 통과', exact: true })).toBeVisible();
    await expect(page.locator('.assessment-outcome')).toHaveClass(/outcome-passed/);
    await expect(
      page.getByRole('link', { name: '상황 대응 평가 시작', exact: true }),
    ).toBeVisible();
    expect(
      backend.store
        .snapshot()
        .attempts.filter((a) => a.courseId === 'demo-course-2' && a.status === 'graded'),
    ).toHaveLength(1);
    if (count === 30)
      for (const width of [1920, 1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        await page.screenshot({ path: info.outputPath(`passed-${width}.png`), fullPage: true });
      }
  });
test('실기 잠금·미통과 배경·지식 재응시 통과 후 실기 열림과 답안 보존', async ({
  page,
  backend,
}, info) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1?course=demo-course-2&stage=assessment');
  await expect(page.locator('.assessment-locked')).toContainText('지식 평가를 먼저 통과');
  await page.goto('/qualifications/assignment-1/courses/demo-course-2/practical');
  await expect(page.locator('.assessment-prerequisite')).toBeVisible();
  await expect(page.getByRole('button', { name: '제출', exact: true })).toBeDisabled();
  expect(
    backend.store
      .snapshot()
      .attempts.filter((a) => a.courseId === 'demo-course-2' && a.kind === 'practical'),
  ).toHaveLength(0);
  await page.getByRole('link', { name: '지식 평가로 이동', exact: true }).click();
  const c = backend.store.snapshot().courses.find((c) => c.id === 'demo-course-2')!;
  for (let i = 0; i < c.questions.length; i++) {
    await page.getByRole('tablist', { name: '응시 문항' }).getByRole('tab').nth(i).click();
    await page
      .getByRole('radio')
      .nth((c.questions[i]!.correct! + 1) % c.questions[i]!.choices.length)
      .check();
  }
  await page.getByRole('button', { name: '제출', exact: true }).click();
  await page.getByRole('button', { name: '최종 제출', exact: true }).click();
  await expect(page.locator('.outcome-failed')).toBeVisible();
  await expect(page.getByRole('heading', { name: '미통과 · 재응시 가능' })).toBeVisible();
  await expect(page.getByRole('link', { name: '상황 대응 평가 시작', exact: true })).toHaveCount(0);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: info.outputPath(`failed-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: '다시 응시', exact: true }).click();
  for (let i = 0; i < c.questions.length; i++) {
    await page.getByRole('tablist', { name: '응시 문항' }).getByRole('tab').nth(i).click();
    await page.getByRole('radio').nth(c.questions[i]!.correct!).check();
  }
  await page.getByRole('button', { name: '제출', exact: true }).click();
  await page.getByRole('button', { name: '최종 제출', exact: true }).click();
  await page.getByRole('link', { name: '상황 대응 평가 시작', exact: true }).click();
  await expect(page.locator('.scenario-context')).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeEnabled();
});

test('다른 탭에서 지식 평가를 통과하면 열린 실기 화면도 새로 조회한 권한으로 열린다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1/courses/demo-course-2/practical');
  await expect(page.locator('.assessment-prerequisite')).toBeVisible();
  const course = backend.store.snapshot().courses.find((c) => c.id === 'demo-course-2')!;
  const started = await page.request.post('/api/enrollments/assignment-1:demo-course-2/attempts', {
    headers: await headers(page),
    data: { kind: 'objective' },
  });
  expect(started.ok()).toBeTruthy();
  const a = await started.json();
  const saved = await page.request.put(`/api/attempts/${a.id}/draft`, {
    headers: await headers(page),
    data: {
      revision: a.revision,
      answers: Object.fromEntries(course.questions.map((q) => [q.id, q.correct])),
    },
  });
  expect(saved.ok()).toBeTruthy();
  const submitted = await page.request.post(`/api/attempts/${a.id}/submit`, {
    headers: await headers(page),
    data: { revision: a.revision + 1 },
  });
  expect(submitted.ok()).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.assessment-prerequisite')).toHaveCount(0);
  await expect(page.getByRole('radio').first()).toBeEnabled();
  await expect(page.getByRole('button', { name: '제출', exact: true })).toBeEnabled();
});
