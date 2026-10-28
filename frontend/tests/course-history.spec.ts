import { test, expect, actor, answerConfirmation } from './fixtures';
import { saveCatalogItem } from '../../server/src/catalog-editing';
import { saveCommonCourse, copyCommonCourses } from '../../server/src/common-courses';
import { CourseContentSchema, CourseSchema } from '@eks/contracts';

async function versions(backend: any) {
  const result = { old: '', latest: '', common: '', draft: '' };
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'history-fixture',
    () => {},
    (s: any) => {
      const old = s.courses[0];
      result.old = old.id;
      old.title = '과거에만 있는 이름 ' + '상세 기준 '.repeat(20);
      result.latest = saveCatalogItem(
        s,
        backend.store.organizations.snapshot(),
        'courses',
        old.id,
        { ...structuredClone(old), title: '최신 특화 기준' },
        'org-photo',
        'admin-1',
      ).id;
      const origin = saveCommonCourse(s, 'operator-1', undefined, {
        ...CourseContentSchema.parse(old),
        title: '공통 원본',
      });
      const copy = copyCommonCourses(s, [origin.id], 'org-photo')[0]!;
      result.common = saveCatalogItem(
        s,
        backend.store.organizations.snapshot(),
        'courses',
        copy.id,
        { ...structuredClone(copy), title: '최신 공통 사본' },
        'org-photo',
        'admin-1',
      ).id;
      const draft = CourseSchema.parse({
        ...structuredClone(old),
        id: 'history-draft-1',
        entityId: 'history-draft',
        version: 1,
        title: '초안 초기 이름',
        questions: [],
        releaseVersion: { major: 0, minor: 1 },
      });
      s.courses.push(draft);
      const second = saveCatalogItem(
        s,
        backend.store.organizations.snapshot(),
        'courses',
        draft.id,
        { ...draft, title: '초안 두 번째 이름' },
        'org-photo',
        'admin-1',
      );
      result.draft = saveCatalogItem(
        s,
        backend.store.organizations.snapshot(),
        'courses',
        second.id,
        { ...structuredClone(second), ...CourseContentSchema.parse(old), title: '최초 완성 기준' },
        'org-photo',
        'admin-1',
      ).id;
      return {};
    },
  );
  return result;
}

test('최신 비삭제 계보를 검색·구분·상태·페이지보다 먼저 추리고 전체 버전은 보존한다', async ({
  page,
  backend,
}) => {
  const ids = await versions(backend);
  const before = backend.store.snapshot();
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses');
  const titles = page.locator('tbody .table-title');
  await expect(titles).toContainText(['최신 특화 기준', '최신 공통 사본', '최초 완성 기준']);
  await expect(page.locator('tbody')).not.toContainText('과거에만 있는 이름');
  await expect(page.locator('tbody')).not.toContainText('초안 두 번째 이름');
  await expect(page.getByRole('row').filter({ hasText: '최초 완성 기준' })).toContainText('v1.0');
  await page.getByLabel('인증Set 설정 검색').fill('과거에만 있는 이름');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByLabel('인증Set 설정 검색').clear();
  await page.getByLabel('인증Set 구분 필터').selectOption('common');
  await expect(titles).toHaveText(['최신 공통 사본']);
  await page.getByLabel('인증Set 구분 필터').selectOption('all');
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'retire-latest',
    () => {},
    (s) => {
      const course = s.courses.find((c) => c.id === ids.latest)!;
      Object.assign(course, {
        operationalStatus: 'retired',
        retiredAt: new Date().toISOString(),
        retiredBy: 'admin-1',
        retirementReason: '최신 상태 시험',
      });
      return {};
    },
  );
  await page.reload();
  await page.getByLabel('상태 필터').selectOption('active');
  await expect(page.locator(`a[href*="/courses/${ids.old}"]`)).toHaveCount(0);
  await expect(page.locator(`a[href*="/courses/${ids.latest}"]`)).toHaveCount(0);
  await page.getByLabel('상태 필터').selectOption('retired');
  await expect(titles).toHaveText(['최신 특화 기준']);
  await page.getByLabel('상태 필터').selectOption('all');
  await page.getByLabel('목록 정렬').selectOption('desc');
  await page.getByLabel('페이지 크기').selectOption('50');
  const after = backend.store.snapshot();
  expect(after.courses).toHaveLength(before.courses.length);
  expect(after.courses.find((c) => c.id === ids.old)).toEqual(
    before.courses.find((c) => c.id === ids.old),
  );
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'pagination',
    () => {},
    (s) => {
      const source = s.courses[0]!;
      for (let i = 0; i < 26; i++)
        s.courses.push({
          ...structuredClone(source),
          id: `history-page-${i}`,
          entityId: `history-page-${i}`,
          version: 1,
          title: `페이지 기준 ${String(i).padStart(2, '0')}`,
        });
      return {};
    },
  );
  await page.reload();
  const total = new Set(before.courses.map((c) => c.entityId)).size + 26;
  await page.getByLabel('페이지 크기').selectOption('25');
  await expect(page.locator('.list-count')).toHaveText(`전체 ${total}개`);
  await expect(titles).toHaveCount(25);
  const firstPage = await titles.allTextContents();
  expect(firstPage).toEqual([...firstPage].sort((a, b) => -a.localeCompare(b, 'ko')));
  await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
  await expect(titles).toHaveCount(total - 25);
});

