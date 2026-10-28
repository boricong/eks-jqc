import { test, expect, actor, answerConfirmation } from './fixtures';
import { saveCriterion } from './catalog-helpers';
import { registerFixtureQualification } from '../../server/tests/template-helpers';
import { registerAuditorFromPool } from './auditor-helpers';

test('Ready는 최초 설정으로 이동하고 Hold는 조회·변경을 분리하며 Auditor 신규 기준은 학습형을 유지한다', async ({
  page,
  backend,
}) => {
  const ready = await registerFixtureQualification(backend.store, '최초 설정 경로');
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(`/admin/qualifications/${ready.id}`);
  await expect(page).toHaveURL(new RegExp(`${ready.id}/edit`));
  await expect(page.getByLabel('인증기간', { exact: true })).toBeEnabled();
  await registerAuditorFromPool(page, '조회 변경 심사 자격');
  const hold = backend.store
    .snapshot()
    .qualifications.find((q) => q.title === '조회 변경 심사 자격')!;
  await page.goto(`/admin/qualifications/${hold.id}`);
  await expect(page.locator('.team-qualification-view')).toBeVisible();
  await expect(page.getByRole('complementary', { name: /MVP 프로세스 검토/ })).toContainText(
    '저장된 기준 조회',
  );
  await expect(page.locator('.qualification-view-meta')).toContainText('Hold');
  await page.getByRole('link', { name: '변경', exact: true }).click();
  await page.getByRole('button', { name: '새 특화인증Set 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '새 특화인증Set 등록', exact: true });
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByLabel('인증Set명', { exact: true }).fill('Auditor 독립 교육');
  await dialog.getByRole('button', { name: '인증Set 저장 후 추가', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const course = backend.store.snapshot().courses.find((c) => c.title === 'Auditor 독립 교육')!;
  expect(course.qualificationType).toBe('auditor');
  expect(course.assessmentKinds).toEqual([]);
  expect(course.questions).toEqual([]);
  await page.getByLabel('인증기간', { exact: true }).selectOption('unlimited');
  await saveCriterion(page);
  await expect(page).toHaveURL(/\/admin\/qualifications(?:\?|$)/);
  await page.goto(
    `/admin/qualifications/${
      backend.store
        .snapshot()
        .qualifications.filter((q) => q.entityId === hold.entityId)
        .sort((a, b) => (b.version || 0) - (a.version || 0))[0]!.id
    }`,
  );
  await expect(page.locator('.team-qualification-view')).toBeVisible();
  await expect(page.locator('.qualification-view-meta')).toContainText('Hold');
  await actor(page, 'learner-1');
  await page.goto(`/admin/qualifications/${hold.id}/edit`);
  await expect(page.locator('.team-qualification-detail')).toHaveCount(0);
});

test('재인증 신규 기준은 객관식으로 고정하고 무변경 저장은 목록으로 복귀한다', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      const q = structuredClone(s.qualifications.find((q) => q.id === 'demo-qualification')!);
      s.qualificationTemplates.push({
        ...structuredClone(s.qualificationTemplates.find((t) => t.id === q.templateId)!),
        id: 'renewal-template-fixture',
        purpose: 'renewal',
      });
      s.qualifications.push({
        ...q,
        templateId: 'renewal-template-fixture',
        lifecycleStatus: 'Hold',
        id: 'renewal-editor-fixture',
        entityId: 'renewal-editor-fixture',
        purpose: 'renewal',
        courseIds: [],
      });
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/renewal-editor-fixture/edit');
  await page.getByRole('button', { name: '새 특화인증Set 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '새 특화인증Set 등록', exact: true });
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await expect(dialog.getByRole('checkbox')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.goto('/admin/qualifications/demo-qualification/edit');
  const before = backend.store.snapshot();
  // Selection order is semantically unchanged and must not trigger a leave prompt.
  const check = page.locator('[data-course-id="demo-course-1"]').getByRole('checkbox');
  await check.uncheck();
  await check.check();
  await saveCriterion(page);
  await expect(page).toHaveURL(/\/admin\/qualifications(?:\?|$)/);
  expect(backend.store.snapshot()).toEqual(before);
});

test('새 버전이 생긴 편집 초안과 신규 인증Set 작성은 화면 갱신·취소로 유실되지 않는다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification/edit');
  await page.getByLabel('인증기간', { exact: true }).selectOption('months');
  await page.getByLabel('유효 개월 수', { exact: true }).fill('24');
  await page.getByRole('button', { name: '새 특화인증Set 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '새 특화인증Set 등록', exact: true });
  await dialog.getByLabel('인증Set명', { exact: true }).fill('아직 저장하지 않은 기준');
  await page.keyboard.press('Escape');
  await answerConfirmation(page, false);
  await expect(dialog.getByLabel('인증Set명', { exact: true })).toHaveValue(
    '아직 저장하지 않은 기준',
  );
  await page.keyboard.press('Escape');
  await answerConfirmation(page, true);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      s.qualifications.push({
        ...structuredClone(q),
        id: 'concurrent-version',
        parentId: q.id,
        version: 2,
        releaseVersion: { major: 1, minor: 1 },
      });
      return {};
    },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('유효 개월 수', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('유효 개월 수', { exact: true })).toHaveValue('24');
  await page.getByRole('link', { name: '조회', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(page.getByLabel('유효 개월 수', { exact: true })).toHaveValue('24');
  expect(backend.store.snapshot().courses.some((c) => c.title === '아직 저장하지 않은 기준')).toBe(
    false,
  );
});

test('조회는 저장된 선택만 표시하고 변경 저장은 마이너·메이저 버전과 과거 근거를 보존한다', async ({
  page,
  backend,
}) => {
  const before = backend.store.snapshot();
  const original = before.qualifications.find((q) => q.id === 'demo-qualification')!;
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification');
  await expect(page.locator('.team-qualification-view')).toBeVisible();
  await expect(
    page.locator('.team-qualification-view input, .team-qualification-view select'),
  ).toHaveCount(0);
  await expect(page.locator('.qualification-course-row')).toHaveCount(original.courseIds.length);
  await page.getByRole('link', { name: '변경', exact: true }).click();
  await expect(page).toHaveURL(/demo-qualification\/edit/);
  await page.getByLabel('인증기간', { exact: true }).selectOption('months');
  await page.getByLabel('유효 개월 수', { exact: true }).fill('24');
  await saveCriterion(page);
  await expect(page).toHaveURL(/\/admin\/qualifications(?:\?|$)/);
  const savedMinor = backend.store
    .snapshot()
    .qualifications.find((q) => q.parentId === original.id)!;
  await page.goto(`/admin/qualifications/${savedMinor.id}`);
  await expect(page.locator('.team-qualification-view')).toBeVisible();
  await expect(page.locator('.qualification-view-meta')).toContainText('v1.1');
  await expect(page.getByRole('region', { name: '저장된 팀 운영 기준' })).toContainText(
    '취득 후 24개월',
  );
  const minor = backend.store.snapshot().qualifications.find((q) => q.parentId === original.id)!;
  await page.getByRole('link', { name: '변경', exact: true }).click();
  const row = page.locator(`[data-course-id="${original.courseIds[0]}"]`);
  await row.getByRole('button', { name: /자격에서 제거/ }).click();
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await expect(row.getByRole('checkbox')).toBeFocused();
  await row.getByRole('checkbox').check();
  await expect(row.getByRole('checkbox')).toBeChecked();
  await row.getByRole('checkbox').uncheck();
  await saveCriterion(page);
  await expect(page).toHaveURL(/\/admin\/qualifications(?:\?|$)/);
  const latest = backend.store
    .snapshot()
    .qualifications.filter((q) => q.entityId === original.entityId)
    .sort((a, b) => (b.version || 0) - (a.version || 0))[0]!;
  await page.goto(`/admin/qualifications/${latest.id}`);
  await expect(page.locator('.qualification-view-meta')).toContainText('v2.0');
  await expect(page.locator('.qualification-course-row')).toHaveCount(
    original.courseIds.length - 1,
  );
  const after = backend.store.snapshot();
  expect(after.qualifications.find((q) => q.id === original.id)).toEqual(original);
  expect(after.courses).toEqual(before.courses);
  expect(after.assignments).toEqual(before.assignments);
  expect(after.certifications).toEqual(before.certifications);
  await page.goto(`/admin/qualifications/${minor.id}/edit`);
  await expect(page).toHaveURL(new RegExp(`${minor.id}(?:\\?|$)`));
  await expect(page.getByRole('link', { name: '변경', exact: true })).toHaveCount(0);
  await expect(page.locator('.qualification-view-meta')).toContainText('v1.1');
  await expect(page.locator('.qualification-course-row')).toHaveCount(original.courseIds.length);
  await page.goto('/admin/qualifications/demo-qualification');
  await expect(page.getByRole('region', { name: '저장된 팀 운영 기준' })).toContainText('무기한');
});

test('새 인증Set은 응답 유실 재시도 시 한 번 저장되고 자격 취소 후에도 독립 보존된다', async ({
  page,
  backend,
}) => {
  const before = backend.store.snapshot();
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification/edit');
  await page.getByRole('button', { name: '새 특화인증Set 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '새 특화인증Set 등록', exact: true });
  await dialog.getByLabel('인증Set명', { exact: true }).fill('신규 독립 기준');
  expect(backend.store.snapshot().courses).toEqual(before.courses);
  let lost = false;
  const keys: string[] = [];
  await page.route('**/api/courses?*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']!);
    if (!lost) {
      lost = true;
      await route.fetch();
      return route.abort('failed');
    }
    return route.continue();
  });
  await dialog.getByRole('button', { name: '인증Set 저장 후 추가', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: '저장 결과 확인·재시도', exact: true }),
  ).toBeEnabled();
  await expect(dialog.getByLabel('인증Set명', { exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '저장 결과 확인·재시도', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const added = backend.store.snapshot().courses.filter((c) => c.title === '신규 독립 기준');
  expect(added).toHaveLength(1);
  expect(added[0]!.releaseVersion).toEqual({ major: 0, minor: 1 });
  await expect(
    page.locator(`[data-course-id="${added[0]!.id}"]`).getByRole('checkbox'),
  ).toBeChecked();
  expect(backend.store.snapshot().qualifications).toEqual(before.qualifications);
  await page.locator('.actionbar').getByRole('link', { name: '변경 취소', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(page).toHaveURL(/\/edit/);
  await page.locator('.actionbar').getByRole('link', { name: '변경 취소', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(page.locator('.team-qualification-view')).toBeVisible();
  expect(backend.store.snapshot().courses.filter((c) => c.title === '신규 독립 기준')).toHaveLength(
    1,
  );
  expect(backend.store.snapshot().qualifications).toEqual(before.qualifications);
});

test('신규 저장 후 최신 조회 실패는 입력을 고정하고 생성 없이 결과 조회를 재시도한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification/edit');
  await page.getByRole('button', { name: '새 특화인증Set 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '새 특화인증Set 등록', exact: true });
  await dialog.getByLabel('인증Set명', { exact: true }).fill('조회 실패 보존 기준');
  let posts = 0,
    failRefresh = false;
  await page.route('**/api/courses?*', async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      const response = await route.fetch();
      failRefresh = true;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.route('**/api/workspace*', async (route) => {
    if (failRefresh) {
      failRefresh = false;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '최신 조회 실패' }),
      });
    }
    return route.continue();
  });
  await dialog.getByRole('button', { name: '인증Set 저장 후 추가', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('최신 조회 실패');
  await dialog.getByRole('button', { name: '저장 결과 확인·재시도', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(posts).toBe(1);
  expect(
    backend.store.snapshot().courses.filter((c) => c.title === '조회 실패 보존 기준'),
  ).toHaveLength(1);
});

test('신규 인증Set 저장 후 자격에 적용하고 조회·편집·대화상자가 네 가지 폭에서 키보드로 동작한다', async ({
  page,
  backend,
}, info) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const facts = page.getByRole('region', { name: '저장된 자격 정보' }).locator('dl');
    await expect(facts).toHaveCSS('display', 'grid');
    const columns = await facts.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
    );
    expect(columns).toBe(width <= 768 ? 1 : 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`view-${width}.png`), fullPage: true });
  }
  await page.getByRole('link', { name: '변경', exact: true }).focus();
  await page.keyboard.press('Enter');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const trigger = page.getByRole('button', { name: '새 특화인증Set 등록', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '새 특화인증Set 등록', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('인증Set명', { exact: true })).toBeInViewport();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`new-course-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
  await page.getByRole('button', { name: '새 특화인증Set 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '새 특화인증Set 등록', exact: true });
  await dialog.getByLabel('인증Set명', { exact: true }).fill('새 적용 기준');
  await dialog.getByRole('button', { name: '인증Set 저장 후 추가', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await saveCriterion(page);
  await expect(page).toHaveURL(/\/admin\/qualifications(?:\?|$)/);
  const saved = backend.store
    .snapshot()
    .qualifications.filter((q) => q.entityId === 'demo-qualification')
    .sort((a, b) => (b.version || 0) - (a.version || 0))[0]!;
  await page.goto(`/admin/qualifications/${saved.id}`);
  await expect(page.locator('.team-qualification-view')).toBeVisible();
  await expect(page.locator('.qualification-view-meta')).toContainText('v2.0');
  await expect(
    page.locator('.qualification-course-row').filter({ hasText: '새 적용 기준' }),
  ).toHaveCount(1);
  expect(
    backend.store.snapshot().qualifications.find((q) => q.parentId === 'demo-qualification')!
      .courseIds,
  ).toContain(backend.store.snapshot().courses.find((c) => c.title === '새 적용 기준')!.id);
});
