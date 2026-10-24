import { showLearningMaterials } from './learning-helpers';
import type { Page } from '@playwright/test';
import { test, expect, actor, answerConfirmation } from './fixtures';

const menu = (page: Page) => page.getByRole('navigation', { name: '자격 취득 메뉴' });
async function refresh(page: Page) {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/workspace');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
}

test('목록·상세의 학습/평가 주소와 인증Set 유지, 뒤로·앞으로·새로고침은 응시를 만들지 않는다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  await page.goto('/qualifications?stage=assessment');
  await expect(page.getByRole('heading', { name: '평가', exact: true })).toBeVisible();
  await expect(menu(page).getByRole('link', { name: '평가', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.qualification-row')).toContainText('남음');
  await expect(page.locator('.qualification-row .progress-label')).toContainText('평가 통과');
  await page.locator('.qualification-row').first().click();
  await expect(page).toHaveURL(/assignment-1\?stage=assessment/);
  const courseNav = page.getByRole('navigation', { name: '필수 인증Set' });
  await courseNav.getByRole('button').nth(1).click();
  await expect(page).toHaveURL(/stage=assessment&course=demo-course-2/);
  await expect(page.getByRole('region', { name: '자격 요약' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '학습자료', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '내 학습 일정' })).toHaveCount(0);
  await menu(page).getByRole('link', { name: '학습', exact: true }).click();
  await expect(page).toHaveURL(/assignment-1\?course=demo-course-2$/);
  await expect(menu(page).getByRole('link', { name: '학습', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.qualification-history')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/stage=assessment&course=demo-course-2/);
  await page.goForward();
  await expect(page).toHaveURL(/assignment-1\?course=demo-course-2$/);
  await page.reload();
  await expect(page.locator('.qualification-course-heading')).toContainText('기록 작성');
  await menu(page).getByRole('link', { name: '평가', exact: true }).click();
  await page
    .getByRole('navigation', { name: '현재 위치' })
    .getByRole('link', { name: '평가 목록' })
    .click();
  await expect(page).toHaveURL(/qualifications\?stage=assessment$/);
  expect(backend.store.snapshot()).toEqual(before);
});

test('자료 100개는 한 본문만 표시하고 선택·읽던 위치·갱신·삭제·계정 경계를 보존', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'reading-fixture',
    () => {},
    (s) => {
      const c = s.courses.find((c) => c.id === 'demo-course-1')!;
      c.learningItems = Array.from({ length: 100 }, (_, i) => ({
        id: `scope-${i}`,
        type: 'ojt' as const,
        title: `${i + 1}번째 학습 항목`,
        required: i % 2 === 0,
      }));
      c.materials = Array.from({ length: 100 }, (_, i) => ({
        id: `reader-${i}`,
        type: 'text' as const,
        title: `학습자료 ${i + 1}`,
        description: '줄바꿈과 읽던 위치 확인',
        url: '',
        content: `자료 ${i + 1}\n` + '설비와 공정 기준을 확인합니다.\n\n'.repeat(100),
      }));
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  await page.goto('/qualifications/assignment-1?course=demo-course-1');
  const tabs = page.getByRole('tablist', { name: '학습자료 선택' });
  const body = page.locator('.learning-material-body');
  await expect(page.locator('.learning-scope-rows li')).toHaveCount(3);
  await page.getByRole('button', { name: /전체 학습 항목 보기/ }).click();
  await expect(page.locator('.learning-scope-rows li')).toHaveCount(100);
  expect((await page.locator('.learning-scope-rows').boundingBox())!.height).toBeLessThanOrEqual(
    480,
  );
  await page.getByRole('button', { name: '학습 항목 접기' }).click();
  await showLearningMaterials(page);
  await expect(tabs.getByRole('tab')).toHaveCount(100);
  await expect(body).toHaveCount(1);
  await tabs.getByRole('tab').first().focus();
  await page.keyboard.press('End');
  await expect(tabs.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
  await body.evaluate((el) => {
    el.scrollTop = 650;
    el.dispatchEvent(new Event('scroll'));
  });
  await tabs.getByRole('tab').first().click();
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(0);
  await tabs.getByRole('tab').last().click();
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(650);
  await menu(page).getByRole('link', { name: '평가', exact: true }).click();
  await menu(page).getByRole('link', { name: '학습', exact: true }).click();
  await expect(tabs.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(650);
  expect(await tabs.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await refresh(page);
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(650);
  expect(backend.store.snapshot()).toEqual(before);
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'remove-material',
    () => {},
    (s) => {
      s.courses.find((c) => c.id === 'demo-course-1')!.materials.pop();
      return {};
    },
  );
  await refresh(page);
  await expect(tabs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(0);
  await tabs.getByRole('tab').nth(1).click();
  // Change accounts while away from the reader: its memory must still be cleared.
  await menu(page).getByRole('link', { name: '내 계획', exact: true }).click();
  await actor(page, 'learner-2');
  await actor(page, 'learner-1');
  await page.getByRole('link', { name: '상세정보 보기', exact: true }).click();
  await showLearningMaterials(page);
  await expect(tabs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
});

test('모바일 자료 선택과 페이지 읽기 위치를 탭·응시 왕복 후 복원', async ({ page, backend }) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'mobile-reading',
    () => {},
    (s) => {
      s.courses.find((c) => c.id === 'demo-course-2')!.materials = [1, 2].map((i) => ({
        id: `mobile-${i}`,
        type: 'text' as const,
        title: `모바일 자료 ${i}`,
        description: '',
        url: '',
        content: '화면을 내려 전체 학습자료를 읽습니다.\n\n'.repeat(100),
      }));
      return {};
    },
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1?course=demo-course-2');
  await showLearningMaterials(page);
  const toggle = page.locator('.learning-reader-toggle');
  const body = page.locator('.learning-material-body');
  await toggle.click();
  await page.getByRole('tablist', { name: '학습자료 선택' }).getByRole('tab').nth(1).click();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await body.evaluate((el) => {
    scrollTo(0, scrollY + el.getBoundingClientRect().top + 600);
    dispatchEvent(new Event('scroll'));
  });
  await expect
    .poll(() => body.evaluate((el) => Math.round(-el.getBoundingClientRect().top)))
    .toBe(600);
  await menu(page).getByRole('link', { name: '평가', exact: true }).click();
  await menu(page).getByRole('link', { name: '학습', exact: true }).click();
  await expect(body.getByRole('heading', { name: '모바일 자료 2' })).toBeAttached();
  await expect
    .poll(() => body.evaluate((el) => Math.round(-el.getBoundingClientRect().top)))
    .toBe(600);
  await menu(page).getByRole('link', { name: '평가', exact: true }).click();
  await page.getByRole('link', { name: '응시하기', exact: true }).first().click();
  await expect(page.getByRole('button', { name: '제출', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: '학습으로 이동', exact: true }).click();
  await expect
    .poll(() => body.evaluate((el) => Math.round(-el.getBoundingClientRect().top)))
    .toBe(600);
});

test('빈 인증Set·학습 항목·자료와 Hold 제한은 명확하게 표시하며 열람은 불변', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'empty-learning',
    () => {},
    (s) => {
      const c = s.courses.find((c) => c.id === 'demo-course-2')!;
      c.learningItems = [];
      c.materials = [];
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1?course=demo-course-2');
  const before = backend.store.snapshot();
  await expect(page.locator('.learning-scope-brief')).toContainText('등록된 학습 항목이 없습니다.');
  await showLearningMaterials(page);
  await expect(page.getByRole('region', { name: '학습자료', exact: true })).toContainText(
    '등록된 학습자료가 없습니다.',
  );
  let empty = false;
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.actor.certificationEligibility = 'hold';
    data.users.find((u: { id: string }) => u.id === 'learner-1').certificationEligibility = 'hold';
    if (empty)
      data.assignments.find((a: { id: string }) => a.id === 'assignment-1').enrollments = [];
    await route.fulfill({ response, json: data });
  });
  await refresh(page);
  await expect(page.locator('.qualification-context-note')).toContainText('Hold');
  await expect(page.getByRole('link', { name: '평가로 이동', exact: true })).toHaveCount(0);
  await menu(page).getByRole('link', { name: '평가', exact: true }).click();
  await expect(page.locator('.assessment-grid').getByRole('link')).toHaveCount(0);
  empty = true;
  await refresh(page);
  await expect(page.locator('.qualification-detail')).toContainText('등록된 인증Set이 없습니다.');
  await menu(page).getByRole('link', { name: '학습', exact: true }).click();
  await expect(page.getByRole('region', { name: '자격 요약' })).toBeVisible();
  expect(backend.store.snapshot()).toEqual(before);
});

for (const failure of ['pending', 'response', 'conflict'] as const) {
  test(`응시→학습 이동의 ${failure} 저장 보호와 동일 회차·마지막 문항 복원`, async ({
    page,
    backend,
  }) => {
    await page.goto('/');
    await actor(page, 'learner-1');
    await page.goto('/qualifications/assignment-1/courses/demo-course-2/objective');
    await expect(page.getByRole('button', { name: '제출', exact: true })).toBeEnabled();
    const tabs = page.getByRole('tablist', { name: '응시 문항' });
    await tabs.getByRole('tab').nth(1).click();
    const attempts = () =>
      backend.store
        .snapshot()
        .attempts.filter((t) => t.courseId === 'demo-course-2' && t.kind === 'objective');
    const id = attempts()[0]!.id;
    const keys: string[] = [];
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/attempts/*/draft', async (route) => {
      keys.push(route.request().headers()['idempotency-key']!);
      entered!();
      if (failure === 'pending') {
        await gate;
        await route.continue();
      } else if (failure === 'response') {
        await route.fetch();
        await route.fulfill({ status: 503, json: { message: '답안 응답 유실 시험' } });
      } else
        await route.fulfill({ status: 409, json: { message: '다른 창에서 변경한 답안입니다.' } });
    });
    await page.getByLabel('항목의 누락 여부', { exact: true }).check();
    await page.getByRole('link', { name: '학습으로 이동', exact: true }).click();
    await requestStarted;
    if (failure === 'pending') {
      await expect(page).toHaveURL(/\/objective$/);
      release!();
    } else {
      await answerConfirmation(page, false);
      await expect(page).toHaveURL(/\/objective$/);
      await expect(page.getByLabel('항목의 누락 여부', { exact: true })).toBeChecked();
      await page.unroute('**/api/attempts/*/draft');
      if (failure === 'conflict') {
        await page.getByRole('link', { name: '학습으로 이동', exact: true }).click();
        await answerConfirmation(page, true);
      } else {
        await page.route('**/api/attempts/*/draft', (route) => {
          keys.push(route.request().headers()['idempotency-key']!);
          return route.continue();
        });
        await page.getByRole('button', { name: '저장 재시도' }).click();
        await expect(page.locator('.save-status')).toHaveText('저장됨');
        expect(new Set(keys).size).toBe(1);
        await page.getByRole('link', { name: '학습으로 이동', exact: true }).click();
      }
    }
    await expect(page).toHaveURL(/assignment-1\?course=demo-course-2$/);
    await showLearningMaterials(page);
    await expect(page.getByRole('region', { name: '학습자료', exact: true })).toBeVisible();
    await menu(page).getByRole('link', { name: '평가', exact: true }).click();
    await page.getByRole('link', { name: '답안 이어 쓰기', exact: true }).click();
    await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
    if (failure !== 'conflict')
      await expect(page.getByLabel('항목의 누락 여부', { exact: true })).toBeChecked();
    expect(attempts()).toHaveLength(1);
    expect(attempts()[0]!.id).toBe(id);
  });
}
