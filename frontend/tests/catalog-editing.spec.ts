import { test, expect, actor } from './fixtures';
import { courseSection, saveCriterion } from './catalog-helpers';

test('직접 편집·자동 버전·선택 버전 삭제와 삭제된 기준 조회', async ({ page, backend }) => {
  const original = backend.store.snapshot();
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification');
  await expect(page.getByLabel('자격명', { exact: true })).toBeEnabled();
  await page.getByLabel('자격명', { exact: true }).fill('수정한 자격 기준');
  await saveCriterion(page);
  await expect
    .poll(
      () =>
        backend.store.snapshot().qualifications.find((q) => q.parentId === 'demo-qualification')
          ?.title,
    )
    .toBe('수정한 자격 기준');
  expect(
    backend.store.snapshot().qualifications.find((q) => q.id === 'demo-qualification'),
  ).toEqual(original.qualifications.find((q) => q.id === 'demo-qualification'));
  await page.goto('/admin/qualifications/demo-qualification');
  await page.getByRole('button', { name: '자격 삭제', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('기존 기록의 기준은 보존');
  await dialog.getByLabel('삭제 사유').fill('이전 자격 기준 목록 정리');
  await dialog.getByRole('button', { name: '선택 버전 삭제' }).click();
  await expect(page.getByRole('heading', { name: '자격 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '필수 인증Set' })).toHaveCount(0);
  await page.getByLabel('상태 필터').selectOption('deleted');
  await expect(page.getByRole('link', { name: '평가 흐름 체험', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '평가 흐름 체험', exact: true }).click();
  await expect(page.getByLabel('자격명', { exact: true })).toBeDisabled();
  await expect(page.getByText('삭제된 항목 · 이전 자격 기준 목록 정리')).toBeVisible();
  expect(backend.store.snapshot().courses).toEqual(original.courses);
  expect(backend.store.snapshot().assignments).toEqual(original.assignments);
});

test('미참조 삭제 실패 입력 보존과 재시도·완전 제거', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications');
  await page.getByRole('button', { name: '새 자격 만들기', exact: true }).click();
  await expect(page.getByLabel('자격명', { exact: true })).toBeVisible();
  const id = page.url().split('/').at(-1)!.split('?')[0]!;
  await page.getByRole('button', { name: '자격 삭제', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('백업 후 제거');
  await dialog.getByLabel('삭제 사유').fill('미사용 자격 정리');
  await page.route('**/api/qualifications/*', (r) =>
    r.request().method() === 'DELETE' ? r.abort() : r.continue(),
  );
  await dialog.getByRole('button', { name: '선택 버전 삭제' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('삭제 사유')).toHaveValue('미사용 자격 정리');
  await page.unroute('**/api/qualifications/*');
  await dialog.getByRole('button', { name: '선택 버전 삭제' }).click();
  await expect
    .poll(() => backend.store.snapshot().qualifications.some((q) => q.id === id))
    .toBe(false);
});

test('연결된 세로 편집 영역·키보드와 반응형에서 이름/번호 탐색을 구분한다', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  const tabs = page.getByRole('tablist', { name: '인증Set 편집 항목', exact: true });
  await expect(tabs).toHaveAttribute('aria-orientation', 'vertical');
  await tabs.getByRole('tab', { name: '기본정보', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(tabs.getByRole('tab', { name: '학습자료', exact: true })).toBeFocused();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await courseSection(page, '지식 평가');
    await page.getByLabel('문항', { exact: true }).fill('긴 문항과 선택지의 배치 확인 · 지식 기준');
    await courseSection(page, '학습 항목');
    await courseSection(page, '지식 평가');
    await expect(page.getByLabel('문항', { exact: true })).toHaveValue(
      '긴 문항과 선택지의 배치 확인 · 지식 기준',
    );
    await expect(
      page
        .getByRole('tablist', { name: '객관식 · 지식 평가 문항', exact: true })
        .getByRole('tab')
        .first(),
    ).toHaveText('1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`vertical-${width}.png`), fullPage: true });
  }
});