test('과거 선택은 한 번의 확인으로 입력 폐기·읽기 전용 조회하고 취소·최신 복귀·초점을 보존한다', async ({
  page,
  backend,
}, info) => {
  const ids = await versions(backend),
    state = backend.store.snapshot();
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(`/admin/courses/${ids.latest}`);
  const select = page.getByLabel('조회 버전', { exact: true });
  await expect(select.locator('option')).toHaveCount(2);
  await expect(select.locator('option').first()).toContainText('v1.1 · 최신 특화 기준 · 최신');
  await expect(page.locator('.criterion-versions')).toHaveCount(0);
  await select.selectOption(ids.latest);
  await expect(page.getByTestId('app-confirmation')).not.toBeVisible();
  await page.getByLabel('인증Set명', { exact: true }).fill('저장하지 않은 내용');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '기준 저장 확인', exact: true })).toBeVisible();
  await expect(select).toBeDisabled();
  await page.getByRole('button', { name: '계속 편집', exact: true }).click();
  await select.selectOption(ids.old);
  const confirm = page.getByTestId('app-confirmation');
  await expect(confirm).toContainText('과거 버전 조회 확인');
  await expect(confirm).toContainText('v1.0');
  await expect(confirm).toContainText('저장하지 않은 변경 사항은 버리고');
  await answerConfirmation(page, false);
  await expect(select).toHaveValue(ids.latest);
  await expect(select).toBeFocused();
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('저장하지 않은 내용');
  await select.selectOption(ids.old);
  await confirm.getByRole('button', { name: '조회', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/admin/courses/${ids.old}\\?`));
  await expect(confirm).not.toBeVisible();
  await expect(select).toHaveValue(ids.old);
  await expect(page.getByLabel('인증Set명', { exact: true })).toBeDisabled();
  await expect(page.locator('.course-lifecycle')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '저장', exact: true })).toHaveCount(0);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(select).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`course-history-${width}.png`), fullPage: true });
  }
  await select.selectOption(ids.latest);
  await expect(page).toHaveURL(new RegExp(`/admin/courses/${ids.latest}\\?`));
  await expect(confirm).not.toBeVisible();
  await expect(page.getByLabel('인증Set명', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('최신 특화 기준');
  expect(backend.store.snapshot()).toEqual(state);
  await page.goto(`/admin/courses/${ids.old}`);
  await expect(page.getByLabel('인증Set명', { exact: true })).toBeDisabled();
});

test('과거 조회 확인 중 관리 권한이 회수되면 대기 선택을 적용하지 않는다', async ({
  page,
  backend,
}) => {
  const ids = await versions(backend);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(`/admin/courses/${ids.latest}`);
  await page.getByLabel('조회 버전').selectOption(ids.old);
  await expect(page.getByTestId('app-confirmation')).toBeVisible();
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'revoke-management',
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'admin-1')!.roles = ['learner'];
      return {};
    },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('app-confirmation')).not.toBeVisible();
  await expect(page.getByLabel('조회 버전')).toHaveCount(0);
  expect(new URL(page.url()).pathname).not.toBe(`/admin/courses/${ids.old}`);
});

test('최신 삭제 후 남은 기준을 목록에 표시하고 삭제 이력도 확인 후 읽기 전용으로 조회한다', async ({
  page,
  backend,
}) => {
  const ids = await versions(backend);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(`/admin/courses/${ids.draft}`);
  const remove = async () => {
    await page.getByRole('button', { name: '인증Set 삭제', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '인증Set 삭제 확인', exact: true });
    await dialog.getByLabel('처리 사유').fill('이력 조회 시험');
    await dialog.getByRole('button', { name: '인증Set 삭제 실행', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/courses\?/);
  };
  await remove();
  const current = backend.store
    .snapshot()
    .courses.filter((c) => c.entityId === 'history-draft' && !c.deletedAt)
    .sort((a, b) => b.version - a.version)[0]!;
  await expect(page.getByRole('row').filter({ hasText: '초안 두 번째 이름' })).toContainText(
    'v0.2',
  );
  // Current DELETE removes an unused version; legacy deletion markers remain queryable.
  expect(backend.store.snapshot().courses.some((c) => c.id === ids.draft)).toBe(false);
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'legacy-deleted-version',
    () => {},
    (s) => {
      s.courses.push({
        ...structuredClone(current),
        id: 'history-deleted',
        parentId: undefined,
        version: 99,
        deletedAt: new Date().toISOString(),
        deletedBy: 'admin-1',
        deletionReason: '이전 형식 삭제 표시',
      });
      return {};
    },
  );
  await page.goto(`/admin/courses/${current.id}`);
  await expect(
    page.getByLabel('조회 버전').locator('option[value="history-deleted"]'),
  ).toContainText('삭제됨');
  await page.getByLabel('조회 버전').selectOption('history-deleted');
  await answerConfirmation(page, true);
  await expect(page.locator('.course-lifecycle')).toHaveCount(0);
  await expect(page.getByLabel('인증Set명', { exact: true })).toBeDisabled();
  await page.getByLabel('조회 버전').selectOption(current.id);
  await remove();
  await page.getByRole('link', { name: '초안 초기 이름', exact: true }).click();
  await remove();
  await expect(page.locator('tbody')).not.toContainText('초안 초기 이름');
  await expect(page.locator('tbody')).not.toContainText('최초 완성 기준');
});
