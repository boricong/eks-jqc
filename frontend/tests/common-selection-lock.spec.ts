import { test, expect, actor } from './fixtures';
import { CourseContentSchema, CourseSchema } from '@eks/contracts';
import { saveCommonCourse } from '../../server/src/common-courses';
import { saveTemplate } from '../../server/src/qualification-templates';
import { executeWorkflow } from '../../server/src/workflow';
import { userView } from '../../server/src/organizations';
import { registerFixtureQualification } from '../../server/tests/template-helpers';
import { saveCriterion } from './catalog-helpers';

for (const type of ['auditee', 'auditor'] as const) {
  test(`${type} 사전 공통은 필수 적용으로 잠그고 특화 추가·제거와 운영자 관리를 유지한다`, async ({
    page,
    backend,
  }, info) => {
    const result = await backend.store.transact(
      'operator-1',
      crypto.randomUUID(),
      crypto.randomUUID(),
      () => {},
      (s) => {
        const content = CourseContentSchema.parse(s.courses[0]);
        content.qualificationType = type;
        content.title = '사전 적용 공통 기준';
        if (type === 'auditor') {
          content.assessmentKinds = [];
          content.questions = [];
          content.practicalQuestions = [];
          content.passScore = content.practicalPassScore = null;
          content.subjectiveEnabled = false;
          content.subjectiveQuestions = [];
        }
        content.learningItems = [
          { id: 'required-learning', title: '필수 교육', type: 'ojt', required: true },
        ];
        const common = saveCommonCourse(s, 'operator-1', undefined, content);
        saveCommonCourse(s, 'operator-1', undefined, { ...content, title: '추가 불가 공통 후보' });
        const template = saveTemplate(s, 'operator-1', undefined, {
          title: '공통 잠금 자격',
          englishName: 'Common Lock Qualification',
          qualificationType: type,
          ...(type === 'auditor' ? { auditorLevel: 'general' } : {}),
          defaultCommonCourseIds: [common.id],
          commonCourseRevisions: { [common.id]: common.revision },
        });
        const imported = executeWorkflow(
          s,
          userView(
            s.users.find((u) => u.id === 'operator-1')!,
            backend.store.organizations.snapshot(),
          ),
          'template.import',
          '',
          {
            templateIds: [template.id],
            qualificationType: type,
            templateRevisions: { [template.id]: template.revision },
            commonCourseRevisions: { [common.id]: common.revision },
          },
          backend.store.organizations.snapshot(),
          'org-photo',
        ) as { imported: string[] };
        s.courses.push(
          CourseSchema.parse({
            ...s.courses[0],
            ...content,
            id: 'specialized-candidate',
            entityId: 'specialized-candidate',
            title: '팀 특화 기준',
            category: 'specialized',
            commonCourseSource: undefined,
          }),
        );
        return { id: imported.imported[0]! };
      },
    );
    const before = backend.store.snapshot();
    const original = before.qualifications.find((q) => q.id === result.id)!;
    const commonId = original.courseIds[0]!;
    await page.goto('/');
    await actor(page, 'admin-1');
    await page.goto(`/admin/qualifications/${original.id}/edit`);
    const common = page.locator(`[data-course-id="${commonId}"]`);
    const infoRegion = page.getByRole('region', { name: '공통 정보', exact: true });
    await expect(infoRegion.locator('dt')).toHaveText(['자격명']);
    await expect(infoRegion.locator('dd')).toHaveText('공통 잠금 자격 · Common Lock Qualification');
    await expect(page.locator('.page-heading .small-label')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '자격 삭제', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('필수 인증Set 검색')).toHaveCount(0);
    await expect(page.locator('.course-selection-search')).toHaveCount(0);
    await expect(page.locator('.actionbar > .muted')).toHaveCount(0);
    const versions = page.getByRole('region', { name: '버전 정보', exact: true });
    await expect(versions).toContainText(original.version === null ? '최초 설정 전' : 'v1.0');
    await expect(versions).toContainText('기본자격 수정 번호');
    expect(
      await versions.evaluate(
        (el) =>
          !!(
            el.compareDocumentPosition(document.querySelector('.team-qualification-detail')!) &
            Node.DOCUMENT_POSITION_PRECEDING
          ),
      ),
    ).toBe(true);
    const add = page.getByRole('button', { name: '새 특화인증Set 등록', exact: true });
    const addHeading = add.locator('..');
    await expect(
      addHeading.getByRole('heading', { name: '적용 특화인증Set', exact: true }),
    ).toBeVisible();
    await expect(common.locator('.course-category')).toHaveText('공통');
    await expect(
      page.locator('[data-course-id="specialized-candidate"] .course-category'),
    ).toHaveText('특화');
    for (const width of [1920, 1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (width >= 768) {
        const headingBox = await addHeading.getByRole('heading').boundingBox();
        const buttonBox = await add.boundingBox();
        expect(
          Math.abs(headingBox!.y + headingBox!.height / 2 - buttonBox!.y - buttonBox!.height / 2),
        ).toBeLessThan(2);
      }
      await expect(common.getByRole('checkbox')).toBeChecked();
      await expect(common.getByRole('checkbox')).toBeDisabled();
      await expect(common).toContainText('필수 적용');
      await expect(common.getByRole('button', { name: /자격에서 제거/ })).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: '추가할 공통인증Set', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('checkbox', { name: '추가 불가 공통 후보', exact: true }),
      ).toBeDisabled();
      await expect(page.getByRole('heading', { name: '공통인증Set', exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`common-locked-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('dialog', { name: '새 특화인증Set 등록', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(add).toBeFocused();
    expect(backend.store.snapshot()).toEqual(before);
    const specialized = page
      .locator('[data-course-id="specialized-candidate"]')
      .getByRole('checkbox');
    await specialized.focus();
    await page.keyboard.press('Space');
    await expect(specialized).toBeChecked();
    await page.getByLabel('인증기간', { exact: true }).selectOption('unlimited');
    if (type === 'auditee') {
      await page.getByRole('button', { name: '최초 설정 저장', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: '기준 저장 확인', exact: true });
      await confirm
        .locator('.dialog-footer')
        .getByRole('button', { name: 'v1.0으로 최초 설정 저장', exact: true })
        .click();
    } else await saveCriterion(page);
    await expect(page).toHaveURL(/\/admin\/qualifications(?:\?|$)/);
    let latest = backend.store
      .snapshot()
      .qualifications.filter((q) => q.entityId === original.entityId)
      .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]!;
    expect(latest.courseIds).toContain(commonId);
    expect(latest.courseIds).toContain('specialized-candidate');
    await page.goto(`/admin/qualifications/${latest.id}/edit`);
    await page
      .locator('[data-course-id="specialized-candidate"]')
      .getByRole('button', { name: /자격에서 제거/ })
      .click();
    await expect(common.getByRole('checkbox')).toBeChecked();
    await expect(common.getByRole('checkbox')).toBeDisabled();
    await saveCriterion(page);
    await expect(page).toHaveURL(/\/admin\/qualifications(?:\?|$)/);
    latest = backend.store
      .snapshot()
      .qualifications.filter((q) => q.entityId === original.entityId)
      .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]!;
    expect(latest.courseIds).toEqual([commonId]);
    expect(backend.store.snapshot().assignments).toEqual(before.assignments);
    expect(backend.store.snapshot().certifications).toEqual(before.certifications);
    await page.goto(`/admin/qualifications/${latest.id}/edit`);
    await page.reload();
    await expect(common.getByRole('checkbox')).toBeDisabled();
    await actor(page, 'operator-1');
    await page.goto(`/admin/qualifications/${latest.id}/edit?lv1OrganizationId=org-photo`);
    await expect(common.getByRole('checkbox')).toBeEnabled();
    await expect(common.getByRole('button', { name: /자격에서 제거/ })).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: '추가 불가 공통 후보', exact: true }),
    ).toBeEnabled();
    await actor(page, 'admin-1');
    await page.goto(`/admin/courses?type=${type}`);
    await expect(
      page.getByRole('row').filter({ hasText: '팀 특화 기준' }).locator('.course-category'),
    ).toHaveText('특화');
  });
}

test('공통 미등록 Ready에서도 같은 유형의 공통 목록과 내용을 조회하며 선택·저장은 바꾸지 않는다', async ({
  page,
  backend,
}, info) => {
  const q = await registerFixtureQualification(backend.store, '공통 미등록 자격');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      const content = CourseContentSchema.parse(s.courses[0]);
      saveCommonCourse(s, 'operator-1', undefined, { ...content, title: '미적용 공통 조회' });
      saveCommonCourse(s, 'operator-1', undefined, {
        ...content,
        title: '보완 중 공통 조회',
        questions: [],
      });
      return {};
    },
  );
  const before = backend.store.snapshot();
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(`/admin/qualifications/${q.id}/edit`);
  await expect(page.getByRole('heading', { name: '공통인증Set', exact: true })).toBeVisible();
  const check = page.getByRole('checkbox', { name: '미적용 공통 조회', exact: true });
  await expect(check).toBeVisible();
  await expect(check).toBeDisabled();
  await expect(check).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: '보완 중 공통 조회', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: '미적용 공통 조회 공통 원본 내용 조회', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '인증Set 내용 조회', exact: true });
  await expect(dialog).toContainText('미적용 공통 조회');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('필수 인증Set 검색')).toHaveCount(0);
  await expect(check).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: '보완 중 공통 조회', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('unapplied-common-list.png'), fullPage: true });
  await page.reload();
  await expect(check).toBeDisabled();
  expect(backend.store.snapshot()).toEqual(before);
});
