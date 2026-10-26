import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { JsonStore } from '../../server/src/storage';
import { test, expect, actor, answerConfirmation } from './fixtures';
import { requestPlan, savePlanViaApi } from './workflow-helpers';
import { linkFixtureTemplates } from '../../server/tests/template-helpers';

const longTitle = '설비 상태와 공정 조건을 점검하고 독립적으로 수행하는 자격 '.repeat(4);
const longDescription =
  '자격의 적용 범위와 확인할 기준입니다.\n현장에서 수행하는 작업과 판단 근거를 함께 확인합니다.\n' +
  '긴설명'.repeat(80);
const longGoal =
  '첫 번째 목표: 점검 항목과 판단 근거를 설명합니다.\n두 번째 목표: 도움 없이 독립적으로 작업합니다.\n' +
  '긴학습목표'.repeat(40);
async function catalog(store: JsonStore, count = 2, long = false) {
  await store.transact(
    'admin-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      const q = structuredClone(s.qualifications.find((q) => q.id === 'demo-qualification')!);
      q.id = 'review-qualification';
      q.entityId = 'review-qualification';
      const source = s.courses.find((c) => c.id === q.courseIds[0])!;
      q.courseIds = Array.from({ length: count }, (_, i) => `review-course-${i + 1}`);
      q.courseIds.forEach((id, i) =>
        s.courses.push({
          ...structuredClone(source),
          id,
          entityId: id,
          title: `${i + 1}번 인증Set${long ? ' · 긴 이름의 설비 점검과 수행 범위 확인 '.repeat(4) : ''}`,
        }),
      );
      if (long) {
        q.title = longTitle;
        q.description = longDescription;
      }
      s.qualifications.push(q);
      linkFixtureTemplates(s);
      return {};
    },
  );
}
async function startReview(page: Page, store: JsonStore, count = 2, long = false) {
  await catalog(store, count, long);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await page.getByLabel('취득할 자격').selectOption('review-qualification');
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await page.getByLabel('목표 인증일', { exact: true }).fill('2029-12-01');
  await page.getByRole('button', { name: '학습 목표 입력(선택)', exact: true }).click();
  await expect(page.locator('textarea[data-plan-field]')).toHaveCount(count);
  for (const input of await page.locator('textarea[data-plan-field]').all())
    await input.fill(long ? longGoal : '기준을 확인하고 독립적으로 수행합니다.');
  await page.getByRole('button', { name: '최종 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '계획 최종 확인', exact: true })).toBeVisible();
  return store.snapshot().plans[0]!;
}
function course(page: Page, number = 1) {
  return page.locator(`[data-review-course="review-course-${number}"]`);
}
function toggle(page: Page, number = 1) {
  return course(page, number).locator('.collapsible-section-toggle');
}
async function review(page: Page) {
  await page.getByRole('button', { name: '4. 최종 확인', exact: true }).click();
  await expect(page.locator('.plan-review')).toBeVisible();
}
async function refresh(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/workspace') && r.status() === 200,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
}

test('요약·요청 기준·독립 접기와 수정 필드 초점·입력·펼침 보존', async ({ page, backend }) => {
  const plan = await startReview(page, backend.store);
  await expect(page.locator('.plan-context')).toHaveCount(0);
  await expect(page.locator('.plan-review-summary')).toContainText('2029.12.01');
  await expect(page.locator('.plan-review-facts').first()).toContainText('2개');
  const requestToggle = page.getByRole('button', { name: '요청 기준 펼치기', exact: true });
  await expect(requestToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.plan-review-request .plan-review-facts')).toBeHidden();
  expect(
    await page
      .locator('.plan-review-request')
      .evaluate((el) => Boolean(el.previousElementSibling?.classList.contains('plan-review'))),
  ).toBe(true);
  await page.locator('.plan-review-request').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('request-criteria-collapsed-1920.png') });
  await requestToggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.plan-review-request .plan-review-facts')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('.plan-review-request .plan-review-facts')).toBeHidden();
  await page.keyboard.press('Space');
  await expect(page.locator('.plan-review-request .plan-review-facts')).toBeVisible();
  await expect(page.locator('.plan-review-request')).toContainText('현재 소속');
  await expect(page.locator('.plan-review-request .collapsible-section-title')).toHaveCSS(
    'font-size',
    '14px',
  );
  await expect(page.locator('.plan-review-course [aria-expanded="true"]')).toHaveCount(2);
  await toggle(page).focus();
  await page.keyboard.press('Enter');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(course(page)).toContainText(
    `평가 예정일 ${plan.schedules[0]!.assessmentOn.replaceAll('-', '.')}`,
  );
  await expect(course(page).locator('.plan-review-goal')).toBeHidden();
  await expect(toggle(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(course(page).locator('.plan-review-goal')).toBeVisible();
  await toggle(page).click();
  await course(page, 2).getByRole('button', { name: '학습 목표 수정', exact: true }).click();
  const goal = page.locator('[data-plan-field="review-course-2.goal"]');
  await expect(goal).toBeFocused();
  await goal.fill('수정한 목표\n줄바꿈 보존');
  await review(page);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(course(page, 2).locator('.plan-review-goal p')).toHaveText(
    '수정한 목표\n줄바꿈 보존',
  );
  await page.getByRole('button', { name: '목표 인증일 수정', exact: true }).click();
  await expect(page.getByLabel('목표 인증일', { exact: true })).toBeFocused();
  await page.getByLabel('목표 인증일', { exact: true }).fill('2030-01-01');
  await review(page);
  await expect(page.locator('.plan-review-target')).toContainText('2030.01.01');
  await course(page, 2).getByRole('button', { name: '일정 수정', exact: true }).click();
  await expect(page.locator('[data-plan-field="review-course-2.learningStart"]')).toBeFocused();
  await review(page);
  await refresh(page);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(course(page, 2)).toContainText('수정한 목표');
  await expect(page.getByRole('button', { name: '요청 기준 접기', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(backend.store.snapshot().plans[0]!.targetOn).toBe('2030-01-01');
  await page.reload();
  await review(page);
  await expect(page.getByRole('button', { name: '요청 기준 펼치기', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  await actor(page, 'learner-2');
  await page.goto(`/plans/${plan.id}`);
  await review(page);
  await expect(page.locator('.plan-review-course [aria-expanded="true"]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '요청 기준 펼치기', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('저장 실패·충돌에서 입력 유지, 재시도·서버 재조회 뒤 같은 계획 펼침 보존', async ({
  page,
  backend,
}) => {
  const plan = await startReview(page, backend.store);
  await toggle(page).click();
  await course(page, 2).getByRole('button', { name: '학습 목표 수정', exact: true }).click();
  await page.route(`**/api/plans/${plan.id}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: '자동 저장 실패 시험' }),
    }),
  );
  const goal = page.locator('[data-plan-field="review-course-2.goal"]');
  await goal.fill('실패 후에도 남을 목표');
  await page.getByRole('button', { name: '최종 확인', exact: true }).click();
  await expect(page.locator('.save-error')).toContainText('자동 저장 실패 시험');
  await expect(goal).toHaveValue('실패 후에도 남을 목표');
  await page.unroute(`**/api/plans/${plan.id}`);
  await page.getByRole('button', { name: '저장 재시도', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('저장됨');
  await review(page);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await course(page, 2).getByRole('button', { name: '학습 목표 수정', exact: true }).click();
  await page.route(`**/api/plans/${plan.id}`, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ message: '다른 창에서 수정되었습니다.' }),
    }),
  );
  await goal.fill('충돌한 로컬 목표');
  await page.getByRole('button', { name: '최종 확인', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('다른 창의 변경 확인 필요');
  await expect(goal).toHaveValue('충돌한 로컬 목표');
  await page.unroute(`**/api/plans/${plan.id}`);
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await answerConfirmation(page, true);
  await review(page);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(course(page, 2)).toContainText('실패 후에도 남을 목표');
});

for (const failure of ['response', 'refresh'] as const) {
  test(`최종 완료 ${failure === 'response' ? '응답 유실' : '재조회 실패'} 시 같은 명령 재시도와 단일 배정`, async ({
    page,
    backend,
  }) => {
    const plan = await startReview(page, backend.store, 1);
    const keys: string[] = [];
    await page.route(`**/api/plans/${plan.id}/complete`, async (route) => {
      keys.push(route.request().headers()['idempotency-key']!);
      if (failure === 'response' && keys.length === 1) {
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    let failed = false;
    if (failure === 'refresh')
      await page.route('**/api/workspace**', async (route) => {
        if (keys.length && !failed) {
          failed = true;
          await route.abort('failed');
        } else await route.continue();
      });
    await page.getByRole('button', { name: '계획 완료', exact: true }).click();
    await expect(page.locator('.plan-review-submit-error')).toContainText(
      '서버에 연결할 수 없습니다.',
    );
    await expect(page.locator('.plan-review-submit-error')).toBeFocused();
    await expect(page.locator('.plan-review-submit-error')).toBeInViewport();
    await expect(page.locator('.plan-review')).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: '계획 완료', exact: true }).click();
    await expect(page).toHaveURL(/\/qualifications\/[^/?]+$/);
    expect(new Set(keys).size).toBe(1);
    expect(keys.length).toBe(failure === 'response' ? 2 : 1);
    expect(backend.store.snapshot().assignments.filter((a) => a.planId === plan.id)).toHaveLength(
      1,
    );
    expect(backend.store.snapshot().planningRequests[0]!.completion).toBeUndefined();
  });
}

test('확정 계획 읽기 전용·정확한 버전·서버 변경 재조회와 누락/운영 제한 보존', async ({
  page,
  backend,
}) => {
  const plan = await startReview(page, backend.store, 1);
  await page.getByRole('button', { name: '목표 인증일 수정', exact: true }).click();
  await page.getByLabel('목표 인증일', { exact: true }).fill('');
  await page.getByRole('button', { name: '4. 최종 확인', exact: true }).click();
  await expect(page.locator('[data-plan-field="targetOn"]')).toBeFocused();
  await expect(page.locator('.field-error')).toContainText('목표 인증일');
  await page.locator('[data-plan-field="targetOn"]').fill('2029-12-01');
  await review(page);
  await page.getByRole('button', { name: '계획 완료', exact: true }).click();
  await expect(page).toHaveURL(/\/qualifications\/[^/?]+$/);
  const assignment = backend.store.snapshot().assignments.find((a) => a.planId === plan.id)!;
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      const original = s.courses.find((c) => c.id === 'review-course-1')!;
      s.courses.push({
        ...structuredClone(original),
        id: 'review-course-1-v2',
        version: 2,
        parentId: original.id,
        title: '노출되면 안 되는 새 버전',
      });
      return {};
    },
  );
  await page.goto(`/plans/${plan.id}`);
  await expect(page.getByRole('heading', { name: '계획 내용', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '요청 기준 펼치기', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(
    await page
      .locator('.plan-review-request')
      .evaluate((el) => Boolean(el.previousElementSibling?.classList.contains('plan-review'))),
  ).toBe(true);
  await expect(course(page).locator('.plan-review-course-meta')).toContainText('v1');
  await expect(page.getByText('노출되면 안 되는 새 버전')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '계획 완료', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '학습으로 이동', exact: true })).toBeVisible();
  await expect(page.locator('[data-plan-field]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '목표 인증일 수정', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('계획 변경 사유')).toHaveCount(0);
  await savePlanViaApi(page, plan.id, { targetOn: '2030-01-01' }, '현장 일정 조정');
  await refresh(page);
  await expect(page.locator('.save-status')).toHaveText('계획 완료');
  await expect(page.locator('.plan-review-target')).toContainText('2030.01.01');
  expect(backend.store.snapshot().assignments.find((a) => a.id === assignment.id)).toEqual(
    assignment,
  );
});

test('요청 당시 기준과 현재 조직 구분·고정 목록 유지 및 운영 제한', async ({ page, backend }) => {
  await startReview(page, backend.store, 1);
  await backend.store.organizations.transact(
    'admin-1',
    randomUUID(),
    randomUUID(),
    () => {},
    () => ({}),
  );
  await refresh(page);
  await expect(page.locator('.plan-review-warning')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '요청 기준 펼치기', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: '요청 기준 펼치기', exact: true }).click();
  await expect(page.locator('.plan-review-required')).toHaveCount(0);
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'learner-2')!.certificationEligibility = 'hold';
      return {};
    },
  );
  await refresh(page);
  await expect(page.locator('.plan-review-request')).toContainText('현재 소속');
  await expect(page.getByRole('button', { name: '계획 완료', exact: true })).toBeDisabled();
  await expect(page.locator('.plan-review')).toContainText(
    '기준을 확인하고 독립적으로 수행합니다.',
  );
});

for (const count of [5, 20]) {
  test(`${count}개 인증Set의 긴 정보·반응형·대비·고정 실행 영역·조회 불변`, async ({
    page,
    backend,
  }, info) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await startReview(page, backend.store, count, true);
    await expect(page.locator('.plan-review-course')).toHaveCount(count);
    await expect(page.locator('.plan-review-course [aria-expanded="true"]')).toHaveCount(count);
    await page.getByRole('button', { name: '요청 기준 펼치기', exact: true }).click();
    const before = backend.store.snapshot();
    for (const width of count === 5 ? [1920, 1440, 768, 390] : [390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => scrollTo(0, 0));
      const metrics = await page.evaluate(() => {
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        const columns = (selector: string) => style(selector).gridTemplateColumns.split(' ').length;
        const luminance = (color: string) => {
          const values = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map((v) => Number(v) / 255)
            .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
        };
        const contrast = (text: string, surface: string) => {
          const a = luminance(style(text).color),
            b = luminance(style(surface).backgroundColor);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          summaryColumns: columns('.plan-review-facts'),
          scheduleColumns: columns('.plan-review-schedule'),
          font: style('.plan-review-goal p').fontFamily,
          sizes: [
            '.plans-page h1',
            '.plan-review-summary h2',
            '.plan-review .collapsible-section-title',
            '.plan-review-goal p',
            '.plan-review-facts dt',
          ].map((s) => style(s).fontSize),
          leading: style('.plan-review-goal p').lineHeight,
          contrasts: [
            contrast('.plan-review-target strong', '.plan-review-summary'),
            contrast('.plan-review-facts dt', '.plan-review-summary'),
            contrast('.plan-review-request dt', '.plan-review-request'),
          ],
          smallTargets:
            innerWidth > 768
              ? []
              : [
                  ...document.querySelectorAll<HTMLElement>(
                    '.plan-review button, .plan-review-actionbar .button',
                  ),
                ]
                  .filter(
                    (el) =>
                      el.getBoundingClientRect().height > 0 &&
                      el.getBoundingClientRect().height < 44,
                  )
                  .map((el) => el.textContent),
        };
      });
      expect(metrics.overflow).toBe(false);
      expect(metrics.summaryColumns).toBe(width <= 768 ? 1 : 2);
      expect(metrics.scheduleColumns).toBe(width <= 768 ? 1 : 3);
      expect(metrics.font).toContain('Pretendard');
      expect(metrics.sizes).toEqual(['24px', '18px', '16px', '15px', '13px']);
      expect(metrics.leading).toBe('24.75px');
      expect(Math.min(...metrics.contrasts)).toBeGreaterThanOrEqual(4.5);
      expect(metrics.smallTargets).toEqual([]);
      await expect(page.getByRole('button', { name: '계획 완료', exact: true })).toBeInViewport();
      if (count === 5)
        await page.screenshot({ path: info.outputPath(`review-overview-${width}.png`) });
      if (count === 5)
        await page.screenshot({ path: info.outputPath(`review-${width}.png`), fullPage: true });
      const edit = course(page, count).getByRole('button', { name: '학습 목표 수정', exact: true });
      await edit.scrollIntoViewIfNeeded();
      await edit.focus();
      await expect(edit).toBeFocused();
      const box = (await edit.boundingBox())!,
        bar = (await page.locator('.plan-review-actionbar').boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
      if (count === 5)
        await page.screenshot({ path: info.outputPath(`review-actions-${width}.png`) });
      await edit.click();
      await expect(page.locator(`[data-plan-field="review-course-${count}.goal"]`)).toBeFocused();
      await review(page);
    }
    expect(errors).toEqual([]);
    expect(backend.store.snapshot()).toEqual(before);
  });
}
