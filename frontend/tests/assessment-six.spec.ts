import { answerConfirmation } from './fixtures';
import { courseSection, saveCriterion, openSavedCourse } from './catalog-helpers';
import { test, expect, actor } from './fixtures';

test('학습자 500문항 세로 응시·미응답·저장 실패 입력 보존', async ({ page, context, backend }) => {
  test.setTimeout(60000);
  await backend.store.transact(
    'admin-1',
    'many-assessments',
    'many-assessments',
    () => {},
    (s) => {
      const c = s.courses.find((c) => c.id === 'demo-course-2')!;
      c.practicalQuestions = Array.from({ length: 500 }, (_, i) => ({
        ...c.practicalQuestions[0]!,
        id: `many-${i}`,
        prompt: `대응 질문 ${i + 1}`,
      }));
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  const tab = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  const headers = () => ({ 'X-Session-Tab': tab!, 'Idempotency-Key': crypto.randomUUID() });
  const started = await page.request.post('/api/enrollments/assignment-1:demo-course-2/attempts', {
    headers: headers(),
    data: { kind: 'objective' },
  });
  expect(started.ok()).toBeTruthy();
  const knowledge = await started.json(),
    course = backend.store.snapshot().courses.find((c) => c.id === 'demo-course-2')!;
  const saved = await page.request.put(`/api/attempts/${knowledge.id}/draft`, {
    headers: headers(),
    data: {
      revision: knowledge.revision,
      answers: Object.fromEntries(course.questions.map((q) => [q.id, q.correct])),
    },
  });
  expect(saved.ok()).toBeTruthy();
  const submitted = await page.request.post(`/api/attempts/${knowledge.id}/submit`, {
    headers: headers(),
    data: { revision: knowledge.revision + 1 },
  });
  expect(submitted.ok()).toBeTruthy();

  await page.goto('/qualifications/assignment-1/courses/demo-course-2/practical');
  const tabs = page.getByRole('tablist', { name: '응시 문항', exact: true });
  await expect(tabs.getByRole('tab')).toHaveCount(500);
  await page.getByRole('button', { name: /^답안 확인(?:으로 돌아가기)?$/ }).click();
  await expect(page.getByRole('alert')).toContainText('모든 문항');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await page.route('**/api/attempts/*/draft', (r) =>
    r.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"message":"저장 실패 시험"}',
    }),
  );
  await page.getByRole('radio').first().check();
  await expect(page.locator('.save-error')).toContainText('저장 실패 시험');
  for (const n of [10, 30, 500])
    await tabs
      .getByRole('tab')
      .nth(n - 1)
      .click();
  await tabs.getByRole('tab').last().press('Home');
  await expect(page.getByRole('radio').first()).toBeChecked();
  await page.unroute('**/api/attempts/*/draft');
  await page.getByRole('button', { name: '저장 재시도' }).click();
  await expect(page.locator('.save-status')).toHaveText('저장됨');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: test.info().outputPath(`assessment-${width}.png`) });
  }
});

