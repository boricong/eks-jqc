import { test, expect, actor } from './fixtures';
import { saveCriterion } from './catalog-helpers';

test('최신 기준 삭제의 이전 버전 안내와 마지막 기준 삭제의 필수 해제를 확인한다', async ({
  page,
  backend,
}) => {
  await backend.store.organizations.transact(
    'admin-1',
    crypto.randomUUID(),
    'required-fixture',
    () => {},
    (org) => {
      return {};
    },
  );
  const originalRequests = backend.store.snapshot().planningRequests;
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification');
  await page.getByLabel('인증기간', { exact: true }).selectOption('three-years');
  await saveCriterion(page, 'new');
  await expect
    .poll(() =>
      backend.store.snapshot().qualifications.some((q) => q.parentId === 'demo-qualification'),
    )
    .toBe(true);
  const latest = backend.store
    .snapshot()
    .qualifications.find((q) => q.parentId === 'demo-qualification')!;
  await page.goto(`/admin/qualifications/${latest.id}`);
  await page.getByRole('button', { name: '자격 삭제', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('삭제 후 현재 기준: 평가 흐름 체험 · v1');
  await dialog.getByLabel('삭제 사유').fill('최신 기준 정리');
  await dialog.getByRole('button', { name: '선택 버전 삭제', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto('/admin/qualifications/demo-qualification');
  await page.getByRole('button', { name: '자격 삭제', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('남은 기준이 없어 신규 계획·학습·갱신 시작을 제한합니다.');
  await expect(dialog).not.toContainText('필수 지정 함께 해제:');

  await dialog.getByLabel('삭제 사유').fill('마지막 기준 정리');
  await dialog.getByRole('button', { name: '선택 버전 삭제', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(backend.store.snapshot().planningRequests).toEqual(originalRequests);
});
