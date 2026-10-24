import { test, expect, actor } from './fixtures';
import type { Page } from '@playwright/test';
import type { JsonStore } from '../../server/src/storage';
import type { Workspace } from '@eks/contracts';
import { checkCarouselVisuals } from './carousel-visual-helpers';

const carousel = (page: Page) => page.getByRole('region', { name: '진행 중인 자격', exact: true });
const current = (page: Page) => carousel(page).locator('.home-qualification-slide:not([inert])');
const detail = (page: Page) =>
  carousel(page).getByRole('link', { name: '상세정보 보기', exact: true });

async function seedMultiple(store: JsonStore) {
  await store.transact(
    'operator-1',
    crypto.randomUUID(),
    'carousel-fixture',
    () => {},
    (state) => {
      const base = state.assignments.find((a) => a.id === 'assignment-1')!;
      const enrollments = state.enrollments.filter((e) => e.assignmentId === base.id);
      for (const [id, learnerId, title] of [
        ['carousel-2', 'learner-1', '배정 당시 두 번째 자격'],
        ['carousel-3', 'learner-1', '배정 당시 세 번째 자격'],
        ['carousel-other', 'learner-2', '다른 학습자의 자격'],
      ]) {
        state.assignments.push({
          ...structuredClone(base),
          id: id!,
          learnerId: learnerId!,
          qualificationMetadata: { ...base.qualificationMetadata!, title: title! },
        });
        state.enrollments.push(
          ...enrollments.map((e) => ({ ...e, id: `${id}:${e.courseId}`, assignmentId: id! })),
        );
      }
      return {};
    },
  );
}

async function refresh(page: Page) {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/workspace');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
}

async function patchWorkspace(page: Page, update: (view: Workspace) => void) {
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    const view = (await response.json()) as Workspace;
    if (view.actor.id === 'learner-1') update(view);
    await route.fulfill({ response, json: view });
  });
}

async function aligned(page: Page) {
  await expect
    .poll(() =>
      current(page).evaluate((slide) =>
        Math.abs(
          slide.getBoundingClientRect().left - slide.parentElement!.getBoundingClientRect().left,
        ),
      ),
    )
    .toBeLessThan(2);
}

