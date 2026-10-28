import { reviewQualificationDeletion } from './catalog-helpers';
import { test, expect, actor } from './fixtures';
import { CourseContentSchema } from '@eks/contracts';
import { saveCommonCourse } from '../../server/src/common-courses';
import { saveTemplate } from '../../server/src/qualification-templates';
import { executeWorkflow } from '../../server/src/workflow';
import { userView } from '../../server/src/organizations';

for (const type of ['auditee', 'auditor'] as const) {
  test(`${type} 빈 공통 등록→삭제→기본 공통3개 지정→재등록 직후 필수 적용`, async ({
    page,
    backend,
  }, info) => {
    const fixture = await backend.store.transact(
      'operator-1',
      crypto.randomUUID(),
      crypto.randomUUID(),
      () => {},
      (s) => {
        const content = CourseContentSchema.parse(s.courses[0]);
        content.qualificationType = type;
        if (type === 'auditor') {
          content.assessmentKinds = [];
          content.questions = [];
          content.practicalQuestions = [];
          content.passScore = content.practicalPassScore = null;
          content.subjectiveEnabled = false;
          content.subjectiveQuestions = [];
        }
        content.learningItems = [
          { id: 'registration-training', title: '필수 교육', type: 'ojt', required: true },
        ];
        const commons = [1, 2, 3].map((i) =>
          saveCommonCourse(s, 'operator-1', undefined, {
            ...content,
            title: `등록 필수 공통 ${i}`,
          }),
        );
        const template = saveTemplate(s, 'operator-1', undefined, {
          title: '필수 공통 재등록 자격',
          englishName: 'Reregistration',
          qualificationType: type,
          ...(type === 'auditor' ? { auditorLevel: 'general' } : {}),
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
          },
          backend.store.organizations.snapshot(),
          'org-photo',
        ) as { imported: string[] };
        return {
          id: imported.imported[0]!,
          templateId: template.id,
          commonIds: commons.map((c) => c.id),
        };
      },
    );
    await page.goto('/');
    await actor(page, 'admin-1');
    await page.goto(`/admin/qualifications/${fixture.id}/edit`);
    await expect(
      page.getByRole('checkbox', { name: '등록 필수 공통 1', exact: true }),
    ).not.toBeChecked();
    await reviewQualificationDeletion(page, fixture.id);
    const removal = page.getByRole('dialog');
    await removal.getByLabel('삭제 사유').fill('기본 공통 추가 후 재등록 확인');
    await removal.getByRole('button', { name: '선택 버전 삭제', exact: true }).click();
    await expect(removal).not.toBeVisible();
    await expect(page).toHaveURL(/\/admin\/qualifications(?:\?|$)/);
    const deleted = backend.store.snapshot().qualifications.find((q) => q.id === fixture.id)!;
    await backend.store.transact(
      'operator-1',
      crypto.randomUUID(),
      crypto.randomUUID(),
      () => {},
      (s) => {
        const template = s.qualificationTemplates.find((t) => t.id === fixture.templateId)!;
        saveTemplate(s, 'operator-1', template.id, {
          title: template.title,
          englishName: template.englishName,
          qualificationType: type,
          revision: template.revision,
          defaultCommonCourseIds: fixture.commonIds,
          commonCourseRevisions: Object.fromEntries(s.commonCourses.map((c) => [c.id, c.revision])),
        });
        return {};
      },
    );
    await page
      .getByRole('button', {
        name: `${type === 'auditee' ? 'Auditee' : 'Auditor'} 자격 등록`,
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('공통인증Set 3개');
    await dialog.getByRole('checkbox', { name: /필수 공통 재등록 자격/ }).check();
    await dialog.getByRole('button', { name: '팀 자격 등록', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const s = backend.store.snapshot(),
      q = s.qualifications.find((q) => q.templateId === fixture.templateId && !q.deletedAt)!;
    expect(q.courseIds).toHaveLength(3);
    expect(q.commonCourseEntityIds).toHaveLength(3);
    expect(q.entityId).toBe(deleted.entityId);
    expect(s.qualifications.find((q) => q.id === fixture.id)).toEqual(deleted);
    await page.goto(`/admin/qualifications/${q.id}/edit`);
    await expect(page.getByText('적용된 공통인증Set이 없습니다.', { exact: true })).toHaveCount(0);
    for (let i = 1; i <= 3; i++) {
      const check = page.getByRole('checkbox', { name: `등록 필수 공통 ${i}`, exact: true });
      await expect(check).toBeChecked();
      await expect(check).toBeDisabled();
    }
    await page.screenshot({ path: info.outputPath(`reregistered-${type}.png`), fullPage: true });
  });
}
