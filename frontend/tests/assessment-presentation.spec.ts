import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { JsonStore } from '../../server/src/storage';
import { test, expect, actor } from './fixtures';

const selectionPath = '/qualifications/assignment-1?stage=assessment&course=demo-course-2';
async function setup(page: Page, store: JsonStore, practical = false) {
  await store.transact(
    'admin-1',
    crypto.randomUUID(),
    'presentation-fixture',
    () => {},
    (s) => {
      const c = s.courses.find((c) => c.id === 'demo-course-2')!;
      if (practical) {
        c.practicalQuestions = Array.from({ length: 30 }, (_, i) => ({
          ...c.practicalQuestions[0]!,
          id: `presentation-${i}`,
          scenario:
            '설비의 상태와 공정 조건을 확인합니다.\n기준 문서와 관찰 기록을 대조합니다.\n'.repeat(
              3,
            ),
          prompt: `${i + 1}번 상황에서 판단 근거를 확인하고 대응하는 방법은 무엇인가요?`,
          choices: ['기준과 기록을 비교합니다.\n'.repeat(6), '확인하지 않고 진행합니다.'],
          correct: 0,
        }));
      }
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  if (practical) {
    const session = (await page.evaluate(() => sessionStorage.getItem('eks-session-tab')))!;
    const headers = () => ({ 'X-Session-Tab': session, 'Idempotency-Key': crypto.randomUUID() });
    const start = await page.request.post('/api/enrollments/assignment-1:demo-course-2/attempts', {
      headers: headers(),
      data: { kind: 'objective' },
    });
    expect(start.ok(), await start.text()).toBeTruthy();
    const attempt = await start.json();
    const c = store.snapshot().courses.find((c) => c.id === 'demo-course-2')!;
    const save = await page.request.put(`/api/attempts/${attempt.id}/draft`, {
      headers: headers(),
      data: {
        revision: attempt.revision,
        answers: Object.fromEntries(c.questions.map((q) => [q.id, q.correct])),
      },
    });
    expect(save.ok(), await save.text()).toBeTruthy();
    const submit = await page.request.post(`/api/attempts/${attempt.id}/submit`, {
      headers: headers(),
      data: { revision: (await save.json()).revision },
    });
    expect(submit.ok(), await submit.text()).toBeTruthy();
  }
}
function contrast(first: string, second: string) {
  const luminance = (value: string) => {
    const c = value
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((n) => {
        const v = n / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
    return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
  };
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('번호 탭과 문항의 연결·상황/문항/보기 위계·답안 번호·네 폭과 검토 보존', async ({
  page,
  backend,
}, info) => {
  await setup(page, backend.store, true);
  await page.goto('/qualifications/assignment-1/courses/demo-course-2/practical');
  const tabs = page.getByRole('tablist', { name: '응시 문항', exact: true });
  await expect(tabs.getByRole('tab')).toHaveCount(30);
  await expect(tabs.getByRole('tab').first()).toHaveText('1');
  await expect(tabs.getByRole('tab').first()).toHaveAccessibleName(/1번 .*미응답/);
  const firstChoice = page.getByRole('radio').first();
  await expect(firstChoice).toBeEnabled();
  await expect(firstChoice).toHaveAccessibleName(/^1번 : 기준과 기록을 비교합니다\./);
  await firstChoice.focus();
  await expect(firstChoice).toBeFocused();
  await page.keyboard.press('Space');
  await expect(firstChoice).toBeChecked();
  await expect(page.locator('.save-status')).toHaveText('저장됨');
  await expect(tabs.getByRole('tab').first()).toHaveAccessibleName(/응답 완료/);
  await tabs.getByRole('tab').first().press('ArrowDown');
  await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tabs.getByRole('tab').last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(firstChoice).toBeChecked();
  const count = backend.store.snapshot().attempts.length;
  const metrics = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    if (width > 768) {
      await tabs.getByRole('tab').first().focus();
      await expect(tabs.getByRole('tab').first()).toHaveCSS('outline-offset', '-3px');
      const frame = (await page.locator('.number-editor').boundingBox())!;
      const panel = (await page.locator('.answer-panel').boundingBox())!;
      expect(panel.x - frame.x).toBeCloseTo(73, 0);
      expect(frame.width).toBeLessThanOrEqual(960);
    }
    await expect(page.locator('.assessment-content-label')).toHaveText(['문항', '보기']);
    await expect(page.locator('.assessment-question-prompt')).toHaveCSS('font-size', '16px');
    await expect(page.locator('.scenario-context h3')).toHaveCSS('font-size', '13px');
    await expect(page.locator('.scenario-context p')).toHaveCSS('font-size', '14px');
    await expect(page.locator('.choice').first()).toHaveCSS('font-size', '14px');
    await expect(page.locator('.choice-number')).toHaveText(['1번 :', '2번 :']);
    const rows = await page.locator('.choice').all(),
      first = (await rows[0]!.boundingBox())!,
      second = (await rows[1]!.boundingBox())!;
    expect(first.height).toBeGreaterThanOrEqual(48);
    expect(first.x).toBeCloseTo(second.x, 1);
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
    const palette = await page.locator('.answer-panel').evaluate((el) => {
      const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      return {
        body: style('.scenario-context p').color,
        scenario: style('.scenario-context').backgroundColor,
        label: style('.scenario-context h3').color,
        choice: style('.choice-text').color,
        selected: style('.choice.chosen').backgroundColor,
        number: style('.number-tabs [aria-selected="true"]').color,
        tab: style('.number-tabs [aria-selected="true"]').backgroundColor,
        line: style('.number-tabs [aria-selected="true"]').borderLeftColor,
        focus: style('.number-tabs [aria-selected="true"]').outlineColor,
        prompt: getComputedStyle(el.querySelector('.assessment-question-prompt')!).color,
      };
    });
    const ratios = {
      body: contrast(palette.body, palette.scenario),
      label: contrast(palette.label, palette.scenario),
      choice: contrast(palette.choice, palette.selected),
      number: contrast(palette.number, palette.tab),
      line: contrast(palette.line, palette.tab),
      focus: contrast(palette.focus, palette.tab),
      prompt: contrast(palette.prompt, 'rgb(255, 255, 255)'),
    };
    for (const [key, value] of Object.entries(ratios))
      expect(value, key).toBeGreaterThanOrEqual(['line', 'focus'].includes(key) ? 3 : 4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`practical-${width}.png`), fullPage: true });
    metrics.push({ width, ratios });
  }
  await page.getByRole('button', { name: /문항 선택/ }).click();
  await tabs.getByRole('tab').first().press('End');
  await expect(page.getByRole('button', { name: /문항 선택/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByRole('radio').first()).toBeFocused();
  expect(backend.store.snapshot().attempts.length).toBe(count);
  const attempt = backend.store
    .snapshot()
    .attempts.find((a) => a.courseId === 'demo-course-2' && a.kind === 'practical')!;
  const response = await page.request.put(`/api/attempts/${attempt.id}/draft`, {
    headers: {
      'X-Session-Tab': (await page.evaluate(() => sessionStorage.getItem('eks-session-tab')))!,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: {
      revision: attempt.revision,
      answers: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`presentation-${i}`, 0])),
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: '답안 확인', exact: true }).click();
  await expect(page.locator('.review-scenario p').first()).toHaveCSS('font-size', '14px');
  await expect(page.locator('.review-selected p').first()).toHaveCSS('font-size', '14px');
  await page.getByRole('button', { name: '1번 답안 수정', exact: true }).click();
  await expect(page.getByRole('radio').first()).toBeChecked();
  await expect(page.getByRole('radio').first()).toBeFocused();
  await writeFile(info.outputPath('question-contrast.json'), JSON.stringify(metrics, null, 2));
});

test('평가 현황 다섯 열 중앙 정렬·반응형·선행 안내와 조회 불변', async ({
  page,
  backend,
}, info) => {
  await setup(page, backend.store);
  await page.goto(selectionPath);
  await expect(page.locator('.assessment-card')).toHaveCount(2);
  await expect(page.locator('.assessment-row-notice')).toContainText('지식 평가를 먼저 통과');
  const before = backend.store.snapshot(),
    metrics = [];
  for (const width of [1920, 1440, 1024, 1023, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const header = page.locator('.assessment-list-heading');
    const rows = page.locator('.assessment-card');
    if (width >= 1024) {
      await expect(header).toBeVisible();
      const columns = await header.locator('> span').all();
      for (const row of await rows.all()) {
        const cells = await row
          .locator(
            ':scope > h3, :scope > .assessment-count, :scope > .assessment-threshold, :scope > .assessment-state, :scope > .assessment-action',
          )
          .all();
        expect(cells).toHaveLength(5);
        for (let i = 0; i < 5; i++) {
          const label = (await columns[i]!.boundingBox())!,
            cell = (await cells[i]!.boundingBox())!;
          expect(cell.x + cell.width / 2).toBeCloseTo(label.x + label.width / 2, 0);
          await expect(cells[i]!).toHaveCSS('justify-content', 'center');
          await expect(cells[i]!).toHaveCSS('align-items', 'center');
        }
      }
    } else {
      await expect(header).toBeHidden();
      await expect(rows.first().locator('.assessment-cell-label').first()).toBeVisible();
    }
    const link = rows.first().getByRole('link');
    await link.focus();
    if (width <= 768) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const row = (await rows.first().boundingBox())!;
      expect((await link.boundingBox())!.width).toBeCloseTo(row.width - 24, 0);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.evaluate(() => scrollTo(0, 0));
    metrics.push({
      width,
      height: await page
        .locator('.assessment-grid')
        .evaluate((el) => el.getBoundingClientRect().height),
    });
    await page.screenshot({ path: info.outputPath(`status-${width}.png`), fullPage: true });
  }
  await page.reload();
  await expect(page.locator('.assessment-card')).toHaveCount(2);
  expect(backend.store.snapshot()).toEqual(before);
  await writeFile(info.outputPath('status-layout.json'), JSON.stringify(metrics, null, 2));
});

test('미설정·평가 없음·Hold·제외와 작성/통과/미통과 현황의 행동 유지', async ({
  page,
  backend,
}, info) => {
  await setup(page, backend.store);
  let state = 'ready',
    blocked = '',
    empty = false;
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    const c = data.courses.find((c: { id: string }) => c.id === 'demo-course-2');
    c.passScore = null;
    if (empty) c.assessmentKinds = [];
    const a = data.assignments.find((a: { id: string }) => a.id === 'assignment-1');
    const e = a.enrollments.find((e: { courseId: string }) => e.courseId === c.id);
    e.objective = state;
    if (blocked === 'hold') data.actor.certificationEligibility = 'hold';
    if (blocked === 'excluded') a.excludedReason = '검증 제외 시험';
    await route.fulfill({ response, json: data });
  });
  const before = backend.store.snapshot();
  for (const [value, label] of [
    ['ready', '응시하기'],
    ['draft', '답안 이어 쓰기'],
    ['failed', '다시 응시'],
    ['passed', '결과 보기'],
  ]) {
    state = value!;
    await page.goto(selectionPath);
    const row = page.locator('.assessment-card').first();
    await expect(row.locator('.assessment-threshold')).toContainText('미설정');
    await expect(row.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  for (const value of ['hold', 'excluded']) {
    blocked = value;
    await page.reload();
    await expect(page.locator('.assessment-grid').getByRole('link')).toHaveCount(0);
    await expect(page.locator('.assessment-row-notice').first()).toContainText(
      value === 'hold' ? 'Hold' : '검증 제외',
    );
    await page.screenshot({ path: info.outputPath(`status-${value}.png`), fullPage: true });
  }
  blocked = '';
  empty = true;
  await page.reload();
  await expect(page.locator('.assessment-list-heading')).toHaveCount(0);
  await expect(
    page.getByText('등록된 평가 유형이 없습니다. 관리자에게 확인해 주세요.'),
  ).toBeVisible();
  expect(backend.store.snapshot()).toEqual(before);
});
