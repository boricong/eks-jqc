import type { Page } from '@playwright/test';
import type { PlanningRequest, Workspace } from '@eks/contracts';
import { test, expect, actor, answerConfirmation } from './fixtures';
import { requestPlan } from './workflow-helpers';
import { checkCarouselVisuals } from './carousel-visual-helpers';

const carousel = (page: Page) => page.getByRole('region', { name: '진행 중인 자격', exact: true });
const current = (page: Page) => carousel(page).locator('.home-qualification-slide:not([inert])');
const planning = (page: Page) => carousel(page).locator('[data-card-kind="planning"]');
const action = (page: Page) => current(page).getByRole('link');
const completed: PlanningRequest['completion'] = {
  date: '2026-10-23T00:00:00.000Z',
  reason: 'planned',
  evidence: [],
};
function request(id: string, overrides: Partial<PlanningRequest> = {}): PlanningRequest {
  return {
    qualificationType: 'auditee',
    id,
    learnerId: 'learner-1',
    lv1OrganizationId: 'org-photo',
    organizationId: 'org-photo',
    requestedBy: 'admin-1',
    dueOn: '2026-12-01',
    message: `${id} 요청 안내문`,
    createdAt: '2026-10-23T00:00:00.000Z',
    revision: 1,
    mode: 'learner_choice',
    selections: [],
    ...overrides,
  };
}
async function mock(page: Page, update: (view: Workspace) => void) {
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    const view = (await response.json()) as Workspace;
    update(view);
    await route.fulfill({ response, json: view });
  });
}
function options(view: Workspace, stage = '미착수') {
  view.planningOptions = view.planningRequests.map((r) => ({
    requestId: r.id,
    revision: r.revision,
    candidates: [],
    errors: [],
    canComplete: false,
    noAdditional: false,
    stage,
  }));
}
async function refresh(page: Page) {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/workspace');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
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

test('작성이 끝난 요청은 수와 기한에서 제외하고 남은 작성·확인 요청과 현재 자격을 보존', async ({
  page,
  backend,
}) => {
  let phase = 0;
  await mock(page, (view) => {
    view.planningRequests = [
      request('confirmed', { dueOn: '2026-01-01' }),
      request('no-additional', { dueOn: '2026-02-01' }),
      request('optional-draft'),
      request('waiting', { dueOn: '2027-01-01' }),
      request('missing', { dueOn: '2027-02-01' }),
    ];
    options(view);
    for (const item of view.planningOptions) {
      item.canComplete = ['confirmed', 'no-additional'].includes(item.requestId) || phase >= 2;
      item.noAdditional = item.requestId === 'no-additional';
      if (item.requestId === 'optional-draft') {
        item.stage = '작성 중';
        item.canComplete = phase >= 1;
      }
      if (item.requestId === 'waiting') item.stage = '자격 준비 대기';
    }
    if (phase === 0)
      view.planningOptions = view.planningOptions.filter((v) => v.requestId !== 'missing');
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  await expect(current(page)).toHaveAttribute('data-request-id', 'optional-draft');
  await expect(current(page)).toContainText('3건');
  await expect(current(page)).toContainText('2026-12-01');
  await expect(page.locator('.personal-tasks')).toHaveCount(0);
  await expect(page.locator('.home-shortcuts')).toHaveCount(0);
  phase = 1;
  await refresh(page);
  await expect(current(page)).toHaveAttribute('data-request-id', 'waiting');
  await expect(action(page)).toHaveText('요청 상태 확인');
  await carousel(page).getByRole('button', { name: '다음 항목' }).click();
  await expect(current(page)).toHaveAttribute('data-assignment-id', 'assignment-1');
  phase = 2;
  await refresh(page);
  await expect(planning(page)).toHaveCount(0);
  await expect(current(page)).toHaveAttribute('data-assignment-id', 'assignment-1');
  await aligned(page);
  expect(backend.store.snapshot()).toEqual(before);
});

test('요청과 자격의 첫 화면·기한 우선/동률 순서·정확한 이동·조회 불변', async ({
  page,
  backend,
}) => {
  await mock(page, (view) => {
    view.planningRequests = [
      request('later', { dueOn: '2027-01-01' }),
      request('earliest'),
      request('same-date'),
    ];
    options(view);
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  const region = carousel(page);
  await expect(current(page)).toHaveAttribute('data-request-id', 'earliest');
  await expect(current(page)).toContainText('3건');
  await expect(current(page)).toContainText('2026-12-01');
  await expect(current(page)).toContainText('미착수');
  await expect(current(page)).toContainText('earliest 요청 안내문');
  await expect(region.getByRole('status')).toHaveText('1 / 2');
  await expect(region.getByRole('status')).toHaveAttribute('aria-label', '2개 중 1번째 항목');
  await expect(region.getByRole('progressbar')).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: '내 현황' })
      .getByRole('link', { name: /진행 중인 자격/ })
      .locator('.stat-value'),
  ).toHaveText('1');
  await expect(region.getByRole('button', { name: '이전 항목' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await action(page).focus();
  await page.keyboard.press('ArrowRight');
  await aligned(page);
  await expect(region).toBeFocused();
  await expect(current(page)).toHaveAttribute('data-assignment-id', 'assignment-1');
  await expect(action(page)).toHaveAttribute('href', '/qualifications/assignment-1');
  await expect(region.getByRole('link', { name: '계획 수립하기' })).toHaveCount(0);
  await expect(region.getByRole('button', { name: '다음 항목' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('ArrowRight');
  await expect(region.getByRole('status')).toHaveText('2 / 2');
  await actor(page, 'learner-2');
  await expect(planning(page)).toHaveCount(0);
  await actor(page, 'learner-1');
  await expect(current(page)).toHaveAttribute('data-request-id', 'earliest');
  await action(page).focus();
  await page.keyboard.press('ArrowLeft');
  await aligned(page);
  await action(page).click();
  await expect(page).toHaveURL(/\/plans\?request=earliest$/);
  await expect(page.getByText('earliest 요청 안내문', { exact: true })).toBeVisible();
  await page.goto('/');
  await expect(current(page)).toHaveAttribute('data-request-id', 'earliest');
  expect(backend.store.snapshot()).toEqual(before);
});

test('요청만 있음·소속/Lv1/타인/완료 제외·Hold/비활성·계정 전환·대기/확인/기한 경과', async ({
  page,
  backend,
}) => {
  let mode = 'waiting';
  await mock(page, (view) => {
    view.assignments = [];
    view.planningRequests = [
      request('own', { dueOn: '2020-01-01' }),
      request('foreign', { learnerId: 'learner-2', dueOn: '2019-01-01' }),
      request('previous-org', { organizationId: 'old-org', dueOn: '2019-01-01' }),
      request('previous-lv1', { lv1OrganizationId: 'old-team', dueOn: '2019-01-01' }),
      request('done', { completion: completed, dueOn: '2019-01-01' }),
    ];
    if (view.actor.id === 'learner-1') {
      if (mode === 'hold') view.actor.certificationEligibility = 'hold';
      if (mode === 'inactive') view.actor.organizationActive = false;
    }
    options(view, mode === 'waiting' ? '자격 준비 대기' : '확인 필요');
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  await expect(current(page)).toHaveAttribute('data-request-id', 'own');
  await expect(current(page)).toContainText('1건');
  await expect(current(page)).toContainText('기한 경과');
  await expect(current(page)).toContainText('자격 준비 대기');
  await expect(action(page)).toHaveText('요청 상태 확인');
  await expect(action(page)).toHaveAttribute('href', '/plans?request=own');
  await expect(carousel(page).getByRole('group', { name: '항목 탐색' })).toHaveCount(0);
  await expect(carousel(page).getByText('진행 중인 자격이 없습니다.')).toHaveCount(0);
  mode = 'check';
  await refresh(page);
  await expect(current(page)).toContainText('확인 필요');
  await expect(action(page)).toHaveText('요청 상태 확인');
  for (mode of ['hold', 'inactive']) {
    await refresh(page);
    await expect(planning(page)).toHaveCount(0);
    await expect(carousel(page).getByRole('link', { name: '내 계획 확인' })).toBeVisible();
  }
  mode = 'waiting';
  await refresh(page);
  await actor(page, 'learner-2');
  await expect(current(page)).toHaveAttribute('data-request-id', 'foreign');
  await actor(page, 'learner-1');
  await expect(current(page)).toHaveAttribute('data-request-id', 'own');
  expect(backend.store.snapshot()).toEqual(before);
});

test('갱신 시 항목 선택·대표 요청 변경·요청 모두 완료/자격 제거 시 첫 항목', async ({ page }) => {
  let requests = [request('second', { dueOn: '2027-01-01' }), request('first')];
  let removeAssignment = false;
  await mock(page, (view) => {
    view.planningRequests = requests;
    if (removeAssignment) view.assignments = [];
    options(view);
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  await action(page).focus();
  requests = requests.map((r) => (r.id === 'first' ? { ...r, completion: completed } : r));
  await refresh(page);
  await expect(current(page)).toHaveAttribute('data-request-id', 'second');
  await expect(current(page)).toContainText('1건');
  await expect(action(page)).toBeFocused();
  await expect(action(page)).toHaveAttribute('href', '/plans?request=second');
  await carousel(page).getByRole('button', { name: '다음 항목' }).click();
  await aligned(page);
  requests = [...requests, request('new-earliest', { dueOn: '2026-01-01' })];
  await refresh(page);
  await expect(current(page)).toHaveAttribute('data-assignment-id', 'assignment-1');
  await aligned(page);
  await action(page).focus();
  removeAssignment = true;
  await refresh(page);
  await expect(current(page)).toHaveAttribute('data-request-id', 'new-earliest');
  await expect(carousel(page)).toBeFocused();
  removeAssignment = false;
  await refresh(page);
  await expect(current(page)).toHaveAttribute('data-request-id', 'new-earliest');
  await action(page).focus();
  requests = requests.map((r) => ({ ...r, completion: completed }));
  await refresh(page);
  await expect(planning(page)).toHaveCount(0);
  await expect(current(page)).toHaveAttribute('data-assignment-id', 'assignment-1');
  await expect(carousel(page)).toBeFocused();
  await aligned(page);
  requests = [request('new-request')];
  await refresh(page);
  await expect(current(page)).toHaveAttribute('data-assignment-id', 'assignment-1');
  await expect(carousel(page).getByRole('status')).toHaveText('2 / 2');
  await aligned(page);
  requests = [];
  removeAssignment = true;
  await refresh(page);
  await expect(carousel(page).getByRole('link', { name: '내 계획 확인' })).toBeVisible();
  requests = [request('arrived')];
  await refresh(page);
  await expect(current(page)).toHaveAttribute('data-request-id', 'arrived');
});

test('실제 요청·알림 읽음·초안은 유지하고 자격별 확정 뒤 숨김·요청 전체 완료는 별도 확인', async ({
  page,
  backend,
}) => {
  test.setTimeout(90000);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  await requestPlan(page, '정하린');
  const id = backend.store.snapshot().planningRequests[0]!.id;
  await actor(page, 'learner-2');
  await expect(current(page)).toHaveAttribute('data-request-id', id);
  await expect(action(page)).toHaveText('계획 수립하기');
  await page.goto('/notifications');
  await expect
    .poll(
      () => backend.store.snapshot().notifications.find((n) => n.key === `planning:${id}`)?.readAt,
    )
    .toBeTruthy();
  await page.goto('/');
  await expect(current(page)).toHaveAttribute('data-request-id', id);
  const beforeNavigation = backend.store.snapshot();
  await action(page).click();
  await expect(page).toHaveURL(new RegExp(`/plans\\?request=${id}$`));
  await expect(page.getByRole('heading', { name: '새 자격 계획' })).toBeVisible();
  expect(backend.store.snapshot()).toEqual(beforeNavigation);
  await page.getByLabel('취득할 자격').selectOption({ label: '평가 흐름 체험 · v1' });
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await expect(page.getByRole('heading', { name: '개인 인증 계획', exact: true })).toBeVisible();
  await expect
    .poll(() => backend.store.snapshot().plans[0]?.scheduleDefaultsAppliedAt)
    .toBeTruthy();
  const draftUrl = page.url();
  await page.goto('/');
  await expect(current(page)).toHaveAttribute('data-request-id', id);
  await expect(current(page)).toContainText('작성 중');
  await page.goto(draftUrl);
  await page.getByLabel('종료일', { exact: true }).fill('2027-02-01');
  for (const el of await page.getByLabel('시작일', { exact: true }).all())
    await el.fill('2026-10-01');
  for (const el of await page.getByLabel('종료일', { exact: true }).all())
    await el.fill('2026-10-15');
  await expect(page.getByLabel('학습 목표(선택)', { exact: true })).toBeVisible();
  for (const el of await page.getByLabel('학습 목표(선택)', { exact: true }).all())
    await el.fill('판단 근거를 설명하고 독립적으로 수행한다.');
  await page.getByRole('button', { name: '최종 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '계획 최종 확인', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '계획 완료', exact: true }).click();
  await expect(page).toHaveURL(/\/qualifications\/[^/?]+$/);
  expect(backend.store.snapshot().planningRequests[0]!.completion).toBeUndefined();
  await page.goto('/');
  await expect(planning(page)).toHaveCount(0);
  await expect(action(page)).toHaveText('상세정보 보기');
  expect(backend.store.snapshot().planningRequests[0]!.completion).toBeUndefined();
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: '자격 취득', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: '자격 취득 메뉴' })
    .getByRole('link', { name: '내 계획', exact: true })
    .click();
  const finish = page
    .getByRole('region', { name: '이번 요청의 계획 현황' })
    .getByRole('button', { name: '계획 수립 완료', exact: true });
  await finish.click();
  await answerConfirmation(page, true);
  await expect.poll(() => backend.store.snapshot().planningRequests[0]!.completion).toBeTruthy();
  await page.goto('/');
  await expect(planning(page)).toHaveCount(0);
  await expect(action(page)).toHaveText('상세정보 보기');
});

test('4해상도 긴 안내문·빈 상태·평면 글자/44px·키보드/초점·모션 감소', async ({
  page,
  backend,
}, info) => {
  let emptyMessage = false;
  let noItems = false;
  await mock(page, (view) => {
    view.planningRequests = [
      request('long', {
        message: emptyMessage
          ? ''
          : '안내문을 확인하고 자격 취득을 위한 학습 일정과 평가 목표를 작성해 주세요. '.repeat(25),
      }),
    ];
    if (noItems) {
      view.planningRequests = [];
      view.assignments = [];
    }
    options(view, '추가 계획 대상 없음 · 확인 필요');
  });
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await aligned(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    const slide = current(page);
    await expect(slide.locator('h3')).toHaveCSS('font-size', '16px');
    await expect(slide).toHaveCSS('font-family', /Pretendard/);
    await checkCarouselVisuals(page);
    const desc = slide.locator('.home-qualification-description');
    expect(
      await desc.evaluate(
        (el) => el.clientHeight <= parseFloat(getComputedStyle(el).lineHeight) * 2 + 1,
      ),
    ).toBeTruthy();
    for (const control of await carousel(page).getByRole('button').all()) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await control.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    }
    expect((await action(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('heading', { name: '시스템 공지', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '내 팀 공지', exact: true })).toBeVisible();
    if (width >= 1440)
      await expect(page.getByRole('heading', { name: '시스템 공지', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`home-planning-${width}.png`), fullPage: true });
  }
  await carousel(page).focus();
  await page.keyboard.press('Tab');
  await expect(carousel(page).getByRole('link', { name: '전체 보기' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(action(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(carousel(page).getByRole('button', { name: '이전 항목' })).toBeFocused();
  await expect(carousel(page).getByRole('button', { name: '이전 항목' })).toHaveCSS(
    'outline-style',
    'solid',
  );
  await expect(carousel(page).getByRole('button', { name: '이전 항목' })).toHaveCSS(
    'outline-width',
    '2px',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const distance = await carousel(page)
    .getByRole('button', { name: '다음 항목' })
    .evaluate((button) => {
      (button as HTMLElement).click();
      const el = document.querySelector('.home-qualification-slides')!;
      return Math.abs(
        el.children[1]!.getBoundingClientRect().left - el.getBoundingClientRect().left,
      );
    });
  expect(distance).toBeLessThan(2);
  await aligned(page);
  await page.keyboard.press('ArrowLeft');
  await aligned(page);
  emptyMessage = true;
  await refresh(page);
  await expect(current(page)).toContainText('요청 내용을 확인하고 자격 취득 계획을 수립해 주세요.');
  noItems = true;
  await refresh(page);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(carousel(page).getByText('진행 중인 자격이 없습니다.')).toBeVisible();
    await checkCarouselVisuals(page, false);
    await expect(carousel(page).getByRole('link', { name: '내 계획 확인' })).toHaveAttribute(
      'href',
      '/plans',
    );
    await expect(carousel(page).getByRole('group', { name: '항목 탐색' })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: info.outputPath(`home-planning-empty-${width}.png`),
      fullPage: true,
    });
  }
  expect(backend.store.snapshot()).toEqual(before);
});

test.describe('계획 카드 터치 탐색', () => {
  test.use({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });
  test('실제 스와이프로 계획과 자격을 왕복하고 계획으로 이동', async ({
    page,
    context,
    backend,
  }) => {
    await mock(page, (view) => {
      view.planningRequests = [request('touch')];
      options(view);
    });
    await page.goto('/');
    await actor(page, 'learner-1');
    const before = backend.store.snapshot();
    const viewport = carousel(page).locator('.home-qualification-slides');
    await viewport.scrollIntoViewIfNeeded();
    const client = await context.newCDPSession(page);
    for (const direction of [-1, 1]) {
      const b = (await viewport.boundingBox())!;
      const x = direction < 0 ? b.x + b.width - 24 : b.x + 24;
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y: b.y + 70 }],
      });
      for (let step = 1; step <= 12; step++) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + (direction * b.width * 0.75 * step) / 12, y: b.y + 70 }],
        });
        await page.waitForTimeout(20);
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(carousel(page).getByRole('status')).toHaveText(
        direction < 0 ? '2 / 2' : '1 / 2',
      );
      await aligned(page);
    }
    await action(page).click();
    await expect(page).toHaveURL(/\/plans\?request=touch$/);
    expect(backend.store.snapshot()).toEqual(before);
  });
});
