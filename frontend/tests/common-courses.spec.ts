import { saveCommonCourse } from '../../server/src/common-courses';
import { test, expect, actor, answerConfirmation } from './fixtures';
import { courseSection, saveCriterion } from './catalog-helpers';
import { CourseContentSchema } from '@eks/contracts';
async function systemCourse(page: any, type: 'auditee' | 'auditor', title: string) {
  await page.goto('/system/common-courses');
  await page.getByRole('button', { name: '새 공통인증Set 만들기', exact: true }).click();
  await page.getByLabel('인증Set명', { exact: true }).fill(title);
  await page.getByLabel('인증 유형', { exact: true }).selectOption(type);
  await courseSection(page, '학습 정보');
  await page.getByRole('button', { name: '교육 추가', exact: true }).click();
  await page.getByLabel('교육명', { exact: true }).fill('공통 필수 교육 확인');
  await page.getByRole('button', { name: '공통인증Set 저장', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(page.getByRole('heading', { name: '공통인증Set 관리', exact: true })).toBeVisible();
}
for (const type of ['auditee', 'auditor'] as const) {
  test(`${type} 공통 생성→기본 목록→팀 등록·수정·제외와 화면 폭`, async ({
    page,
    backend,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await actor(page, 'operator-1');
    const title = type === 'auditee' ? '공통 현장 교육' : '공통 심사 교육';
    await systemCourse(page, type, title);
    if (type === 'auditee')
      await backend.store.transact(
        'operator-1',
        crypto.randomUUID(),
        'complete-common',
        () => {},
        (s) => {
          const c = s.commonCourses[0]!;
          saveCommonCourse(s, 'operator-1', c.id, {
            ...CourseContentSchema.parse(s.courses[0]),
            title: c.title,
            learningItems: c.learningItems,
            revision: c.revision,
          });
          return {};
        },
      );
    await page.goto('/system/qualification-templates');
    await page.getByRole('button', { name: '새 기본자격 만들기', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '기본자격 편집', exact: true });
    await dialog.getByLabel('인증 유형', { exact: true }).selectOption(type);
    if (type === 'auditor')
      await dialog.getByLabel('Auditor 등급', { exact: true }).selectOption('general');
    await dialog.getByLabel('기본자격명', { exact: true }).fill('공통 연계 ' + type);
    await dialog.getByRole('checkbox', { name: new RegExp(title) }).check();
    await dialog.getByRole('button', { name: '내용 보기', exact: true }).click();
    await expect(
      page
        .getByRole('dialog', { name: '인증Set 내용 조회', exact: true })
        .getByText('공통 필수 교육 확인', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('dialog', { name: '인증Set 내용 조회', exact: true })
      .getByRole('button', { name: '확인', exact: true })
      .click();
    await dialog.getByRole('button', { name: '기본자격 저장', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await actor(page, 'admin-1');
    await page.goto(`/admin/qualifications?type=${type}`);
    await page
      .getByRole('button', {
        name: `${type === 'auditee' ? 'Auditee' : 'Auditor'} 자격 등록`,
        exact: true,
      })
      .click();
    const register = page.getByRole('dialog');
    await register.getByRole('checkbox', { name: new RegExp('공통 연계 ' + type) }).check();
    await expect(register.getByText(new RegExp(`공통인증Set 1개: ${title}`))).toBeVisible();
    await register.getByRole('button', { name: '팀 자격 등록', exact: true }).click();
    await expect(register).not.toBeVisible();
    const q = backend.store.snapshot().qualifications.find((q) => q.title === '공통 연계 ' + type)!;
    await page.goto(`/admin/qualifications/${q.id}/edit?type=${type}`);
    const save = page.getByRole('button', { name: /^(최초 설정 저장|저장)$/, exact: true });
    await expect(save).toBeDisabled();
    await expect(page.locator('.actionbar')).toContainText(
      '인증기간을 기간제 또는 무기한으로 지정해 주세요.',
    );
    await page.getByLabel('인증기간', { exact: true }).selectOption('months');
    await expect(save).toBeDisabled();
    await expect(page.locator('.actionbar')).toContainText('유효 개월 수를 지정해 주세요.');
    await page.getByLabel('유효 개월 수', { exact: true }).fill('24');
    await expect(save).toBeEnabled();
    await page.getByLabel('인증기간', { exact: true }).selectOption('unlimited');
    await expect(save).toBeEnabled();
    await expect(
      page.getByRole('heading', { name: '추가할 공통인증Set', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '추가할 특화인증Set', exact: true }),
    ).toBeVisible();
    for (const width of [1920, 1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath(`team-${type}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1920, height: 1000 });
    if (type === 'auditee') {
      await page.getByRole('button', { name: '최초 설정 저장', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: '기준 저장 확인', exact: true });
      await expect(
        confirm.getByText('v1.0으로 최초 설정 저장', { exact: true }).last(),
      ).toBeVisible();
      await confirm
        .locator('.dialog-footer')
        .getByRole('button', { name: 'v1.0으로 최초 설정 저장', exact: true })
        .click();
      await expect
        .poll(() => backend.store.snapshot().qualifications.find((x) => x.id === q.id)!.version)
        .toBe(1);
    }
    if (type === 'auditee') {
      await expect(page).toHaveURL(/\/admin\/qualifications\?/);
      await page.goto(`/admin/qualifications/${q.id}/edit?type=${type}`);
    }
    const checkbox = page.getByRole('checkbox', { name: title, exact: true });
    await checkbox.uncheck();
    await saveCriterion(page);
    await expect
      .poll(
        () =>
          backend.store
            .snapshot()
            .qualifications.filter((x) => x.entityId === q.entityId)
            .sort((a, b) => (b.version || 0) - (a.version || 0))[0]!.courseIds.length,
      )
      .toBe(0);
    const latest = backend.store
      .snapshot()
      .qualifications.filter((x) => x.entityId === q.entityId)
      .sort((a, b) => (b.version || 0) - (a.version || 0))[0]!;
    await page.goto(`/admin/qualifications/${latest.id}/edit?type=${type}`);
    await page.getByRole('checkbox', { name: title, exact: true }).check();
    await saveCriterion(page);
    await expect(page).toHaveURL(/\/admin\/qualifications\?/);
    const copy = backend.store
      .snapshot()
      .courses.find((c) => c.entityId === q.commonCourseEntityIds[0])!;
    await page.goto(`/admin/courses/${copy.id}?type=${type}`);
    await page.getByLabel('인증Set명', { exact: true }).fill(title + ' 팀 보완');
    await saveCriterion(page);
    await expect(page.getByText('공통인증Set · 팀 수정', { exact: true }).first()).toBeVisible();
    expect(backend.store.snapshot().commonCourses[0]!.title).toBe(title);
    await page.getByLabel('인증Set 구분 필터').selectOption('common');
    await expect(page.getByRole('link', { name: title + ' 팀 보완', exact: true })).toBeVisible();
    await page.getByLabel('인증Set 구분 필터').selectOption('specialized');
    await expect(page.getByRole('link', { name: title + ' 팀 보완', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
test('공통 화면의 미저장 보호·원본 변경 비소급·운영 종료 차단', async ({ page, backend }, info) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await systemCourse(page, 'auditor', '안전 공통 교육');
  await page.getByRole('button', { name: '안전 공통 교육', exact: true }).click();
  await page.getByLabel('인증Set명', { exact: true }).fill('미저장');
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('미저장');
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await answerConfirmation(page, true);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`system-common-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByRole('button', { name: '운영 종료', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('변경 사유').fill('새 등록 종료');
  await dialog.getByRole('button', { name: '상태 변경', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(backend.store.snapshot().commonCourses[0]!.operationalStatus).toBe('retired');
  await page.getByLabel('운영 상태', { exact: true }).selectOption('retired');
  await page.getByRole('button', { name: '운영 재개', exact: true }).click();
  await dialog.getByLabel('변경 사유').fill('다시 사용');
  await dialog.getByRole('button', { name: '상태 변경', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
test('공통 원본 저장 충돌과 저장 실패는 입력을 유지하고 최신 내용 비교 후 재시도한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await systemCourse(page, 'auditor', '동시 수정 공통');
  await page.getByRole('button', { name: '동시 수정 공통', exact: true }).click();
  await page.getByLabel('인증Set명', { exact: true }).fill('내가 작성한 공통');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      const c = s.commonCourses[0]!;
      saveCommonCourse(s, 'operator-1', c.id, {
        ...CourseContentSchema.parse(c),
        title: '다른 창의 변경',
        revision: c.revision,
      });
      return {};
    },
  );
  await page.getByRole('button', { name: '공통인증Set 저장', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('다른 창');
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('내가 작성한 공통');
  await page.getByRole('button', { name: '입력 유지·최신 내용 비교', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '최신 공통인증Set 내용', exact: true });
  await expect(dialog.getByLabel('인증Set명', { exact: true })).toHaveValue('다른 창의 변경');
  await dialog.getByRole('button', { name: '작성 내용 유지·다시 검토', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('내가 작성한 공통');
  let first = true;
  await page.route('**/api/system/common-courses/*', async (route) => {
    if (first && route.request().method() === 'PUT') {
      first = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '시험 저장 실패' }),
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '공통인증Set 저장', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(page.getByRole('alert')).toContainText('시험 저장 실패');
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('내가 작성한 공통');
  await page.getByRole('button', { name: '공통인증Set 저장', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(page.getByRole('heading', { name: '공통인증Set 관리', exact: true })).toBeVisible();
  expect(backend.store.snapshot().commonCourses[0]!.title).toBe('내가 작성한 공통');
});
