import { test, expect, actor } from './fixtures';
const path = '/admin/qualifications/demo-qualification';
const dialogFor = (page: any) => page.getByRole('dialog', { name: '기준 저장 확인', exact: true });
async function setup(page: any) {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(path);
}
test('자격 마이너 불변 저장·네 폭·키보드·과거 정책 보존', async ({ page, backend }, info) => {
  await setup(page);
  const original = backend.store
    .snapshot()
    .qualifications.find((q) => q.id === 'demo-qualification')!;
  await page.getByLabel('인증기간', { exact: true }).selectOption('three-years');
  await page.getByLabel('재인증 시작 · 만료 전 개월', { exact: true }).fill('4');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  const dialog = dialogFor(page);
  await expect(dialog).toContainText('v1.0 → v1.1');
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  const confirm = dialog.getByRole('button', { name: '새 버전 저장', exact: true });
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await confirm.focus();
    await expect(confirm).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: info.outputPath('qualification-' + width + '.png'),
      fullPage: true,
    });
  }
  await confirm.click();
  await expect(dialog).toBeHidden();
  const q = backend.store
    .snapshot()
    .qualifications.filter((q) => q.entityId === original.entityId)
    .sort((a, b) => (b.version || 0) - (a.version || 0))[0]!;
  expect(q.releaseVersion).toEqual({ major: 1, minor: 1 });
  expect(q.renewalLeadMonths).toBe(4);
  expect(backend.store.snapshot().qualifications.find((q) => q.id === original.id)).toEqual(
    original,
  );
  await page.goto(path);
  await expect(page.getByLabel('인증기간', { exact: true })).toBeDisabled();
  await expect(page.locator('.release-footer')).toContainText('v1.0');
});
test('무변경은 쓰기 없음·인증Set 계보 제외는 메이저·취소 입력 보존', async ({ page, backend }) => {
  await setup(page);
  const before = backend.store.snapshot();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  const dialog = dialogFor(page);
  await dialog.locator('.dialog-footer').getByRole('button', { name: '닫기', exact: true }).click();
  expect(backend.store.snapshot()).toEqual(before);
  const checkbox = page.locator('.qualification-course-choice input[value="demo-course-1"]');
  await checkbox.uncheck();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog).toContainText('v1.0 → v2.0');
  await dialog.getByRole('button', { name: '계속 편집', exact: true }).click();
  await expect(checkbox).not.toBeChecked();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await dialog.getByRole('button', { name: '새 버전 저장', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(backend.store.snapshot().qualifications.at(-1)!.releaseVersion).toEqual({
    major: 2,
    minor: 0,
  });
});
test('검토 실패와 저장 응답 유실 후 재시도에도 새 버전은 한 개', async ({ page, backend }) => {
  await setup(page);
  await page.getByLabel('인증기간', { exact: true }).selectOption('three-years');
  await page.getByLabel('재인증 시작 · 만료 전 개월', { exact: true }).fill('4');
  await page.route('**/api/qualifications/*/save-preview**', (r) =>
    r.fulfill({ status: 503, json: { message: '검토 실패 시험' } }),
  );
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('.editor-errors')).toContainText('검토 실패 시험');
  await expect(page.getByLabel('재인증 시작 · 만료 전 개월', { exact: true })).toHaveValue('4');
  await page.unroute('**/api/qualifications/*/save-preview**');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  const dialog = dialogFor(page),
    confirm = dialog.getByRole('button', { name: '새 버전 저장', exact: true });
  let first = true;
  const keys: string[] = [];
  await page.route('**/api/qualifications/*', async (r) => {
    if (r.request().method() !== 'PUT') return r.continue();
    keys.push(r.request().headers()['idempotency-key']!);
    if (first) {
      first = false;
      await r.fetch();
      await r.fulfill({ status: 503, json: { message: '저장 응답 유실 시험' } });
    } else await r.continue();
  });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toContainText('저장 응답 유실 시험');
  await confirm.click();
  await expect(dialog).toBeHidden();
  expect(new Set(keys).size).toBe(1);
  expect(
    backend.store.snapshot().qualifications.filter((q) => q.parentId === 'demo-qualification'),
  ).toHaveLength(1);
});
