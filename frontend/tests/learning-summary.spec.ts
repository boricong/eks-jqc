import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { test, expect, actor } from './fixtures';
import { requestPlan, completePlan } from './workflow-helpers';
import { learningContentTabs, showLearningMaterials, showLearningScope } from './learning-helpers';

async function refresh(page: Page) {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/workspace');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
}

test('학습 목록 제거·자격 정보의 키보드/재조회 유지·재진입/계정 초기화', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1?course=demo-course-1');
  const before = backend.store.snapshot();
  const hero = page.getByRole('region', { name: '자격 요약', exact: true });
  const toggle = hero.getByRole('button', { name: '자격 정보', exact: true });
  const details = hero.getByRole('region', { name: '자격 상세 정보', includeHidden: true });
  await expect(page.getByRole('navigation', { name: '현재 위치' })).toHaveCount(0);
  await expect(details).toBeHidden();
  await expect(hero.getByRole('progressbar')).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(details).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const nav = page.getByRole('navigation', { name: '인증Set' });
  await nav.getByRole('button').nth(1).click();
  await expect(details).toBeVisible();
  await refresh(page);
  await expect(details).toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(details).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(hero.getByRole('link', { name: '학습 목록', exact: true })).toHaveCount(0);
  await page.goto('/qualifications');
  await expect(page).toHaveURL(/\/qualifications$/);
  await page.locator('.qualification-row').first().click();
  await expect(details).toBeHidden();
  await toggle.click();
  await actor(page, 'learner-2');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(backend.store.snapshot()).toEqual(before);
});

async function top(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            scrollTo(0, 0);
            resolve();
          }),
        ),
      ),
  );
}

