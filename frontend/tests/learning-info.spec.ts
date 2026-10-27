import { test, expect, actor, answerConfirmation } from './fixtures';
import { courseSection, createCourse, openSavedCourse, saveCriterion } from './catalog-helpers';

test('교육 세 유형·구분별 정렬·자료 직접 편집·저장과 재조회', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses');
  await createCourse(page, 'Auditee', '학습 정보 통합');
  await courseSection(page, '학습 정보');
  await expect(page.getByText('등록된 학습 정보가 없습니다.', { exact: true })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: '학습 정보 항목', exact: true });
  await page.getByRole('button', { name: '자료 추가', exact: true }).click();
  await page.getByLabel('자료명', { exact: true }).fill('먼저 추가한 자료');
  await page.getByLabel('본문', { exact: true }).fill('탭 이동 중에도 유지될 내용');
  for (const [type, title] of [
    ['mtc', '공통 교육'],
    ['team', '팀 교육'],
    ['ojt', '현업 교육'],
  ]) {
    await page.getByRole('button', { name: '교육 추가', exact: true }).click();
    await expect(page.getByLabel('교육명', { exact: true })).toBeFocused();
    await page.getByLabel('교육명', { exact: true }).fill(title!);
    await page.getByLabel('교육 종류', { exact: true }).selectOption(type!);
  }
  await expect(tabs.getByRole('tab')).toHaveText(['교육 1', '교육 2', '교육 3', '자료 1']);
  await expect(page.getByRole('button', { name: '교육 3 아래로', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '교육 3 위로', exact: true }).click();
  await expect(page.getByLabel('교육명', { exact: true })).toHaveValue('현업 교육');
  await tabs.getByRole('tab', { name: /^자료 1/ }).click();
  await expect(page.getByLabel('본문', { exact: true })).toHaveValue('탭 이동 중에도 유지될 내용');
  await expect(page.getByRole('button', { name: '자료 1 위로', exact: true })).toBeDisabled();
  await tabs.getByRole('tab').last().press('Home');
  await expect(page.getByLabel('교육명', { exact: true })).toHaveValue('공통 교육');
  await saveCriterion(page);
  await openSavedCourse(page, '학습 정보');
  const course = backend.store
    .snapshot()
    .courses.filter((c) => c.title === '학습 정보 통합')
    .sort((a, b) => b.version - a.version)[0]!;
  expect(course.learningItems.map((i) => i.type)).toEqual(['mtc', 'ojt', 'team']);
  expect(course.materials[0]?.content).toBe('탭 이동 중에도 유지될 내용');
  await expect(tabs.getByRole('tab', { name: /^교육 2/ })).toHaveAccessibleName(/현업 교육/);
  for (let remaining = 4; remaining > 0; remaining--) {
    await tabs.getByRole('tab').last().click();
    await page.getByRole('button', { name: '이 항목 삭제', exact: true }).click();
    await answerConfirmation(page, true);
  }
  await expect(page.getByRole('button', { name: '교육 추가', exact: true })).toBeFocused();
  await expect(page.getByText('등록된 학습 정보가 없습니다.', { exact: true })).toBeVisible();
  await saveCriterion(page);
  await expect(page).toHaveURL(/\/admin\/courses(?:\?|$)/);
  const empty = backend.store
    .snapshot()
    .courses.filter((c) => c.entityId === course.entityId)
    .sort((a, b) => b.version - a.version)[0]!;
  expect(empty.learningItems).toEqual([]);
  expect(empty.materials).toEqual([]);
});

test('잘못된 URL·저장 실패·revision 충돌·미저장 이탈에서도 선택과 입력 보존', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses');
  await createCourse(page, 'Auditee', '자료 오류 보존');
  const id = page.url().split('/').at(-1)!.split('?')[0]!;
  await courseSection(page, '학습 정보');
  await page.getByRole('button', { name: '자료 추가', exact: true }).click();
  await page.getByLabel('자료명', { exact: true }).fill('유지할 자료');
  await page.getByLabel('자료 유형', { exact: true }).selectOption('url');
  await page.getByLabel('URL', { exact: true }).fill('javascript:alert(1)');
  await courseSection(page, '기본정보');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByLabel('URL', { exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: '학습 정보', exact: true })).toContainText(
    'HTTP(S)',
  );
  await expect(page.getByRole('dialog', { name: '기준 저장 확인' })).toHaveCount(0);
  expect(backend.store.snapshot().courses.find((c) => c.id === id)!.materials).toHaveLength(0);
  await page.getByLabel('URL', { exact: true }).fill('https://example.com/keep');
  await page.locator('.back-link').click();
  await answerConfirmation(page, false);
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue('https://example.com/keep');
  await page.route('**/api/courses/*', (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue(),
  );
  await saveCriterion(page);
  await expect(page.getByLabel('자료명', { exact: true })).toHaveValue('유지할 자료');
  await page.unroute('**/api/courses/*');
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'conflict',
    () => {},
    (state) => {
      state.courses.find((c) => c.id === id)!.revision++;
      return {};
    },
  );
  await saveCriterion(page);
  await expect(page.locator('.editor-errors')).toBeVisible();
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue('https://example.com/keep');
  await expect(page.getByRole('tab', { name: /자료 1 · 유지할 자료/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('빈 공통인증Set 저장과 Auditor 운영 보완 안내의 추가 초점', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  for (const type of ['auditee', 'auditor']) {
    await page.goto('/system/common-courses');
    await page.getByRole('button', { name: '새 공통인증Set 만들기', exact: true }).click();
    await page.getByLabel('인증Set명', { exact: true }).fill('빈 학습 정보 ' + type);
    await page.getByLabel('인증 유형', { exact: true }).selectOption(type);
    await courseSection(page, '학습 정보');
    await expect(page.getByText('등록된 학습 정보가 없습니다.', { exact: true })).toBeVisible();
    if (type === 'auditor') {
      await page.getByText('신규 운영 전 보완 1건', { exact: true }).click();
      await page
        .getByRole('button', {
          name: '운영하려면 필수 교육을 하나 이상 설정해 주세요.',
          exact: true,
        })
        .click();
      await expect(page.getByRole('button', { name: '교육 추가', exact: true })).toBeFocused();
    }
    await page.getByRole('button', { name: '공통인증Set 저장', exact: true }).click();
    await answerConfirmation(page, true);
    await expect(
      page.getByRole('heading', { name: '공통인증Set 관리', exact: true }),
    ).toBeVisible();
    const course = backend.store
      .snapshot()
      .commonCourses.find((c) => c.title === '빈 학습 정보 ' + type)!;
    expect(course.learningItems).toEqual([]);
    expect(course.materials).toEqual([]);
  }
});