test('모든 진행 자격의 순서·버튼/방향키·초점·상세 연결과 읽기 전용', async ({
  page,
  backend,
}, info) => {
  await seedMultiple(backend.store);
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  const region = carousel(page);
  const previous = region.getByRole('button', { name: '이전 항목' });
  const next = region.getByRole('button', { name: '다음 항목' });
  await expect(region.getByRole('status')).toHaveText('1 / 3');
  await expect(previous).toHaveAttribute('aria-disabled', 'true');
  await expect(region.locator('.home-qualification-slide[inert]')).toHaveCount(2);
  await expect(detail(page)).toHaveCount(1);
  await expect(region.getByRole('progressbar')).toHaveAttribute(
    'aria-valuetext',
    '인증Set 0 / 2 수료',
  );
  await expect(current(page)).toContainText('1 / 4');
  await page.screenshot({ path: info.outputPath('carousel-desktop.png'), fullPage: true });
  await previous.focus();
  await page.keyboard.press('Enter');
  await expect(region.getByRole('status')).toHaveText('1 / 3');
  await next.click();
  await aligned(page);
  await expect(current(page)).toContainText('배정 당시 두 번째 자격');
  await expect(detail(page)).toHaveAttribute('href', '/qualifications/carousel-2');
  await detail(page).focus();
  await page.keyboard.press('ArrowRight');
  await aligned(page);
  await expect(region).toBeFocused();
  await expect(region.getByRole('status')).toHaveText('3 / 3');
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(region.getByRole('status')).toHaveText('3 / 3');
  await page.keyboard.press('Tab');
  await expect(region.getByRole('link', { name: '전체 보기' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(detail(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(previous).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await aligned(page);
  await expect(region.getByRole('status')).toHaveText('2 / 3');
  for (const [position, id, title] of [
    [2, 'carousel-2', '배정 당시 두 번째 자격'],
    [1, 'assignment-1', '평가 흐름 체험'],
    [3, 'carousel-3', '배정 당시 세 번째 자격'],
  ] as const) {
    // Returning home starts at the first assignment; advance to each destination.
    while (!(await detail(page).getAttribute('href'))?.endsWith(id)) {
      await next.click();
      await aligned(page);
    }
    await expect(region.getByRole('status')).toHaveText(`${position} / 3`);
    await detail(page).click();
    await expect(page).toHaveURL(new RegExp(`/qualifications/${id}$`));
    await expect(page.getByRole('region', { name: '자격 요약', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '자격 요약' })).toContainText(title);
    await page.getByRole('link', { name: 'EKS 직무자격인증 홈', exact: true }).click();
  }
  await region.getByRole('link', { name: '전체 보기' }).click();
  await expect(page).toHaveURL(/\/qualifications$/);
  expect(backend.store.snapshot()).toEqual(before);
});

test('갱신 시 배정 ID 선택 유지·제거 시 첫 자격·계정 전환·Hold·역할 보존', async ({
  page,
  backend,
}) => {
  await seedMultiple(backend.store);
  let mode: 'initial' | 'reordered' | 'removed' | 'hold' = 'initial';
  await patchWorkspace(page, (view) => {
    if (mode === 'reordered')
      view.assignments = [...view.assignments.slice(1), view.assignments[0]!];
    if (mode === 'removed' || mode === 'hold')
      view.assignments = view.assignments.filter((a) => a.id !== 'carousel-2');
    if (mode === 'hold') view.actor.certificationEligibility = 'hold';
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  await carousel(page).getByRole('button', { name: '다음 항목' }).click();
  await aligned(page);
  mode = 'reordered';
  await refresh(page);
  await expect(current(page)).toHaveAttribute('data-assignment-id', 'carousel-2');
  await expect(carousel(page).getByRole('status')).toHaveText('1 / 3');
  await aligned(page);
  mode = 'removed';
  await detail(page).focus();
  await refresh(page);
  await expect(current(page)).toHaveAttribute('data-assignment-id', 'assignment-1');
  await expect(carousel(page)).toBeFocused();
  await aligned(page);
  await carousel(page).getByRole('button', { name: '다음 항목' }).click();
  await aligned(page);
  await actor(page, 'learner-2');
  await expect(current(page)).toHaveAttribute('data-assignment-id', 'carousel-other');
  await expect(carousel(page).getByRole('group', { name: '항목 탐색' })).toHaveCount(0);
  await actor(page, 'learner-1');
  await expect(current(page)).toHaveAttribute('data-assignment-id', 'assignment-1');
  mode = 'hold';
  await refresh(page);
  await expect(page.getByText('취득 대상자 Hold ·', { exact: false })).toBeVisible();
  await expect(detail(page)).toBeVisible();
  for (const [id, heading] of [
    ['admin-1', '기준 관리'],
    ['operator-1', '시스템 운영'],
  ]) {
    await actor(page, id!);
    await expect(carousel(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: heading!, exact: true })).toBeVisible();
  }
  expect(backend.store.snapshot()).toEqual(before);
});

test('1건·인증 완료/검증 제외/취득 종료/타인 제외·0건 빈 상태', async ({ page, backend }) => {
  let empty = false;
  await patchWorkspace(page, (view) => {
    const base = structuredClone(view.assignments[0]!);
    view.assignments = [
      ...(empty ? [] : [base]),
      { ...structuredClone(base), id: 'certified', certifiedAt: '2026-10-01T00:00:00.000Z' },
      { ...structuredClone(base), id: 'excluded', excludedReason: '검증 제외 시험' },
      { ...structuredClone(base), id: 'closed', acquisitionClosedAt: '2026-10-01T00:00:00.000Z' },
      { ...structuredClone(base), id: 'other', learnerId: 'learner-2' },
    ];
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  await expect(carousel(page).locator('.home-qualification-slide')).toHaveCount(1);
  await expect(carousel(page).getByRole('button')).toHaveCount(0);
  await expect(page.locator('.home-hero .stat-value').first()).toHaveText('1');
  await expect(current(page)).toContainText('미설정');
  empty = true;
  await refresh(page);
  await expect(carousel(page)).toContainText('진행 중인 자격이 없습니다.');
  await expect(carousel(page).getByRole('link', { name: '내 계획 확인' })).toHaveAttribute(
    'href',
    '/plans',
  );
  await expect(carousel(page).getByRole('link', { name: '인증 보기' })).toHaveAttribute(
    'href',
    '/qualifications?filter=certified',
  );
  await expect(page.locator('.home-hero .stat-value').first()).toHaveText('0');
  await checkCarouselVisuals(page, false);
  await actor(page, 'ft-1');
  await expect(page.getByRole('heading', { name: '박준호 님', exact: true })).toBeVisible();
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(carousel(page)).toContainText('진행 중인 자격이 없습니다.');
    await checkCarouselVisuals(page, false);
    await page.screenshot({
      path: test.info().outputPath(`park-empty-${width}.png`),
      fullPage: true,
    });
  }
  expect(backend.store.snapshot()).toEqual(before);
});

test('4해상도·긴 제목/두 줄 설명·목표일/수료율·0 분모·모션 감소', async ({
  page,
  backend,
}, info) => {
  await seedMultiple(backend.store);
  await patchWorkspace(page, (view) => {
    const base = view.assignments[0]!;
    Object.assign(base.qualificationMetadata!, {
      title: '긴 자격명과 공백없는문자열을확인합니다'.repeat(8),
      description: '배정 당시 설명을 두 줄로 요약합니다. '.repeat(50),
    });
    base.planId = 'carousel-plan';
    view.plans.push({
      id: base.planId,
      learnerId: base.learnerId,
      qualificationId: base.qualificationId,
      lv1OrganizationId: base.lv1OrganizationId,
      requestId: 'display-fixture',
      workflowVersion: 'personal-certification-v5',
      status: 'completed',
      revision: 1,
      createdAt: base.assignedAt,
      updatedAt: base.assignedAt,
      targetOn: '2027-02-01',
      schedules: [],
    });
    const enrollment = base.enrollments[0]!;
    enrollment.completion = {
      id: 'display-completion',
      enrollmentId: enrollment.id,
      learnerId: base.learnerId,
      courseId: enrollment.courseId,
      date: base.assignedAt,
      evidence: [],
    };
    const last = view.assignments.find((a) => a.id === 'carousel-3')!;
    last.enrollments = [];
    last.qualificationMetadata!.description = '';
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await aligned(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('.home-primary > :first-child')).toHaveClass(
      /home-qualification-carousel/,
    );
    await expect(current(page)).toContainText('2027-02-01');
    await expect(carousel(page).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    const desc = current(page).locator('.home-qualification-description');
    expect(
      await desc.evaluate(
        (e) =>
          e.getBoundingClientRect().height <= parseFloat(getComputedStyle(e).lineHeight) * 2 + 1,
      ),
    ).toBe(true);
    const title = current(page).locator('h3');
    expect(await title.evaluate((e) => e.scrollHeight <= e.clientHeight + 1)).toBe(true);
    await expect(title).toHaveCSS('font-size', '16px');
    await checkCarouselVisuals(page);
    for (const control of await carousel(page).locator('button, a').all()) {
      if (await control.evaluate((e) => !!e.closest('[inert]'))) continue;
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    if (width >= 1440) {
      await expect(
        page.getByRole('heading', { name: '시스템 공지', exact: true }),
      ).toBeInViewport();
      await expect(page.getByRole('heading', { name: '내 팀 공지', exact: true })).toBeInViewport();
    }
    await page.screenshot({ path: info.outputPath(`carousel-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const next = carousel(page).getByRole('button', { name: '다음 항목' });
  // Reduced motion reaches the destination in the same event, without an animation.
  const distance = await next.evaluate((button) => {
    (button as HTMLElement).click();
    const el = document.querySelector('.home-qualification-slides')!;
    return Math.abs(el.children[1]!.getBoundingClientRect().left - el.getBoundingClientRect().left);
  });
  expect(distance).toBeLessThan(2);
  await aligned(page);
  await next.click();
  await aligned(page);
  await expect(current(page)).toContainText('등록된 자격 설명이 없습니다.');
  await expect(carousel(page).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await expect(current(page).locator('.progress-track > span')).toHaveCSS(
    'transition-duration',
    '0s',
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await aligned(page);
    await expect(current(page)).toHaveAttribute('data-assignment-id', 'carousel-3');
  }
  expect(backend.store.snapshot()).toEqual(before);
});

test.describe('터치 탐색', () => {
  test.use({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });
  test('실제 스와이프·수직 스크롤·탐색 후 상세 이동', async ({ page, context, backend }) => {
    await seedMultiple(backend.store);
    await page.goto('/');
    await actor(page, 'learner-1');
    const before = backend.store.snapshot();
    const viewport = carousel(page).locator('.home-qualification-slides');
    await viewport.scrollIntoViewIfNeeded();
    const bounds = (await viewport.boundingBox())!;
    const client = await context.newCDPSession(page);
    async function swipe(x: number, y: number, dx: number, dy: number) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 12; step++) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + (dx * step) / 12, y: y + (dy * step) / 12 }],
        });
        await page.waitForTimeout(20);
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await swipe(bounds.x + bounds.width - 24, bounds.y + 80, -bounds.width * 0.75, 0);
    await expect(carousel(page).getByRole('status')).toHaveText('2 / 3');
    await aligned(page);
    const scrollY = await page.evaluate(() => window.scrollY);
    const visible = (await viewport.boundingBox())!;
    await swipe(visible.x + 80, visible.y + 170, 0, -130);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollY);
    await expect(carousel(page).getByRole('status')).toHaveText('2 / 3');
    await detail(page).click();
    await expect(page).toHaveURL(/\/qualifications\/carousel-2$/);
    expect(backend.store.snapshot()).toEqual(before);
  });
});
