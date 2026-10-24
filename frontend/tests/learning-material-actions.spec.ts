import { showLearningMaterials, showLearningScope } from './learning-helpers';
import type { Page } from '@playwright/test';
import { test, expect, actor } from './fixtures';

async function open(page: Page) {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1?course=demo-course-1');
  await showLearningMaterials(page);
}
const reader = (page: Page) => page.getByRole('region', { name: '학습자료', exact: true });
const tabs = (page: Page) => reader(page).getByRole('tablist', { name: '학습자료 선택' });
const url =
  'https://example.com/manual?revision=3&section=' + 'long-reference-'.repeat(40) + '#details';

test.beforeEach(async ({ backend }) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'material-actions',
    () => {},
    (s) => {
      s.courses.find((c) => c.id === 'demo-course-1')!.materials = [
        {
          id: 'text-1',
          type: 'text',
          title: '첫 본문 제목',
          description: '',
          url: '',
          content: '본문 첫 줄\n둘째 줄',
        },
        {
          id: 'edm-1',
          type: 'edm',
          title: '긴 설비 매뉴얼 이름',
          description: '변경된 절차를 확인합니다.',
          url,
          content: '',
        },
        {
          id: 'text-2',
          type: 'text',
          title: '다른 본문 제목',
          description: '',
          url: '',
          content: '다른 본문',
        },
        {
          id: 'edm-2',
          type: 'edm',
          title: '두 번째 매뉴얼',
          description: '',
          url: 'https://example.com/second',
          content: '',
        },
        {
          id: 'wiki',
          type: 'confluence',
          title: '업무 지침',
          description: '',
          url: 'https://example.com/wiki',
          content: '',
        },
        {
          id: 'url',
          type: 'url',
          title: '참고 사이트',
          description: '',
          url: 'https://example.com/reference',
          content: '',
        },
      ];
      return {};
    },
  );
});

test('자료별 유형/순번·전체 접근성 이름·원본 주소 복사·새 창·네 화면 폭', async ({
  page,
  context,
  backend,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>시험 자료</h1>' }),
  );
  await open(page);
  const before = backend.store.snapshot();
  await expect(tabs(page).getByRole('tab')).toHaveText([
    '직접 작성 1',
    'EDM Link 1',
    '직접 작성 2',
    'EDM Link 2',
    'Confluence',
    '일반 URL',
  ]);
  await expect(tabs(page).getByRole('tab').first()).toHaveAttribute(
    'aria-label',
    '직접 작성 1 · 첫 본문 제목',
  );
  await expect(tabs(page).getByRole('tab').first()).toHaveAttribute(
    'title',
    '직접 작성 1 · 첫 본문 제목',
  );
  await tabs(page).getByRole('tab').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(tabs(page).getByRole('tab').nth(1)).toBeFocused();
  await expect(reader(page).getByRole('heading', { name: '긴 설비 매뉴얼 이름' })).toBeVisible();
  await expect(reader(page).locator('.learning-material-url')).toHaveText(url);
  await reader(page).getByRole('button', { name: '주소 복사', exact: true }).click();
  await expect(reader(page).getByRole('status')).toHaveText('주소를 복사했습니다.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  const link = reader(page).getByRole('link', { name: '긴 설비 매뉴얼 이름 자료 열기 · 새 창' });
  await expect(link).toHaveAttribute('href', url);
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const popupPromise = page.waitForEvent('popup');
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(url);
  await popup.close();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    const summary = page.getByRole('region', { name: '인증Set 요약' });
    await expect(summary).toContainText('자료 확인');
    await expect(summary.getByRole('heading', { name: '학습 목표', exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    if (width <= 768) {
      expect(
        (await reader(page).getByRole('button', { name: '주소 복사', exact: true }).boundingBox())!
          .height,
      ).toBeGreaterThanOrEqual(44);
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: info.outputPath(`course-materials-${width}.png`),
      fullPage: true,
    });
  }
  expect(backend.store.snapshot()).toEqual(before);
});

test('복사 거부·늦은 복사 결과·자료 전환은 현재 본문과 오류 상태를 보존', async ({ page }) => {
  await open(page);
  await tabs(page).getByRole('tab').nth(1).click();
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => {
        throw new Error('denied');
      },
    }),
  );
  await reader(page).getByRole('button', { name: '주소 복사' }).click();
  await expect(reader(page).getByRole('status')).toContainText('주소 복사에 실패했습니다.');
  await expect(reader(page).locator('.learning-material-url')).toHaveText(url);
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: () =>
        new Promise<void>((resolve) => {
          (window as any).finishCopy = resolve;
        }),
    }),
  );
  await reader(page).getByRole('button', { name: '주소 복사' }).click();
  await expect(reader(page).getByRole('button', { name: '복사 중' })).toBeDisabled();
  await tabs(page).getByRole('tab').nth(3).click();
  await page.evaluate(() => (window as any).finishCopy());
  await expect(reader(page).getByRole('status')).toBeEmpty();
  await expect(reader(page).getByRole('button', { name: '주소 복사' })).toBeEnabled();
  await expect(reader(page).locator('.learning-material-url')).toHaveText(
    'https://example.com/second',
  );
  await reader(page).getByRole('button', { name: '주소 복사' }).click();
  await expect(reader(page).getByRole('button', { name: '복사 중' })).toBeDisabled();
  await showLearningScope(page);
  await expect(reader(page)).toHaveCount(0);
  await showLearningMaterials(page);
  await page.evaluate(() => (window as any).finishCopy());
  await expect(reader(page).getByRole('status')).toBeEmpty();
  await expect(reader(page).getByRole('button', { name: '주소 복사' })).toBeEnabled();
});

test('이전 데이터의 빈 주소·잘못된 주소는 복사/열기를 제공하지 않는다', async ({ page }) => {
  let value = '';
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const c = data.courses.find((c: { id: string }) => c.id === 'demo-course-1');
    c.materials[1].url = value;
    await route.fulfill({ response, json: data });
  });
  await open(page);
  for (value of ['', 'https://', 'javascript:alert(1)']) {
    await page.reload();
    await showLearningMaterials(page);
    await tabs(page).getByRole('tab').nth(1).click();
    await expect(reader(page)).toContainText('자료 링크를 확인할 수 없습니다.');
    await expect(reader(page).getByRole('button', { name: '주소 복사' })).toHaveCount(0);
    await expect(reader(page).getByRole('link')).toHaveCount(0);
  }
});
