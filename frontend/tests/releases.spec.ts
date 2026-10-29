import { test, expect, actor, answerConfirmation } from './fixtures';
import { saveCriterion, openSavedCourse } from './catalog-helpers';
import { requestPlan } from './workflow-helpers';
import { saveCatalogItem } from '../../server/src/catalog-editing';
import { saveCommonCourse, copyCommonCourses } from '../../server/src/common-courses';
import { CourseContentSchema } from '@eks/contracts';

test('인증Set 저장·자격 자동 마이너·과거 조회·네 화면 폭', async ({ page, backend }, info) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  await page.getByLabel('인증Set명', { exact: true }).fill('마이너 저장 검증');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '기준 저장 확인' });
  await expect(dialog).toContainText('v1.0 → v1.1');
  await expect(dialog).toContainText('자동 반영:');
  await dialog.getByRole('button', { name: '저장 확인', exact: true }).click();
  await openSavedCourse(page);
  await expect(page.locator('.release-footer')).toContainText('v1.1');
  const s = backend.store.snapshot(),
    head = s.courses.find((c) => c.title === '마이너 저장 검증')!;
  expect(
    s.qualifications.some((q) => q.courseIds.includes(head.id) && q.releaseVersion?.minor === 1),
  ).toBeTruthy();
  await page.goto('/admin/courses/demo-course-1');
  await expect(page.getByLabel('인증Set명', { exact: true })).toBeDisabled();
  await expect(page.locator('.release-footer')).toContainText('v1.0');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`release-${width}.png`), fullPage: true });
  }
});

test('계획 초안은 최신 기준을 재확인하고 확정 후 변경에도 버전을 유지한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await page.locator('.request-schedule-row summary').click();
  await page.getByLabel('학습 목표(선택)', { exact: true }).fill('계속 보존할 목표');
  await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '전체 계획 최종 확인', exact: true }),
  ).toBeVisible();
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'release-change',
    () => {},
    (s) => {
      const c = structuredClone(s.courses[0]!);
      c.title = '새 인증Set 이름';
      return saveCatalogItem(
        s,
        backend.store.organizations.snapshot(),
        'courses',
        c.id,
        c,
        c.lv1OrganizationId,
        'admin-1',
      );
    },
  );
  await page.getByRole('button', { name: '전체 계획 확정', exact: true }).click();
  await expect(page.locator('.request-schedule-criteria')).toBeVisible();
  await page.getByRole('button', { name: '최신 기준 확인', exact: true }).click();
  await answerConfirmation(page, true);
  await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
  await page.getByRole('button', { name: '전체 계획 확정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '전체 계획 확정 완료' })).toBeVisible();
  await page.getByRole('link', { name: '학습·평가로 이동' }).click();
  const a = backend.store.snapshot().assignments.find((a) => a.learnerId === 'learner-2')!,
    frozen = structuredClone(a.frozenCriteria);
  expect(frozen?.qualificationVersion).toEqual({ major: 1, minor: 1 });
  expect(backend.store.snapshot().plans.find((p) => p.assignmentId === a.id)!.goal).toBe(
    '계속 보존할 목표',
  );
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'second-release',
    () => {},
    (s) => {
      const c = structuredClone(s.courses.find((c) => c.id === frozen!.courses[0]!.id)!);
      c.questions[0]!.prompt += ' 새 문항';
      return saveCatalogItem(
        s,
        backend.store.organizations.snapshot(),
        'courses',
        c.id,
        c,
        c.lv1OrganizationId,
        'admin-1',
      );
    },
  );
  await page.reload();
  await expect(page.locator('.release-footer').first()).toContainText('v1.1');
  expect(backend.store.snapshot().assignments.find((v) => v.id === a.id)!.frozenCriteria).toEqual(
    frozen,
  );
});

test('공통 원본 변경의 팀 수정 보류와 비교 후 원본 반영', async ({ page, backend }) => {
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'common-release',
    () => {},
    (s) => {
      const source = saveCommonCourse(
        s,
        'operator-1',
        undefined,
        CourseContentSchema.parse(s.courses[0]),
      );
      const [copy] = copyCommonCourses(s, [source.id], 'org-photo');
      copy!.title = '우리 팀 수정';
      saveCommonCourse(s, 'operator-1', source.id, {
        ...CourseContentSchema.parse(source),
        title: '공통 새 이름',
        revision: source.revision,
      });
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses');
  await page.getByRole('button', { name: /우리 팀 수정.*원본 비교/ }).click();
  const dialog = page.getByRole('dialog', { name: '공통 원본과 팀 내용 비교' });
  await expect(dialog).toContainText('현재 팀 내용');
  await expect(dialog).toContainText('변경된 공통 원본');
  await dialog.getByRole('button', { name: '원본 반영', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(backend.store.snapshot().commonUpdates[0]!.status).toBe('applied');
});
