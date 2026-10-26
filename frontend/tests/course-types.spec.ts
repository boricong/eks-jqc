import { registerAuditorFromPool } from './auditor-helpers';
import { test, expect, actor, answerConfirmation } from './fixtures';
import { createCourse, saveCriterion } from './catalog-helpers';
import { addQualification } from '../../server/tests/dashboard-fixtures';
import { writeFile } from 'node:fs/promises';
async function criteriaFixture(backend: any) {
  return backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'criteria types fixture',
    () => {},
    (state: any) => {
      const q = addQualification(
        { state, orgs: backend.store.organizations.snapshot() },
        'auditor-criteria',
        {
          qualificationType: 'auditor',
          title: '협력업체 심사 기준 ' + '긴 이름 '.repeat(10),
        },
      );
      state.courses.find((c: any) => c.id === q.courseIds[0]).title = 'Auditor 심사 자료';
      return { id: q.id, courseId: q.courseIds[0] };
    },
  );
}
test('유형별 목록·생성 취소·유형 변경 저장과 주소/검색/상태 보존', async ({ page, backend }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses');
  const tabs = page.getByRole('tablist', { name: '기준 인증 유형' });
  await expect(tabs.getByRole('tab', { name: 'Auditee(피심사자)', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByLabel('인증Set 설정 검색').fill('자료');
  await page.getByLabel('상태 필터').selectOption('all');
  await page.getByLabel('목록 정렬').selectOption('desc');
  await tabs.getByRole('tab', { name: 'Auditee(피심사자)', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/type=auditor/);
  await expect(page.getByLabel('인증Set 설정 검색')).toHaveValue('');
  await expect(page.getByLabel('목록 정렬')).toHaveValue('original');
  await expect(page.getByText('Auditor 인증Set이 없습니다.', { exact: false })).toBeVisible();
  const before = backend.store.snapshot();
  await page.getByRole('button', { name: 'Auditor 특화인증Set 추가', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Auditor 특화인증Set 만들기', exact: true });
  await expect(modal.getByRole('button', { name: '생성 후 편집' })).toBeDisabled();
  await modal.getByLabel('인증Set명', { exact: true }).fill('취소할 초안');
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  expect(backend.store.snapshot()).toEqual(before);
  await createCourse(page, 'Auditor', '새 심사 기준');
  await expect(page.getByLabel('인증 유형', { exact: true })).toHaveValue('auditor');
  await page.getByLabel('인증 유형', { exact: true }).selectOption('auditee');
  await page.locator('.back-link').click();
  await answerConfirmation(page, false);
  await expect(page.getByLabel('인증 유형', { exact: true })).toHaveValue('auditee');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  const review = page.getByRole('dialog', { name: '기준 저장 확인' });
  await expect(review).toContainText('인증 유형');
  await expect(review).toContainText('Auditor');
  await expect(review).toContainText('Auditee');
  await review.getByRole('button', { name: '저장 확인', exact: true }).click();
  await expect(page).not.toHaveURL(/type=auditor/);
  await expect(page.getByLabel('인증Set 설정 검색')).toHaveValue('자료');
  await expect(page.getByLabel('목록 정렬')).toHaveValue('desc');
  await page.getByTestId('saved-course-link').click();
  await expect(page.getByLabel('인증 유형', { exact: true })).toHaveValue('auditee');
  await page.locator('.back-link').click();
  await tabs.getByRole('tab', { name: 'Auditor(심사자)', exact: true }).click();
  await expect(tabs.getByRole('tab', { name: 'Auditor(심사자)', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByLabel('인증Set 설정 검색').fill('심사');
  await page.getByRole('link', { name: '팀 자격 설정', exact: true }).click();
  await expect(page).toHaveURL(/qualifications.*type=auditor/);
  await expect(page.getByRole('button', { name: '팀 적용', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: '일반·메인 자격과 지정 안내 관리', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: '팀 적용', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '인증Set 설정', exact: true }).click();
  await expect(page).toHaveURL(/courses.*type=auditor/);
  await expect(page.getByLabel('인증Set 설정 검색')).toHaveValue('심사');
  await page.reload();
  await expect(page.getByLabel('인증Set 설정 검색')).toHaveValue('심사');
  await page.goto('/admin/courses?type=unknown');
  await expect(page).not.toHaveURL(/type=/);
  expect(errors).toEqual([]);
});
test('팀 기준의 동일 유형 인증Set만 선택·조회하고 Auditor 작업 공간과 잠금 사유를 표시한다', async ({
  page,
  backend,
}, testInfo) => {
  const ids = await criteriaFixture(backend);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(`/admin/qualifications/${ids.id}?type=auditee`);
  await expect(page).toHaveURL(/type=auditor/);
  await expect(page.getByRole('checkbox', { name: /Auditor 심사 자료/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /실무 수행|자료 확인/ })).toHaveCount(0);
  await page
    .getByRole('button', { name: /Auditor 심사 자료.*내용 조회$/ })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toContainText('Auditor 심사 자료');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '인증Set 설정', exact: true }).click();
  const before = backend.store.snapshot();
  const measurements: unknown[] = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const tab = page.getByRole('tab', { name: 'Auditor(심사자)', exact: true });
    const height = (await tab.boundingBox())!.height;
    expect(height).toBeGreaterThanOrEqual(44);
    await tab.focus();
    await tab.press('End');
    await expect(tab).toBeFocused();
    const colors = await tab.evaluate((el) => {
      const st = getComputedStyle(el);
      const lum = (s: string) =>
        s
          .match(/[\d.]+/g)!
          .map(Number)
          .slice(0, 3)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const contrast = (a: string, b: string) =>
        (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      return {
        text: contrast(st.color, st.backgroundColor),
        indicator: contrast(st.borderBottomColor, st.backgroundColor),
        focus: contrast(st.outlineColor, st.backgroundColor),
        outlineOffset: st.outlineOffset,
      };
    });
    expect(colors.text).toBeGreaterThanOrEqual(4.5);
    expect(colors.indicator).toBeGreaterThanOrEqual(3);
    expect(colors.focus).toBeGreaterThanOrEqual(3);
    expect(colors.outlineOffset).toBe('-2px');
    measurements.push({ width, height, horizontalOverflow: false, ...colors });
    await page.screenshot({
      path: testInfo.outputPath(`criteria-courses-${width}.png`),
      fullPage: true,
    });
    await page.goto(`/admin/qualifications?type=auditor`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`criteria-qualifications-${width}.png`),
      fullPage: true,
    });
    await page.goto(`/admin/courses?type=auditor`);
  }
  await page.getByRole('link', { name: 'Auditor 심사 자료', exact: true }).click();
  await expect(page.getByLabel('인증 유형', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('자격 연결 또는 학습·평가 이력이 있어 유형을 변경할 수 없습니다.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(backend.store.snapshot()).toEqual(before);
  await writeFile(
    testInfo.outputPath('criteria-measurements.json'),
    JSON.stringify(measurements, null, 2),
  );
});
test('Auditor는 풀에서 팀 자격을 등록하고 Auditee 등록 모달·계정 전환은 유지한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/admin/qualifications?lv1OrganizationId=org-photo&type=auditor');
  await expect(page.getByRole('button', { name: 'Auditor 자격 등록', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: '일반·메인 자격과 지정 안내 관리', exact: true }),
  ).toHaveCount(0);
  await registerAuditorFromPool(page, '풀 등록 일반 Auditor');
  expect(
    backend.store.snapshot().qualifications.find((q) => q.title === '풀 등록 일반 Auditor')!
      .lifecycleStatus,
  ).toBe('Hold');
  await page.goto('/admin/qualifications?lv1OrganizationId=org-photo&type=auditor');
  await page.getByRole('tab', { name: 'Auditee(피심사자)', exact: true }).click();
  await page.getByRole('button', { name: 'Auditee 자격 등록', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('checkbox').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications');
  await expect(page.getByRole('tab', { name: 'Auditee(피심사자)', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('생성 실패 재시도와 검토 이후 연결 충돌은 입력·유형 선택을 유지한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses');
  const count = backend.store.snapshot().courses.length;
  await page.route(/\/api\/courses\?/, async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'TEMPORARY_ERROR', message: '일시적인 저장 오류' }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Auditee 특화인증Set 추가', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Auditee 특화인증Set 만들기', exact: true });
  await modal.getByLabel('인증Set명', { exact: true }).fill('입력 보존 인증Set');
  await modal.getByRole('button', { name: '생성 후 편집' }).click();
  await expect(modal.getByRole('alert')).toContainText('일시적인 저장 오류');
  await expect(modal.getByLabel('인증Set명', { exact: true })).toHaveValue('입력 보존 인증Set');
  expect(backend.store.snapshot().courses).toHaveLength(count);
  await page.unrouteAll({ behavior: 'wait' });
  await modal.getByRole('button', { name: '생성 후 편집' }).click();
  await expect(modal).not.toBeVisible();
  await page.getByLabel('인증 유형', { exact: true }).selectOption('auditor');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  const review = page.getByRole('dialog', { name: '기준 저장 확인', exact: true });
  await expect(review).toBeVisible();
  const id = page.url().match(/\/courses\/([^?]+)/)![1]!;
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'fixture late link',
    () => {},
    (s) => {
      addQualification({ state: s, orgs: backend.store.organizations.snapshot() }, 'late-link', {
        courseIds: [id],
      });
      return {};
    },
  );
  await review.getByRole('button', { name: '저장 확인', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('다시 검토');
  await review.getByRole('button', { name: '계속 편집', exact: true }).click();
  await expect(page.getByLabel('인증 유형', { exact: true })).toHaveValue('auditor');
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('입력 보존 인증Set');
  expect(backend.store.snapshot().courses.find((c) => c.id === id)!.qualificationType).toBe(
    'auditee',
  );
});
