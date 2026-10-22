import { test, expect, actor } from './fixtures';
import { completePlan, requestPlan } from './workflow-helpers';
import { configureTestPolicies } from '../../server/tests/policy-helpers';
import { nodeFor } from '../../server/src/organizations';
import type { Page } from '@playwright/test';
async function responsive(page: Page, name: string) {
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sizes = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);
    const toggle = page.getByTestId('process-guide').getByRole('button');
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    await expect(page.getByTestId('process-guide')).toContainText('정적 설명');
    await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
}
test('Lv5 조직·소속·팀 선정·필수 지정·요청·학습 안내·두 자동 평가·인증', async ({
  page,
  backend,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/organizations');
  await page.getByLabel('조직 검색').fill('RE A조');
  await page.locator('.tree-node').filter({ hasText: 'RE A조' }).click();
  await page.getByRole('button', { name: '하위 조직 추가', exact: true }).click();
  await page.getByLabel('조직명', { exact: true }).fill('Photo 공정 검증 상세 조직');
  await page.getByRole('button', { name: '조직 저장', exact: true }).click();
  await expect(page.locator('.tree-node.selected')).toContainText('Lv5');
  const deep =
    backend.store.organizations.snapshot().roots[0]!.children[0]!.children[0]!.children[0]!
      .children[0]!;
  await page.getByRole('button', { name: '선택 조직으로 이동' }).click();
  await page.goto('/system/users');
  await page.getByRole('button', { name: '정하린 수정', exact: true }).click();
  for (const [level, id] of [
    [2, 'org-photo-fmg'],
    [3, 'org-photo-pyeongtaek'],
    [4, 'org-photo-pyeongtaek-1'],
    [5, deep.id],
  ] as const)
    await page.getByLabel(`Lv${level} 조직`, { exact: true }).selectOption(id);
  await expect(page.getByLabel('Lv5 조직', { exact: true })).toHaveValue(deep.id);
  await page.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await actor(page, 'admin-1');
  await page.goto('/admin/policies');
  await page.locator('.policy-pool-management > summary').click();
  await page.getByLabel('팀 자격 검색').fill('평가 흐름 체험');
  await page.getByRole('button', { name: '검색 결과 전체 선택' }).click();
  await page.getByRole('button', { name: '팀 목록 변경 확인' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '설정 저장' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('조직 검색').fill('Photo 공정 검증 상세 조직');
  await page.getByRole('treeitem').filter({ hasText: 'Photo 공정 검증 상세 조직' }).click();
  await page.getByLabel('조직 설명').fill('상황 대응 능력 검증 조직');
  await page.getByLabel('담당 업무').fill('설비 정보와 결과 기록 검토');
  await page.getByLabel('필수 자격 선정을 완료합니다').check();
  await page.getByRole('checkbox', { name: /평가 흐름 체험 · v1/ }).check();
  await page.getByRole('button', { name: '조직 설정 변경 확인' }).click();
  await expect(page.getByRole('dialog')).toContainText('구성원 1명');
  await page.getByRole('dialog').getByRole('button', { name: '설정 저장' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await responsive(page, 'organization-policy');
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: '정하린', exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: '대상자에게 요청' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const request = backend.store.snapshot().planningRequests[0]!;
  expect(request.organizationId).toBe(deep.id);
  expect(request.targets).toHaveLength(1);
  await actor(page, 'learner-2');
  await expect(page.getByRole('region', { name: '내 소속 필수 자격' })).toContainText(
    'Photo 공정 검증 상세 조직',
  );
  await completePlan(page, '평가 흐름 체험', false);
  const a = backend.store.snapshot().assignments.find((a) => a.learnerId === 'learner-2')!;
  await expect(page.getByRole('region', { name: '학습 안내' })).toBeVisible();
  await expect(page.getByRole('button', { name: '학습 완료 기록', exact: true })).toHaveCount(0);
  await responsive(page, 'learning-guide');
  for (const e of backend.store.snapshot().enrollments.filter((e) => e.assignmentId === a.id)) {
    const c = backend.store.snapshot().courses.find((c) => c.id === e.courseId)!;
    await page.goto(`/qualifications/${a.id}?course=${c.id}`);
    await page.getByRole('link', { name: '평가하기', exact: true }).click();
    await expect(page.locator('.assessment-grid')).toBeVisible();
    for (const kind of c.assessmentKinds) {
      await page.goto(`/qualifications/${a.id}/courses/${c.id}/${kind}`);
      const qs = kind === 'objective' ? c.questions : c.practicalQuestions,
        tabs = page.getByRole('tablist', { name: '응시 문항', exact: true });
      for (const [i, q] of qs.entries()) {
        await tabs.getByRole('tab').nth(i).click();
        await page.getByRole('radio').nth(q.correct!).check();
      }
      await page.getByRole('button', { name: '제출', exact: true }).click();
      await expect(page.getByTestId('process-guide')).toContainText(
        '현재 단계 · 제출 전 답안 확인',
      );
      await page.getByRole('button', { name: '최종 제출', exact: true }).click();
      await expect(page.locator('.result-panel')).toContainText('자동 채점');
    }
  }
  await page.getByRole('link', { name: '인증서 보기', exact: true }).click();
  await expect(page.locator('.cert-header')).toContainText('정하린');
  expect(backend.store.snapshot().learningRecords).toHaveLength(0);
  expect(
    backend.store.snapshot().certifications.filter((c) => c.assignmentId === a.id),
  ).toHaveLength(1);
  await page.goto('/');
  await expect(page.getByRole('region', { name: '내 소속 필수 자격' })).toContainText('필수 충족');
  expect(errors).toEqual([]);
});

test('소속 정책 미설정 안내·초안의 기준 변경 경고·입력 보존·삭제 경로', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'learner-2');
  await expect(page.getByRole('region', { name: '내 소속 필수 자격' })).toContainText('미설정');
  await page.goto('/plans');
  await expect(
    page.getByRole('heading', { name: '계획 수립 요청을 기다리고 있습니다.', exact: true }),
  ).toBeVisible();
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await page.getByLabel('취득할 자격').selectOption('demo-qualification');
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await page.getByLabel('목표 인증일', { exact: true }).fill('2027-01-31');
  await expect.poll(() => backend.store.snapshot().plans[0]!.targetOn).toBe('2027-01-31');
  await backend.store.organizations.transact(
    'admin-1',
    crypto.randomUUID(),
    'policy-change',
    () => {},
    (doc) => {
      nodeFor(doc.roots, 'org-photo')!.requiredQualifications = [];
      return {};
    },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('현재 소속 조직의 필수 자격이 아닙니다');
  await expect(page.getByLabel('목표 인증일', { exact: true })).toHaveValue('2027-01-31');
  await page.goto('/plans');
  await page.getByRole('button', { name: '평가 흐름 체험 계획 삭제', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '계획 삭제', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(backend.store.snapshot().plans[0]!.deletedAt).toBeTruthy();
});

test('모든 페이지군·편집/조회/종료 화면에 절차 설명과 정적 AI 검수 안내', async ({
  page,
  backend,
}) => {
  test.setTimeout(90000);
  await page.goto('/');
  await expect(page.getByTestId('process-guide')).toContainText('계정 접속');
  const cases: [string, string[]][] = [
    [
      'learner-1',
      [
        '/',
        '/notifications',
        '/plans',
        '/qualifications',
        '/qualifications/assignment-1',
        '/qualifications/assignment-1?stage=assessment',
        '/qualifications/assignment-1/courses/demo-course-2/objective',
        '/qualifications/missing',
        '/certifications/missing',
        '/completions/missing',
        '/evaluations',
        '/qualifications/assignment-1/courses/demo-course-2/subjective',
      ],
    ],
    [
      'admin-1',
      [
        '/admin/policies',
        '/admin/qualifications',
        '/admin/qualifications/demo-qualification',
        '/admin/courses/demo-course-1',
        '/admin/assignments',
        '/admin/results',
        '/admin/comparisons',
        '/admin/notices',
        '/admin/catalog',
      ],
    ],
    [
      'operator-1',
      ['/system/organizations', '/system/users', '/system/overview', '/system/testing'],
    ],
  ];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [id, paths] of cases) {
    await actor(page, id);
    for (const path of paths) {
      await page.goto(path);
      const guide = page.getByTestId('process-guide');
      await expect(guide.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
      await guide.getByRole('button').click();
      await expect(guide).toContainText('이 화면에서 할 일');
      await expect(guide).toContainText('이후 흐름');
      await expect(guide).toContainText('AI 검수 항목');
      await expect(guide).toContainText('정적 설명');
      expect(
        await guide.evaluate(
          (el) =>
            el.getBoundingClientRect().top >
            document.querySelector('main')!.getBoundingClientRect().top,
        ),
      ).toBeTruthy();
      if (path.includes('demo-course-1')) await expect(guide).toContainText('기준 편집');
    }
  }
  await responsive(page, 'process-explanation');
  expect(errors).toEqual([]);
});