test('균형형 히어로·자격 목표·시작일과 종료일 표시 및 네 화면 폭', async ({
  page,
  backend,
}, info) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await completePlan(page, '평가 흐름 체험', false);
  const assignment = backend.store.snapshot().assignments.find((a) => a.learnerId === 'learner-2')!;
  const hero = page.getByRole('region', { name: '인증Set 요약', exact: true });
  const summary = page.getByRole('region', { name: '자격 요약', exact: true });
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'summary-materials',
    () => {},
    (s) => {
      const c = s.courses.find((c) => c.id === 'demo-course-1')!;
      c.learningItems = Array.from({ length: 10 }, (_, i) => ({
        id: `scope-${i}`,
        title: `${i + 1}. 작업 기준과 판단 근거 확인`,
        type: 'ojt' as const,
        required: true,
      }));
      c.materials = Array.from({ length: 5 }, (_, i) => ({
        id: `reading-${i}`,
        title: `${i + 1}. 설비 점검 학습자료`,
        type: 'text' as const,
        description: '관찰할 항목과 근거를 확인합니다.',
        url: '',
        content:
          '설비 상태와 공정 조건을 확인하고 작업 기준을 기록합니다.\n판단 근거를 비교하여 독립적인 수행을 준비합니다.\n\n'.repeat(
            35,
          ),
      }));
      return {};
    },
  );
  for (const text of [
    '',
    '선택 입력한 목표',
    '첫 줄의 목표\n두 번째 목표\n세 번째 목표',
    '긴 학습 목표\n'.padEnd(2000, '목'),
  ]) {
    await backend.store.transact(
      'admin-1',
      crypto.randomUUID(),
      'hidden-goal',
      () => {},
      (s) => {
        s.plans.find((p) => p.id === assignment.planId)!.goal = text;
        return {};
      },
    );
    await refresh(page);
    const before = backend.store.snapshot();
    await expect(hero.locator('.learning-course-goal')).toHaveCount(0);
    await expect(hero.getByRole('heading', { name: '학습 목표', exact: true })).toHaveCount(0);
    await expect(hero.getByRole('button', { name: /학습 목표/ })).toHaveCount(0);
    if (text.trim()) await expect(hero).toContainText(text.trim());
    await expect(hero.getByRole('region', { name: '내 학습 일정' }).locator('time')).toHaveText([
      '2026-10-01',
      '2027-02-01',
    ]);
    expect(backend.store.snapshot()).toEqual(before);
  }
  await expect(summary.getByRole('link', { name: '학습 목록', exact: true })).toHaveCount(0);
  await expect(summary.locator('h1')).toHaveCSS('font-size', '24px');
  await expect(summary.locator('.qualification-facts strong').first()).toHaveCSS(
    'font-size',
    '20px',
  );
  await expect(summary.locator('.qualification-facts strong').first()).toHaveCSS(
    'font-weight',
    '600',
  );
  await expect(summary.locator('.qualification-facts dt').first()).toHaveCSS('font-size', '13px');
  await expect(summary.locator('.qualification-facts time')).toHaveCSS('font-size', '16px');
  await expect(hero.locator('.learning-dates dd').first()).toHaveCSS('font-size', '14px');
  await expect(hero.getByText('평가 예정일', { exact: true })).toHaveCount(0);
  await expect(hero.locator('.learning-dates > div')).toHaveCount(1);
  await expect(hero.getByRole('link', { name: '일정 수정', exact: true })).toHaveCount(0);
  const dates = hero.locator('.learning-dates > div');
  expect(
    Math.abs((await dates.first().boundingBox())!.y - (await dates.last().boundingBox())!.y),
  ).toBeLessThan(2);
  await expect(page.locator('.toast')).toBeHidden();
  const before = backend.store.snapshot(),
    metrics = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await showLearningScope(page);
    await top(page);
    const h = (await summary.boundingBox())!,
      workspace = (await page.locator('.qualification-workspace').boundingBox())!;
    expect(h.height).toBeGreaterThanOrEqual(160);
    expect(workspace.y - h.y - h.height).toBeCloseTo(width <= 768 ? 24 : 32, 1);
    await expect(page.locator('.learning-material-reader')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`balanced-scope-${width}.png`), fullPage: true });
    await showLearningMaterials(page);
    await top(page);
    await expect(page.locator('.learning-scope-brief')).toHaveCount(0);
    await expect(page.locator('.learning-material-body')).toHaveCount(1);
    await expect(page.locator('.learning-material-reader h3')).toBeHidden();
    metrics.push(
      await page.evaluate(() => ({
        width: innerWidth,
        qualification: document.querySelector('.learning-hero')!.getBoundingClientRect().height,
        course: document.querySelector('.learning-course-hero')!.getBoundingClientRect().height,
        bodyTop: document.querySelector('.learning-material-body')!.getBoundingClientRect().top,
        pageHeight: document.documentElement.scrollHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
      })),
    );
    if (width <= 768)
      for (const el of await page
        .locator(
          '.qualification-detail button:visible, .qualification-detail .button:visible, .qualification-detail .text-link:visible',
        )
        .all())
        expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(dates).toHaveCount(1);
    await page.screenshot({
      path: info.outputPath(`balanced-materials-${width}.png`),
      fullPage: true,
    });
    await page.screenshot({ path: info.outputPath(`balanced-first-screen-${width}.png`) });
  }
  expect(backend.store.snapshot()).toEqual(before);
  await writeFile(info.outputPath('summary-metrics.json'), JSON.stringify(metrics, null, 2));
});

