import { courseSection, saveCriterion } from './catalog-helpers';
import { test, expect, actor } from './fixtures';
import type { Page } from '@playwright/test';

async function draft(page: Page) {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  await expect(page.getByLabel('인증Set명', { exact: true })).toBeEnabled();
  await courseSection(page, '지식 평가');
}
const types = (page: Page) => page.getByRole('tablist', { name: '인증Set 편집 항목', exact: true });
const questions = (page: Page) =>
  page.getByRole('tablist', { name: '객관식 · 지식 평가 문항', exact: true });

test('정답 선택지 인덱스·추가 선택지·미정 정답·저장 재조회와 오류 초점', async ({
  page,
  backend,
}) => {
  await draft(page);
  const first = page.getByLabel('1번 선택지', { exact: true });
  await first.fill('첫 번째');
  await page.getByLabel('2번 선택지', { exact: true }).fill('두 번째');
  await page.getByRole('button', { name: '선택지 추가', exact: true }).click();
  const n = await page.locator('.objective-choice').count();
  await page.getByLabel(`${n}번 선택지`, { exact: true }).fill('추가된 정답\n긴 설명도 보존');
  await page.getByLabel(`${n}번 선택지를 정답으로 지정`, { exact: true }).check();
  await page.getByRole('button', { name: '1번 선택지 삭제', exact: true }).click();
  await expect(page.getByLabel(`${n - 1}번 선택지를 정답으로 지정`, { exact: true })).toBeChecked();
  await saveCriterion(page);
  await expect
    .poll(
      () =>
        backend.store
          .snapshot()
          .courses.find((c) => c.version > 1 && c.entityId === 'demo-course-1')?.questions[0]
          ?.correct,
    )
    .toBe(n - 2);
  await page.reload();
  await courseSection(page, '지식 평가');
  await expect(page.getByLabel(`${n - 1}번 선택지`, { exact: true })).toHaveValue(
    '추가된 정답\n긴 설명도 보존',
  );
  await page.getByRole('button', { name: `${n - 1}번 선택지 삭제`, exact: true }).click();
  await expect(page.locator('.objective-choice input:checked')).toHaveCount(0);
  await saveCriterion(page);
  await expect(page.locator('.editor-errors')).toContainText('정답을 선택');
  await page
    .locator('.editor-errors')
    .getByRole('button', { name: /정답을 선택/ })
    .click();
  await expect(page.getByLabel('1번 선택지를 정답으로 지정', { exact: true })).toBeFocused();
  const box = await page.getByLabel('1번 선택지를 정답으로 지정', { exact: true }).boundingBox();
  expect(box!.y).toBeGreaterThan(0);
  expect(box!.y + box!.height).toBeLessThan(800);
  await saveCriterion(page);
  await expect
    .poll(
      () =>
        backend.store
          .snapshot()
          .courses.find((c) => c.version > 1 && c.entityId === 'demo-course-1')?.questions[0]
          ?.correct,
    )
    .toBeNull();
});

test('문항 저장 실패와 revision 충돌에서 입력·선택을 유지한다', async ({ page, backend }) => {
  await draft(page);
  await questions(page).getByRole('tab').nth(1).click();
  await page.getByLabel('문항', { exact: true }).fill('유실되면 안 되는 문항');
  await page.route('**/api/courses/*', (r) =>
    r.request().method() === 'PUT' ? r.abort() : r.continue(),
  );
  await saveCriterion(page);
  await expect(page.locator('.editor-errors')).toBeVisible();
  await expect(page.getByLabel('문항', { exact: true })).toHaveValue('유실되면 안 되는 문항');
  await page.unroute('**/api/courses/*');
  const id = page.url().split('/').at(-1)!.split('?')[0]!;
  await backend.store.transact(
    'admin-1',
    'test-revision',
    'test-revision',
    () => {},
    (s) => {
      s.courses.find((c) => c.id === id)!.revision++;
      return {};
    },
  );
  await saveCriterion(page);
  await expect(page.locator('.editor-errors')).toBeVisible();
  await expect(page.getByLabel('문항', { exact: true })).toHaveValue('유실되면 안 되는 문항');
  await expect(questions(page).getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
});

test('일괄 관리 상세는 추가 선택지와 Excel 정답 번호 변환을 보존한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/catalog');
  await page.getByTestId('catalog-qualification-demo-qualification').getByRole('button').click();
  await page.getByRole('tab', { name: /지식 평가/ }).click();
  await page.getByRole('button', { name: '상세 편집', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '선택지 추가', exact: true }).click();
  await dialog.getByLabel('5번 선택지', { exact: true }).fill('추가 답안\n검증 근거');
  await dialog.getByLabel('5번 선택지를 정답으로 지정', { exact: true }).check();
  await dialog.getByRole('button', { name: '2번 선택지 삭제', exact: true }).click();
  await expect(dialog.getByLabel('4번 선택지를 정답으로 지정', { exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: '내용 반영', exact: true }).click();
  await page.getByRole('button', { name: '변경 검토 후 저장', exact: true }).click();
  await page.getByRole('button', { name: '선택 기준 저장', exact: true }).click();
  await expect
    .poll(
      () =>
        backend.store
          .snapshot()
          .courses.find((c) => c.version > 1 && c.entityId === 'demo-course-1')?.questions[0]
          ?.correct,
    )
    .toBe(3);
  const course = backend.store
    .snapshot()
    .courses.find((c) => c.version > 1 && c.entityId === 'demo-course-1')!;
  expect(course.questions[0]!.choices).toHaveLength(4);
  expect(course.questions[0]!.choices[3]).toBe('추가 답안\n검증 근거');
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('button', { name: '상세 편집', exact: true }).first()).toBeEnabled();
  await page.getByRole('button', { name: '상세 편집', exact: true }).first().click();
  await expect(dialog.getByLabel('4번 선택지를 정답으로 지정', { exact: true })).toBeChecked();
});
