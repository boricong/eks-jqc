import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { JsonStore } from '../../server/src/storage';
import { test, expect, actor, answerConfirmation } from './fixtures';

async function headers(page: Page) {
  return {
    'X-Session-Tab': (await page.evaluate(() => sessionStorage.getItem('eks-session-tab')))!,
    'Idempotency-Key': crypto.randomUUID(),
  };
}
async function refresh(page: Page) {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/workspace');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
}
async function fixture(page: Page, store: JsonStore, long = false) {
  await store.transact(
    'admin-1',
    crypto.randomUUID(),
    'layout-fixture',
    () => {},
    (s) => {
      const c = s.courses.find((c) => c.id === 'demo-course-2')!,
        base = c.questions[0]!;
      c.passScore = 100;
      c.questions = Array.from({ length: 30 }, (_, i) => ({
        ...base,
        id: `layout-${i}`,
        prompt: `질문 ${i + 1} · 기준과 기록을 확인하는 올바른 방법은 무엇인가요?`,
        choices: ['기준과 기록을 대조하여 확인한다', '확인하지 않고 진행한다'],
        correct: 0,
      }));
      if (long) {
        c.title = '설비 조건과 기록을 확인하는 인증Set '.repeat(6);
        c.practicalQuestions = Array.from({ length: 30 }, (_, i) => ({
          ...c.practicalQuestions[0]!,
          id: `scenario-${i}`,
          scenario: '설비의 상태와 공정 조건을 확인합니다.\n'.repeat(12),
          prompt: `${i + 1}번 상황에서 판단 근거를 확인하고 대응하는 방법은 무엇인가요?`,
          choices: [
            '판단 근거를 대조하고 안전 기준에 따라 대응합니다.\n'.repeat(6),
            '확인하지 않고 진행한다',
          ],
          correct: 0,
        }));
      }
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
}
async function pass(
  page: Page,
  store: JsonStore,
  courseId: string,
  kind: 'objective' | 'practical',
) {
  if (
    store
      .snapshot()
      .attempts.some(
        (a) =>
          a.learnerId === 'learner-1' &&
          a.courseId === courseId &&
          a.kind === kind &&
          a.status === 'graded' &&
          a.result === 'passed',
      )
  )
    return;
  const started = await page.request.post(`/api/enrollments/assignment-1:${courseId}/attempts`, {
    headers: await headers(page),
    data: { kind },
  });
  expect(started.ok(), await started.text()).toBeTruthy();
  const value = await started.json(),
    course = store.snapshot().courses.find((c) => c.id === courseId)!;
  const questions = kind === 'objective' ? course.questions : course.practicalQuestions;
  const saved = await page.request.put(`/api/attempts/${value.id}/draft`, {
    headers: await headers(page),
    data: {
      revision: value.revision,
      answers: Object.fromEntries(questions.map((q) => [q.id, q.correct])),
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const revision = (await saved.json()).revision;
  const submitted = await page.request.post(`/api/attempts/${value.id}/submit`, {
    headers: await headers(page),
    data: { revision },
  });
  expect(submitted.ok(), await submitted.text()).toBeTruthy();
}
async function answered(
  page: Page,
  store: JsonStore,
  kind: 'objective' | 'practical' = 'objective',
) {
  await page.goto(`/qualifications/assignment-1/courses/demo-course-2/${kind}`);
  await expect(page.getByRole('button', { name: '답안 확인', exact: true })).toBeEnabled();
  const attempt = store
    .snapshot()
    .attempts.find(
      (a) => a.courseId === 'demo-course-2' && a.kind === kind && a.status === 'in_progress',
    )!;
  const questions =
    kind === 'objective'
      ? store.snapshot().courses.find((c) => c.id === 'demo-course-2')!.questions
      : store.snapshot().courses.find((c) => c.id === 'demo-course-2')!.practicalQuestions;
  const saved = await page.request.put(`/api/attempts/${attempt.id}/draft`, {
    headers: await headers(page),
    data: {
      revision: attempt.revision,
      answers: Object.fromEntries(questions.map((q) => [q.id, 0])),
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole('button', { name: '답안 확인', exact: true })).toBeEnabled();
  return attempt;
}
const reviewButton = (page: Page) =>
  page.getByRole('button', { name: /^답안 확인(?:으로 돌아가기)?$/ });
const pages = (page: Page) =>
  page.getByRole('navigation', { name: '답안 확인 페이지', exact: true });
const row = (page: Page, id: string) => page.locator(`[data-review-question="${id}"]`);
async function clickVisibleSubmit(page: Page) {
  // Click the visible sticky action without the locator's automatic scroll-to-centre.
  const button = page.getByRole('button', { name: '최종 제출', exact: true });
  await expect(button).toBeEnabled();
  const bounds = (await button.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

test('세 단계의 최소 상단·정보 접기·읽기 폭·네 화면 폭과 같은 자료의 전후 실측', async ({
  page,
  backend,
}, info) => {
  await fixture(page, backend.store);
  await answered(page, backend.store);
  const count = backend.store.snapshot().attempts.length;
  await expect(page.locator('.assessment-page .back-link')).toHaveCount(0);
  const toggle = page.getByRole('button', { name: '평가 정보', exact: true });
  const details = page.getByRole('region', { name: '평가 정보', exact: true, includeHidden: true });
  await expect(details).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(details).toBeVisible();
  await expect(details).toContainText('평가 흐름 체험');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(details).toBeHidden();
  const metrics = [];
  for (const stage of ['edit', 'review', 'result']) {
    if (stage === 'review') await reviewButton(page).click();
    if (stage === 'result')
      await page.getByRole('button', { name: '최종 제출', exact: true }).click();
    const target = page
      .locator(
        stage === 'edit'
          ? '.answer-panel'
          : stage === 'review'
            ? '.review-question'
            : '.assessment-outcome',
      )
      .first();
    await expect(target).toBeVisible();
    for (const width of [1920, 1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => scrollTo(0, 0));
      const body = (await target.boundingBox())!;
      if (stage === 'edit')
        expect(
          (await page.locator('.assessment-question-prompt').boundingBox())!.width,
        ).toBeLessThanOrEqual(800);
      else expect(body.width).toBeLessThanOrEqual(960);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBeTruthy();
      const primary = page.locator(
        stage === 'result' ? '.outcome-actions .primary' : '.assessment-submitbar .primary',
      );
      await expect(primary).toHaveCount(1);
      expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await primary.focus();
      const contrast = await primary.evaluate((el) => {
        const luminance = (color: string) => {
          const c = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((n) => n / 255)
            .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
          return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
        };
        const ratio = (a: string, b: string) => {
          const x = luminance(a),
            y = luminance(b);
          return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
        };
        const background = (node: Element): string => {
          const color = getComputedStyle(node).backgroundColor;
          return color === 'rgba(0, 0, 0, 0)' && node.parentElement
            ? background(node.parentElement)
            : color === 'rgba(0, 0, 0, 0)'
              ? 'rgb(255, 255, 255)'
              : color;
        };
        const style = getComputedStyle(el);
        const selectors = [
          '.assessment-stage-title',
          '.assessment-context strong',
          '.assessment-context > span',
          '.assessment-progress',
          '.review-selected p',
          '.outcome-description',
          '.outcome-status h2',
        ];
        return {
          text: ratio(style.color, style.backgroundColor),
          focus: ratio(style.outlineColor, background(el.parentElement!)),
          outline: parseFloat(style.outlineWidth),
          content: selectors.flatMap((selector) =>
            [...document.querySelectorAll(selector)].map((node) =>
              ratio(getComputedStyle(node).color, background(node)),
            ),
          ),
        };
      });
      expect(contrast.text).toBeGreaterThanOrEqual(4.5);
      expect(Math.min(...contrast.content)).toBeGreaterThanOrEqual(4.5);
      expect(contrast.focus).toBeGreaterThanOrEqual(3);
      expect(contrast.outline).toBeGreaterThanOrEqual(2);
      metrics.push({
        stage,
        width,
        body,
        pageHeight: await page.evaluate(() => document.documentElement.scrollHeight),
        contrast,
      });
      await page.screenshot({ path: info.outputPath(`after-${stage}-${width}.png`) });
    }
    if (stage === 'review') {
      await expect(
        page.getByRole('heading', { name: '제출 전 답안 확인', exact: true }),
      ).toHaveCount(1);
      await expect(page.locator('.review-selected p').first()).toHaveText(
        '기준과 기록을 대조하여 확인한다',
      );
    }
  }
  await expect(page.locator('.assessment-outcome')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(page.locator('.outcome-credit')).toHaveCount(0);
  expect(
    await page
      .locator('.assessment-outcome')
      .evaluate((el) => getComputedStyle(el, '::before').backgroundImage),
  ).toBe('none');
  await expect(page.getByRole('link', { name: '상황 대응 평가 시작', exact: true })).toHaveClass(
    /primary/,
  );
  expect(backend.store.snapshot().attempts).toHaveLength(count);
  await writeFile(info.outputPath('after-metrics.json'), JSON.stringify(metrics, null, 2));
});

for (const failure of ['save', 'conflict', 'submit', 'response'] as const)
  test(`검토 2페이지 수정·선택 답안 초점·위치 복원과 ${failure} 실패/재시도`, async ({
    page,
    backend,
  }) => {
    await fixture(page, backend.store);
    const attempt = await answered(page, backend.store);
    await reviewButton(page).click();
    await pages(page).getByRole('button', { name: '다음 페이지', exact: true }).click();
    const question = row(page, 'layout-24'),
      edit = question.getByRole('button', { name: '25번 답안 수정' });
    await edit.scrollIntoViewIfNeeded();
    const offset = (await question.boundingBox())!.y;
    await edit.click();
    await expect(page.getByRole('radio').first()).toBeFocused();
    await expect(page.getByRole('radio').first()).toBeChecked();
    if (failure === 'save' || failure === 'conflict')
      await page.route('**/api/attempts/*/draft', (r) =>
        r.fulfill({
          status: failure === 'conflict' ? 409 : 503,
          json: { message: '시험 저장 실패' },
        }),
      );
    await page.getByRole('radio').nth(1).check();
    if (failure === 'save' || failure === 'conflict') {
      if (failure === 'save') await reviewButton(page).click();
      await expect(page.locator('.save-error')).toContainText('시험 저장 실패');
      await expect(page.getByRole('radio').nth(1)).toBeChecked();
      await page.unroute('**/api/attempts/*/draft');
      if (failure === 'conflict') {
        await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
        await answerConfirmation(page, true);
        await expect(page.getByRole('radio').first()).toBeChecked();
        await expect(reviewButton(page)).toHaveText('답안 확인으로 돌아가기');
        await page.getByRole('radio').nth(1).check();
      } else await page.getByRole('button', { name: '저장 재시도', exact: true }).click();
    }
    await reviewButton(page).click();
    await expect(question).toBeVisible();
    await expect(edit).toBeFocused();
    expect(Math.abs((await question.boundingBox())!.y - offset)).toBeLessThan(3);
    await expect(pages(page)).toContainText('2 / 2');
    await expect(question.locator('.review-selected p')).toHaveText('확인하지 않고 진행한다');
    const reviewOffset = (await question.boundingBox())!.y;
    if (failure === 'submit' || failure === 'response') {
      let failed = false;
      const keys: string[] = [];
      await page.route('**/api/attempts/*/submit', async (r) => {
        keys.push(r.request().headers()['idempotency-key']!);
        if (!failed) {
          failed = true;
          if (failure === 'response') await r.fetch();
          await r.fulfill({ status: 503, json: { message: '시험 제출 실패' } });
        } else await r.continue();
      });
      await clickVisibleSubmit(page);
      await expect(page.locator('.assessment-submit-error')).toContainText('시험 제출 실패');
      expect(Math.abs((await question.boundingBox())!.y - reviewOffset)).toBeLessThan(3);
      await expect(pages(page)).toContainText('2 / 2');
      await clickVisibleSubmit(page);
      await expect(page.locator('.outcome-failed')).toBeVisible();
      expect(new Set(keys).size).toBe(1);
    }
    expect(
      backend.store.snapshot().attempts.filter((a) => a.courseId === 'demo-course-2'),
    ).toHaveLength(1);
    expect(
      backend.store.snapshot().attempts.find((a) => a.id === attempt.id)!.answers['layout-24'],
    ).toBe(1);
  });

test('긴 상황·질문·답안의 순서와 모바일 문항 탐색·검토 왕복·계정 초기화', async ({
  page,
  backend,
}, info) => {
  await fixture(page, backend.store, true);
  await pass(page, backend.store, 'demo-course-2', 'objective');
  await answered(page, backend.store, 'practical');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    expect(
      await page
        .locator('.answer-panel')
        .evaluate(
          (el) =>
            el
              .querySelector('.scenario-context')!
              .compareDocumentPosition(el.querySelector('.assessment-question-prompt')!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
    ).toBeTruthy();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`long-edit-${width}.png`) });
  }
  await page.getByRole('button', { name: /문항 선택/ }).click();
  await page.getByRole('tablist', { name: '응시 문항' }).getByRole('tab').first().press('End');
  await expect(page.getByRole('button', { name: /문항 선택 · 30/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByRole('radio').first()).toBeFocused();
  await reviewButton(page).click();
  await pages(page).getByRole('button', { name: '다음 페이지', exact: true }).click();
  await row(page, 'scenario-24').getByRole('button', { name: '25번 답안 수정' }).click();
  await expect(reviewButton(page)).toHaveText('답안 확인으로 돌아가기');
  await actor(page, 'learner-2');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1/courses/demo-course-2/practical');
  await expect(reviewButton(page)).toHaveText('답안 확인');
  await expect(page.getByRole('button', { name: '평가 정보', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('수료와 자격 취득 결과의 단일 주 행동·보조 연결·Hold 제한', async ({ page, backend }) => {
  await fixture(page, backend.store);
  await pass(page, backend.store, 'demo-course-2', 'objective');
  await pass(page, backend.store, 'demo-course-2', 'practical');
  await page.goto('/qualifications/assignment-1/courses/demo-course-2/practical');
  await expect(page.locator('.outcome-actions .primary')).toHaveText('평가 선택으로');
  await expect(page.getByRole('link', { name: '인증Set 수료증 보기' })).toBeVisible();
  await pass(page, backend.store, 'demo-course-1', 'objective');
  await pass(page, backend.store, 'demo-course-1', 'practical');
  await refresh(page);
  await expect(page.locator('.outcome-actions .primary')).toHaveText('인증서 보기');
  const before = backend.store.snapshot();
  await page.getByRole('button', { name: '평가 정보', exact: true }).click();
  await expect(page.getByRole('region', { name: '평가 정보', exact: true })).toContainText(
    '확정 일시',
  );
  await page.route('**/api/workspace', async (r) => {
    const response = await r.fetch(),
      data = await response.json();
    data.actor.certificationEligibility = 'hold';
    await r.fulfill({ response, json: data });
  });
  await refresh(page);
  await expect(page.locator('.assessment-restriction')).toContainText('Hold');
  await expect(page.locator('.outcome-actions .primary')).toHaveText('인증서 보기');
  expect(backend.store.snapshot()).toEqual(before);
});
