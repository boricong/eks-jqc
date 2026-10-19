import { test, expect, actor } from './fixtures';
import type { Page } from '@playwright/test';

async function draft(page: Page) {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  await page.getByRole('button', { name: '새 버전', exact: true }).click();
  await expect(page.getByLabel('과정명', { exact: true })).toBeEnabled();
}
const types = (page: Page) => page.getByRole('tablist', { name: '평가 유형', exact: true });
const questions = (page: Page) => page.getByRole('tablist', { name: '객관식 문항', exact: true });

test('평가 유형·문항 탭은 ID 선택과 입력을 저장·해제·재선택 후 유지한다', async ({
  page,
  backend,
}) => {
  await draft(page);
  await expect(types(page).getByRole('tab').first()).toHaveText('객관식 2');
  await questions(page).getByRole('tab').nth(1).click();
  await page.getByLabel('문항', { exact: true }).fill('두 번째 문항 수정 · 안전 기준 확인');
  await page.getByRole('checkbox', { name: '주관식', exact: true }).check();
  await types(page)
    .getByRole('tab', { name: /주관식/ })
    .click();
  await page.getByRole('button', { name: '문항 추가', exact: true }).click();
  await expect(page.getByLabel('문항', { exact: true })).toBeFocused();
  await page.getByLabel('문항', { exact: true }).fill('원인과 조치 설명');
  await types(page)
    .getByRole('tab', { name: /주관식/ })
    .press('Home');
  await expect(page.getByLabel('문항', { exact: true })).toHaveValue(
    '두 번째 문항 수정 · 안전 기준 확인',
  );
  await questions(page).getByRole('tab').nth(1).press('Home');
  await expect(types(page).getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  await questions(page).getByRole('tab').first().press('End');
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
  await expect
    .poll(
      () =>
        backend.store
          .snapshot()
          .courses.find((c) => c.status === 'draft' && c.entityId === 'demo-course-1')?.questions[1]
          ?.prompt,
    )
    .toContain('두 번째');
  await expect(questions(page).getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('checkbox', { name: '객관식', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '주관식', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '실기', exact: true }).uncheck();
  await expect(page.locator('.assessment-editor')).toContainText('필수 평가 유형을 선택하면');
  await expect(page.locator('.assessment-item-panel')).toHaveCount(0);
  await page.getByRole('checkbox', { name: '객관식', exact: true }).check();
  await expect(page.getByLabel('문항', { exact: true })).toHaveValue(
    '두 번째 문항 수정 · 안전 기준 확인',
  );
  await page.getByRole('button', { name: '문항 삭제', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  await expect(questions(page).getByRole('tab')).toHaveCount(2);
  await page.getByRole('button', { name: '문항 삭제', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
  await expect(questions(page).getByRole('tab')).toHaveCount(1);
  await expect(questions(page).getByRole('tab').first()).toBeFocused();
});

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
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
  await expect
    .poll(
      () =>
        backend.store
          .snapshot()
          .courses.find((c) => c.status === 'draft' && c.entityId === 'demo-course-1')?.questions[0]
          ?.correct,
    )
    .toBe(n - 2);
  await page.reload();
  await expect(page.getByLabel(`${n - 1}번 선택지`, { exact: true })).toHaveValue(
    '추가된 정답\n긴 설명도 보존',
  );
  await page.getByRole('button', { name: `${n - 1}번 선택지 삭제`, exact: true }).click();
  await expect(page.locator('.objective-choice input:checked')).toHaveCount(0);
  await page.getByRole('button', { name: '사용 등록', exact: true }).click();
  await expect(page.locator('.editor-errors')).toContainText('정답을 선택');
  await page
    .locator('.editor-errors')
    .getByRole('button', { name: /정답을 선택/ })
    .click();
  await expect(page.getByLabel('1번 선택지를 정답으로 지정', { exact: true })).toBeFocused();
  const box = await page.getByLabel('1번 선택지를 정답으로 지정', { exact: true }).boundingBox();
  expect(box!.y).toBeGreaterThan(0);
  expect(box!.y + box!.height).toBeLessThan(800);
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
  await expect
    .poll(
      () =>
        backend.store
          .snapshot()
          .courses.find((c) => c.status === 'draft' && c.entityId === 'demo-course-1')?.questions[0]
          ?.correct,
    )
    .toBeNull();
});

test('학습·세 평가 유형의 긴 제목과 좁은 화면·읽기 전용·유형별 오류 이동', async ({ page }) => {
  await draft(page);
  await page
    .getByLabel('학습 항목명')
    .fill('설비 및 공정의 매우 긴 학습 항목 이름을 온전히 확인합니다');
  const learning = page.getByRole('tablist', { name: '학습 항목', exact: true });
  await expect(learning).not.toContainText('필수');
  await expect(page.getByRole('checkbox', { name: '필수 학습 항목', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: '주관식', exact: true }).check();
  await page.getByRole('checkbox', { name: '실기', exact: true }).check();
  await types(page)
    .getByRole('tab', { name: /주관식/ })
    .click();
  await page.getByLabel('주관식 합격 기준 (%)').fill('100');
  await page.getByRole('button', { name: '문항 추가', exact: true }).click();
  await page.getByLabel('문항', { exact: true }).fill('오류 원인을 설명하세요.');
  await page.getByRole('button', { name: '사용 등록', exact: true }).click();
  await expect(page.getByLabel('채점 기준', { exact: true })).toBeFocused();
  await page.getByLabel('채점 기준', { exact: true }).fill('관찰한 현상과 기준의 차이를 설명');
  await types(page).getByRole('tab', { name: /실기/ }).click();
  await page.getByRole('button', { name: '항목 추가', exact: true }).click();
  await page.getByLabel('항목명', { exact: true }).fill('기준 대조');
  await page.getByLabel('관찰·판정 기준', { exact: true }).fill('원본과 비교하고 차이를 기록');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const kind of ['객관식', '주관식', '실기']) {
      await types(page)
        .getByRole('tab', { name: new RegExp(`^${kind}`) })
        .click();
      await page.locator('.assessment-editor').scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: test.info().outputPath(`editor-${kind}-${width}.png`),
        fullPage: true,
      });
    }
    expect(
      await page.locator('.individual-editor').evaluate((e) => e.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(1280);
  }
  await page.getByRole('button', { name: '사용 등록', exact: true }).click();
  await expect(page.getByRole('button', { name: '새 버전', exact: true })).toBeVisible();
  await types(page)
    .getByRole('tab', { name: /객관식/ })
    .click();
  await expect(page.getByLabel('문항', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '문항 삭제', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '문항 추가', exact: true })).toHaveCount(0);
});

test('문항 저장 실패와 revision 충돌에서 입력·선택을 유지한다', async ({ page, backend }) => {
  await draft(page);
  await questions(page).getByRole('tab').nth(1).click();
  await page.getByLabel('문항', { exact: true }).fill('유실되면 안 되는 문항');
  await page.route('**/api/courses/*', (r) =>
    r.request().method() === 'PUT' ? r.abort() : r.continue(),
  );
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
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
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
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
  await page.getByRole('tab', { name: /객관식/ }).click();
  await page.getByRole('button', { name: '상세 편집', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '선택지 추가', exact: true }).click();
  await dialog.getByLabel('5번 선택지', { exact: true }).fill('추가 답안\n검증 근거');
  await dialog.getByLabel('5번 선택지를 정답으로 지정', { exact: true }).check();
  await dialog.getByRole('button', { name: '2번 선택지 삭제', exact: true }).click();
  await expect(dialog.getByLabel('4번 선택지를 정답으로 지정', { exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: '내용 반영', exact: true }).click();
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
  await page.getByRole('button', { name: '선택 기준 초안 저장', exact: true }).click();
  await expect
    .poll(
      () =>
        backend.store
          .snapshot()
          .courses.find((c) => c.status === 'draft' && c.entityId === 'demo-course-1')?.questions[0]
          ?.correct,
    )
    .toBe(3);
  const course = backend.store
    .snapshot()
    .courses.find((c) => c.status === 'draft' && c.entityId === 'demo-course-1')!;
  expect(course.questions[0]!.choices).toHaveLength(4);
  expect(course.questions[0]!.choices[3]).toBe('추가 답안\n검증 근거');
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('button', { name: '상세 편집', exact: true }).first()).toBeEnabled();
  await page.getByRole('button', { name: '상세 편집', exact: true }).first().click();
  await expect(dialog.getByLabel('4번 선택지를 정답으로 지정', { exact: true })).toBeChecked();
});