test('가로 탭 기본 범위·키보드·범위 펼침/읽기 위치·인증Set/평가 왕복·삭제/재로드/계정', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'content-memory',
    () => {},
    (s) => {
      const c = s.courses.find((c) => c.id === 'demo-course-1')!;
      c.learningItems = Array.from({ length: 25 }, (_, i) => ({
        id: `item-${i}`,
        title: `${i + 1}번째 독립 수행 항목`,
        type: 'ojt' as const,
        required: i % 2 === 0,
      }));
      c.materials = [1, 2, 3].map((i) => ({
        id: `reading-${i}`,
        title: `탭 복원 자료 ${i}`,
        type: 'text' as const,
        description: '',
        url: '',
        content: '자료별 읽던 위치를 그대로 보존합니다.\n\n'.repeat(100),
      }));
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1?course=demo-course-1');
  const before = backend.store.snapshot();
  const outer = learningContentTabs(page),
    scope = outer.getByRole('tab').first(),
    material = outer.getByRole('tab').last();
  await expect(outer).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(outer.getByRole('tab')).toHaveText(['학습범위 25개', '학습자료 3개']);
  await expect(scope).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.learning-material-reader')).toHaveCount(0);
  await page.getByRole('button', { name: /전체 학습 항목 보기/ }).click();
  await expect(page.locator('.learning-scope-rows li')).toHaveCount(25);
  expect((await page.locator('.learning-scope-rows').boundingBox())!.height).toBeLessThanOrEqual(
    480,
  );
  expect(
    await page.locator('.learning-scope-rows').evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBeTruthy();
  await page.locator('.learning-scope-rows').focus();
  await page.keyboard.press('End');
  await expect
    .poll(() => page.locator('.learning-scope-rows').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await scope.focus();
  await page.keyboard.press('ArrowRight');
  await expect(material).toBeFocused();
  await expect(scope).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('.learning-scope-brief')).toHaveCount(0);
  const tabs = page.getByRole('tablist', { name: '학습자료 선택' });
  const body = page.locator('.learning-material-body');
  await tabs.getByRole('tab').last().click();
  await body.evaluate((el) => {
    el.scrollTop = 500;
    el.dispatchEvent(new Event('scroll'));
  });
  await material.focus();
  await page.keyboard.press('Home');
  await expect(scope).toBeFocused();
  await expect(page.locator('.learning-scope-rows li')).toHaveCount(25);
  await page.keyboard.press('End');
  await expect(material).toBeFocused();
  await expect(tabs.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(500);
  await refresh(page);
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(500);
  const nav = page.getByRole('navigation', { name: '인증Set' });
  await nav.getByRole('button').nth(1).click();
  await expect(scope).toHaveAttribute('aria-selected', 'true');
  await nav.getByRole('button').first().click();
  await expect(material).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(500);
  const menu = page.getByRole('navigation', { name: '자격 취득 메뉴' });
  await menu.getByRole('link', { name: '평가', exact: true }).click();
  await menu.getByRole('link', { name: '학습', exact: true }).click();
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(500);
  expect(backend.store.snapshot()).toEqual(before);
  await showLearningScope(page);
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'delete-hidden-material',
    () => {},
    (s) => {
      s.courses.find((c) => c.id === 'demo-course-1')!.materials.pop();
      return {};
    },
  );
  await refresh(page);
  await showLearningMaterials(page);
  await expect(tabs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(0);
  await page.reload();
  await expect(scope).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.learning-scope-rows li')).toHaveCount(3);
  await showLearningMaterials(page);
  await actor(page, 'learner-2');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1?course=demo-course-1');
  await expect(scope).toHaveAttribute('aria-selected', 'true');
});

test('모바일 범위/자료 패널 왕복은 선택과 페이지 읽기 위치를 보존한다', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'mobile-panels',
    () => {},
    (s) => {
      s.courses.find((c) => c.id === 'demo-course-2')!.materials = [1, 2].map((i) => ({
        id: `mobile-${i}`,
        title: `모바일 패널 자료 ${i}`,
        type: 'text' as const,
        description: '',
        url: '',
        content: '이동 후에도 같은 자료와 문단에서 계속 읽습니다.\n\n'.repeat(100),
      }));
      return {};
    },
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1?course=demo-course-2');
  const before = backend.store.snapshot();
  await showLearningMaterials(page);
  await page.locator('.learning-reader-toggle').click();
  await page.getByRole('tablist', { name: '학습자료 선택' }).getByRole('tab').last().click();
  const body = page.locator('.learning-material-body');
  await body.evaluate((el) => {
    scrollTo(0, scrollY + el.getBoundingClientRect().top + 500);
    dispatchEvent(new Event('scroll'));
  });
  for (let i = 0; i < 3; i++) {
    await expect
      .poll(() => body.evaluate((el) => Math.round(-el.getBoundingClientRect().top)))
      .toBe(500);
    await showLearningScope(page);
    await expect(body).toHaveCount(0);
    await showLearningMaterials(page);
    await expect(body.getByRole('heading', { name: '모바일 패널 자료 2' })).toBeAttached();
  }
  await expect
    .poll(() => body.evaluate((el) => Math.round(-el.getBoundingClientRect().top)))
    .toBe(500);
  expect(backend.store.snapshot()).toEqual(before);
});