test('학습·평가 1·10·30·최대 항목의 세로 순번 탐색과 입력 보존', async ({ page, backend }) => {
  test.setTimeout(60000);
  await backend.store.transact(
    'admin-1',
    'many-items',
    'many-items',
    () => {},
    (s) => {
      const c = structuredClone(s.courses.find((c) => c.id === 'demo-course-1')!);
      c.id = c.entityId = 'vertical-draft';
      c.version = 1;
      c.learningItems = Array.from({ length: 100 }, (_, i) => ({
        ...c.learningItems[0]!,
        id: `l${i}`,
        title: `학습 ${i + 1}`,
      }));
      c.questions = Array.from({ length: 500 }, (_, i) => ({
        ...c.questions[0]!,
        id: `q${i}`,
        prompt: `지식 ${i + 1}`,
      }));
      c.practicalQuestions = Array.from({ length: 500 }, (_, i) => ({
        ...c.practicalQuestions[0]!,
        id: `p${i}`,
        prompt: `대응 ${i + 1}`,
      }));
      s.courses.push(c);
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/vertical-draft');
  await expect(page.getByRole('checkbox', { name: '주관식', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('문항 분류')).toHaveCount(0);
  await courseSection(page, '학습 정보');
  const learning = page.getByRole('tablist', { name: '학습 정보 항목', exact: true });
  const knowledge = page.getByRole('tablist', { name: '객관식 · 지식 평가 문항', exact: true });
  await expect(learning).toHaveAttribute('aria-orientation', 'vertical');
  for (const n of [1, 10, 30, 100]) {
    await learning
      .getByRole('tab')
      .nth(n - 1)
      .click();
    await expect(page.getByLabel('교육명')).toHaveValue(`학습 ${n}`);
  }
  await courseSection(page, '지식 평가');
  for (const n of [1, 10, 30, 500]) {
    await knowledge
      .getByRole('tab')
      .nth(n - 1)
      .click();
    await expect(page.getByLabel('문항', { exact: true })).toHaveValue(`지식 ${n}`);
    await expect(knowledge.getByRole('tab').nth(n - 1)).toHaveText(String(n));
  }
  await page.getByLabel('문항', { exact: true }).fill('500번 수정 내용');
  await knowledge.getByRole('tab').last().press('Home');
  await expect(knowledge.getByRole('tab').first()).toBeFocused();
  await knowledge.getByRole('tab').first().press('End');
  await expect(page.getByLabel('문항', { exact: true })).toHaveValue('500번 수정 내용');
  await page
    .getByRole('tablist', { name: '인증Set 편집 항목', exact: true })
    .getByRole('tab', { name: /상황 대응 평가/ })
    .click();
  await expect(page.getByLabel('상황 설명')).toBeVisible();
  await courseSection(page, '기본정보');
  await page
    .getByRole('checkbox', { name: '실기 · 상황 대응 평가 수료 필수', exact: true })
    .uncheck();
  await page
    .getByRole('checkbox', { name: '실기 · 상황 대응 평가 수료 필수', exact: true })
    .check();
  await page
    .getByRole('tablist', { name: '인증Set 편집 항목', exact: true })
    .getByRole('tab', { name: /상황 대응 평가/ })
    .click();
  await expect(
    page.getByRole('tablist', { name: '실기 · 상황 대응 평가 문항', exact: true }).getByRole('tab'),
  ).toHaveCount(500);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.getByLabel('상황 설명').scrollIntoViewIfNeeded();
    const rail = page.getByRole('tablist', { name: '실기 · 상황 대응 평가 문항', exact: true });
    await rail.getByRole('tab').first().press('End');
    await expect(rail.getByRole('tab').last()).toBeFocused();
    const selectedBox = await rail.getByRole('tab').last().boundingBox();
    const railBox = await rail.boundingBox();
    const panelBox = await page.locator('.assessment-item-panel:visible').boundingBox();
    expect(selectedBox!.y).toBeGreaterThanOrEqual(railBox!.y - 1);
    expect(selectedBox!.y + selectedBox!.height).toBeLessThanOrEqual(
      railBox!.y + railBox!.height + 1,
    );
    expect(selectedBox!.x + selectedBox!.width).toBeCloseTo(panelBox!.x, 0);
    await page.screenshot({ path: test.info().outputPath(`vertical-${width}.png`) });
  }
  await saveCriterion(page);
  await expect
    .poll(
      () =>
        backend.store
          .snapshot()
          .courses.filter((c) => c.entityId === 'vertical-draft')
          .sort((a, b) => b.version - a.version)[0]!.questions[499]!.prompt,
    )
    .toBe('500번 수정 내용');
});

test('네 자료 유형의 직접 편집·순서·삭제·미완성 저장과 오류 초점', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  await courseSection(page, '학습 정보');
  const tabs = page.getByRole('tablist', { name: '학습 정보 항목', exact: true });
  for (const [type, title] of [
    ['text', '직접 자료'],
    ['edm', 'EDM 자료'],
    ['confluence', 'Confluence 자료'],
    ['url', '일반 링크'],
  ]) {
    await page.getByRole('button', { name: '자료 추가', exact: true }).click();
    await expect(page.getByLabel('자료명', { exact: true })).toBeFocused();
    await page.getByLabel('자료 유형', { exact: true }).selectOption(type!);
    await page.getByLabel('자료명', { exact: true }).fill(title!);
    if (type === 'text')
      await page.getByLabel('본문', { exact: true }).fill('교육 내용을 직접 작성합니다.');
    else await page.getByLabel('URL', { exact: true }).fill('https://example.com/' + type);
  }
  await expect(page.getByRole('button', { name: '목록에 추가', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /자료 .* 위로/ }).click();
  await tabs.getByRole('tab', { name: /EDM 자료/ }).click();
  await page.getByLabel('자료명', { exact: true }).fill('EDM 수정 자료');
  await saveCriterion(page);
  await openSavedCourse(page, '학습 정보');
  const draft = backend.store
    .snapshot()
    .courses.find((c) => c.entityId === 'demo-course-1' && c.version > 1)!;
  expect(draft.materials.slice(-4).map((m) => m.type)).toEqual([
    'text',
    'edm',
    'url',
    'confluence',
  ]);
  expect(draft.materials.some((m) => m.title === 'EDM 수정 자료')).toBe(true);
  await tabs.getByRole('tab', { name: /일반 링크/ }).click();
  await page.getByRole('button', { name: '이 항목 삭제', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(tabs.getByRole('tab', { name: /Confluence 자료/ })).toBeFocused();
  await page.getByRole('button', { name: '자료 추가', exact: true }).click();
  await page.getByLabel('자료명', { exact: true }).fill('작성 중 자료');
  await saveCriterion(page);
  await openSavedCourse(page, '학습 정보');
  const saved = backend.store
    .snapshot()
    .courses.filter((c) => c.entityId === draft.entityId)
    .sort((a, b) => b.version - a.version)[0]!;
  expect(saved.materials.some((m) => m.title === '일반 링크')).toBe(false);
  expect(saved.materials.at(-1)?.title).toBe('작성 중 자료');
  await expect(tabs.getByRole('tab', { name: /작성 중 자료/ })).toHaveAccessibleName(/보완 필요/);
  await expect(page.locator('.editor-errors')).toContainText('학습 정보 · 자료');
  await page.locator('.editor-errors').getByRole('button', { name: /본문/ }).click();
  await expect(page.getByLabel('본문', { exact: true })).toBeFocused();
  expect('status' in saved).toBe(false);
});

test('상황 설명 누락의 오류 이동·유형 해제 보존·추가 삭제 취소', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  await page
    .getByRole('tablist', { name: '인증Set 편집 항목', exact: true })
    .getByRole('tab', { name: /상황 대응 평가/ })
    .click();
  await page.getByLabel('상황 설명').fill('');
  await saveCriterion(page);
  await openSavedCourse(page, '상황 대응 평가');
  await expect(page.locator('.editor-errors')).toContainText('상황');
  await page.locator('.editor-errors').getByRole('button').first().click();
  await expect(page.getByLabel('상황 설명')).toBeFocused();
  await page.getByLabel('상황 설명').fill('가상 상황의 조건');
  await page.getByRole('button', { name: '문항 삭제', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByLabel('상황 설명')).toHaveValue('가상 상황의 조건');
  await page.getByRole('button', { name: '문항 추가', exact: true }).click();
  await expect(page.getByLabel('상황 설명')).toBeFocused();
  await expect(page.locator('.objective-choice input:checked')).toHaveCount(0);
  await page.getByRole('button', { name: '문항 삭제', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
