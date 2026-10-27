import type { Locator } from '@playwright/test';
import { test, expect, actor, answerConfirmation } from './fixtures';
import { createCourse, courseSection, openSavedCourse, saveCriterion } from './catalog-helpers';

test('자료 목록·상단 탭·연결형 세로 번호의 네 화면 폭과 실제 정렬·글자 크기', async ({
  page,
  backend,
}, info) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'layout-fixture',
    () => {},
    (state) => {
      const course = state.courses.find((c) => c.id === 'demo-course-1')!;
      course.materials = [
        {
          id: 'long-text',
          type: 'text',
          title: '긴 학습자료 제목 · '.repeat(10),
          content: '학습자료 본문과 확인할 내용입니다.\n'.repeat(20),
          description: '',
          url: '',
        },
        {
          id: 'long-link',
          type: 'edm',
          title: 'EDM 작업 표준',
          description: '자료 설명과 링크를 각각 확인합니다. '.repeat(12),
          content: '',
          url: `https://example.com/${'long-path/'.repeat(20)}`,
        },
        { id: 'unfinished', type: 'confluence', title: '', description: '', content: '', url: '' },
      ];
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  const tabs = page.getByRole('tablist', { name: '인증Set 편집 항목', exact: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await courseSection(page, '학습 정보');
    await expect(tabs).toHaveAttribute('aria-orientation', 'horizontal');
    await expect(tabs.getByRole('tab').first()).toHaveCSS('font-size', '14px');
    await expect(tabs.getByRole('tab').first()).toHaveCSS('min-height', '44px');
    const infoTabs = page.getByRole('tablist', { name: '학습 정보 항목', exact: true });
    await infoTabs.getByRole('tab', { name: /자료 2/ }).click();
    await expect(page.getByLabel('자료명', { exact: true })).toHaveValue('EDM 작업 표준');
    await expect(page.getByLabel('자료명', { exact: true })).toHaveCSS(
      'font-size',
      width <= 768 ? '16px' : '14px',
    );
    await expect(page.getByLabel('URL', { exact: true })).toHaveValue(
      new RegExp('^https://example[.]com/'),
    );
    await expect(infoTabs.getByRole('tab', { name: /자료 3/ })).toHaveAccessibleName(/보완 필요/);
    await page.screenshot({ path: info.outputPath(`materials-${width}.png`), fullPage: true });
    for (const name of ['학습 정보', '지식 평가', '상황 대응 평가']) {
      await courseSection(page, name);
      const rail = page.locator('.course-editor-content .number-tabs:visible');
      await expect(rail).toHaveAttribute('aria-orientation', 'vertical');
      const selected = rail.locator('[aria-selected="true"]');
      await expect(selected).toHaveCSS('border-left-width', '3px');
      await expect(selected).toHaveCSS('border-radius', '0px');
      await expect(selected).toHaveCSS('color', 'rgb(68, 52, 212)');
      const panel = page.locator('.course-editor-content [role="tabpanel"]:visible');
      const panelBox = await panel.boundingBox();
      const tabBox = await selected.boundingBox();
      const frameBox = await page.locator('.number-editor:visible').boundingBox();
      const navigationBox = await page.locator('.question-navigation:visible').boundingBox();
      expect(tabBox!.x + tabBox!.width).toBeCloseTo(panelBox!.x, 0);
      expect(navigationBox!.y).toBeCloseTo(panelBox!.y, 0);
      expect(navigationBox!.height).toBeCloseTo(panelBox!.height, 0);
      expect(frameBox!.width).toBeCloseTo(navigationBox!.width + panelBox!.width + 2, 0);
      await expect(selected).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(panel.locator('h3')).toHaveCSS('font-size', '16px');
      const add = page.getByRole('button', {
        name: name === '학습 정보' ? '교육 추가' : '문항 추가',
        exact: true,
      });
      const addBox = await add.boundingBox();
      const railBox = await rail.boundingBox();
      expect(addBox!.y + addBox!.height).toBeLessThanOrEqual(railBox!.y);
      expect(addBox!.width).toBeGreaterThan(70);
      await expect(page.locator('.course-editor-content h2:visible')).toHaveCSS(
        'font-size',
        '18px',
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      if (width <= 768) {
        const heights = await page
          .locator('.course-editor-shell button:visible')
          .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
        expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true });
      const lastInput = page
        .locator(
          '.course-editor-content input:visible:not([type="checkbox"]), .course-editor-content textarea:visible',
        )
        .last();
      await lastInput.focus();
      const inputBox = await lastInput.boundingBox();
      const saveBox = await page.locator('.actionbar').boundingBox();
      expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(saveBox!.y + 1);
    }
    await tabs.getByRole('tab').last().press('Home');
    await expect(tabs.getByRole('tab').first()).toBeFocused();
    await tabs.getByRole('tab').first().press('End');
    await expect(tabs.getByRole('tab').last()).toBeFocused();
    const selectedBox = await tabs.getByRole('tab').last().boundingBox();
    const tabsBox = await tabs.boundingBox();
    expect(selectedBox!.x + selectedBox!.width).toBeLessThanOrEqual(
      tabsBox!.x + tabsBox!.width + 1,
    );
  }
  expect(errors).toEqual([]);
});

async function choiceLayout(rows: Locator, width: number, readonly = false) {
  const boxes = await rows.evaluateAll((els) =>
    els.map((el) => {
      const origin = el.getBoundingClientRect();
      const rect = (selector: string) => {
        const box = el.querySelector(selector)?.getBoundingClientRect();
        return box
          ? { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }
          : null;
      };
      return {
        width: origin.width,
        height: origin.height,
        radio: rect('.choice-radio'),
        input: rect('textarea'),
        remove: rect('button'),
        error: rect('.choice-error'),
      };
    }),
  );
  for (const box of boxes) {
    expect(box.input!.x).toBeCloseTo(boxes[0]!.input!.x, 0);
    expect(box.input!.width).toBeCloseTo(boxes[0]!.input!.width, 0);
    expect(box.radio!.height).toBeGreaterThanOrEqual(44);
    if (readonly) expect(box.remove).toBeNull();
    else {
      expect(box.remove!.width).toBeGreaterThanOrEqual(44);
      expect(box.remove!.height).toBeGreaterThanOrEqual(44);
      expect(box.remove!.y + box.remove!.height / 2).toBeCloseTo(
        box.radio!.y + box.radio!.height / 2,
        0,
      );
    }
    if (width > 600) {
      expect(box.radio!.y + box.radio!.height / 2).toBeCloseTo(
        box.input!.y + box.input!.height / 2,
        0,
      );
      expect(box.radio!.x + box.radio!.width).toBeLessThan(box.input!.x);
    } else {
      expect(box.input!.y).toBeGreaterThanOrEqual(box.radio!.y + box.radio!.height);
      expect(box.input!.x).toBeCloseTo(box.radio!.x, 0);
      expect(box.input!.x + box.input!.width).toBeCloseTo(box.width - 8, 0);
    }
    if (box.error) {
      expect(box.error.x).toBeCloseTo(box.input!.x, 0);
      expect(box.error.y).toBeGreaterThanOrEqual(box.input!.y + box.input!.height);
    }
  }
  return boxes;
}

test('선택지 정답 변경·긴 내용·오류·읽기 전용의 정렬과 정답 삭제 보정', async ({
  page,
  backend,
}, info) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'choice-layout-fixture',
    () => {},
    (state) => {
      const course = structuredClone(state.courses.find((c) => c.id === 'demo-course-1')!);
      course.id = course.entityId = 'choice-layout';
      for (const question of [course.questions[0]!, course.practicalQuestions[0]!]) {
        question.choices = ['기준과 기록을 확인합니다. '.repeat(30), '두 번째 선택지', ''];
        question.correct = 0;
      }
      state.courses.push(course);
      state.courses.push({
        ...structuredClone(course),
        id: 'choice-readonly',
        entityId: 'choice-readonly',
        deletedAt: new Date().toISOString(),
        deletedBy: 'admin-1',
        deletionReason: '읽기 전용 확인',
      });
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/choice-layout');
  // Reopen the saved test fixture through its receipt to expose readiness errors.
  await saveCriterion(page);
  await openSavedCourse(page);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const kind of ['지식 평가', '상황 대응 평가']) {
      await courseSection(page, kind);
      const rows = page.locator('.objective-choice:visible');
      await expect(rows.last().locator('.choice-error')).toBeVisible();
      await page.getByLabel('1번 선택지를 정답으로 지정', { exact: true }).check();
      const before = await choiceLayout(rows, width);
      await page.getByLabel('2번 선택지를 정답으로 지정', { exact: true }).check();
      const after = await choiceLayout(rows, width);
      expect(after).toEqual(before);
      await expect(rows.nth(1).locator('.choice-status')).toBeVisible();
      await expect(rows.first().locator('.choice-status')).toBeHidden();
      const input = rows.last().locator('textarea');
      expect(await input.getAttribute('aria-describedby')).toBe(
        await rows.last().locator('.choice-error').getAttribute('id'),
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`choices-${kind}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.getByLabel('1번 선택지 삭제', { exact: true }).click();
  await expect(page.getByLabel('1번 선택지를 정답으로 지정', { exact: true })).toBeChecked();
  await expect(page.getByLabel('1번 선택지', { exact: true })).toHaveValue('두 번째 선택지');
  await page.getByLabel('1번 선택지 삭제', { exact: true }).click();
  await expect(page.locator('.objective-choice input:checked')).toHaveCount(0);
  await expect(page.locator('.choice-help')).toContainText('정답 미선택');
  await page.getByRole('button', { name: '선택지 추가', exact: true }).click();
  await expect(page.locator('.objective-choice:visible')).toHaveCount(2);
  await page.getByLabel('2번 선택지', { exact: true }).fill('새 선택지');
  await page.getByLabel('2번 선택지를 정답으로 지정', { exact: true }).check();
  await courseSection(page, '지식 평가');
  await courseSection(page, '상황 대응 평가');
  await expect(page.getByLabel('2번 선택지', { exact: true })).toHaveValue('새 선택지');
  await expect(page.getByLabel('2번 선택지를 정답으로 지정', { exact: true })).toBeChecked();
  await saveCriterion(page);
  await openSavedCourse(page, '상황 대응 평가');
  await expect(page.getByLabel('2번 선택지', { exact: true })).toHaveValue('새 선택지');
  await expect(page.getByLabel('2번 선택지를 정답으로 지정', { exact: true })).toBeChecked();
  await page.goto('/admin/courses/choice-readonly');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const kind of ['지식 평가', '상황 대응 평가']) {
      await courseSection(page, kind);
      const rows = page.locator('.objective-choice:visible');
      await expect(rows.first().locator('textarea')).toBeDisabled();
      await expect(rows.first().locator('input')).toBeDisabled();
      await choiceLayout(rows, width, true);
    }
  }
});

test('빈 항목·문항의 전체 폭 안내, 추가 초점과 삭제 후 복귀·유형 전환 보존', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'empty-fixture',
    () => {},
    (state) => {
      const course = structuredClone(state.courses.find((c) => c.id === 'demo-course-1')!);
      course.id = course.entityId = 'empty-course';
      course.learningItems = [];
      course.materials = [];
      course.questions = [];
      course.practicalQuestions = [];
      state.courses.push(course);
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/empty-course');
  await courseSection(page, '학습 정보');
  await expect(page.locator('.course-editor-content .number-tabs:visible')).toHaveCount(0);
  const empty = page.locator('.number-editor.is-empty:visible');
  expect(
    await empty.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
  ).toBe(1);
  await page.getByRole('button', { name: '교육 추가', exact: true }).click();
  await expect(page.getByLabel('교육명')).toBeFocused();
  await page.getByLabel('교육명').fill('독립 수행');
  await page.getByRole('button', { name: '교육 추가', exact: true }).click();
  await page.getByLabel('교육명').fill('작업 확인');
  const rail = page.getByRole('tablist', { name: '학습 정보 항목', exact: true });
  await rail.getByRole('tab').last().press('ArrowUp');
  await expect(page.getByLabel('교육명')).toHaveValue('독립 수행');
  await rail.getByRole('tab').first().press('ArrowDown');
  await expect(page.getByLabel('교육명')).toHaveValue('작업 확인');
  await rail.getByRole('tab').last().press('ArrowUp');
  await page.getByRole('button', { name: '이 항목 삭제', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(rail.getByRole('tab')).toHaveCount(2);
  await page.getByRole('button', { name: '이 항목 삭제', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(rail.getByRole('tab').first()).toBeFocused();
  for (const kind of ['지식 평가', '상황 대응 평가']) {
    await courseSection(page, kind);
    await expect(page.locator('.number-editor.is-empty:visible')).toBeVisible();
    await page.getByRole('button', { name: '문항 추가', exact: true }).click();
    await expect(
      page.getByLabel(kind === '지식 평가' ? '문항' : '상황 설명', { exact: true }),
    ).toBeFocused();
    await page.getByLabel('문항', { exact: true }).fill(`${kind} 입력 보존`);
    await courseSection(page, '학습 정보');
    await courseSection(page, kind);
    await expect(page.getByLabel('문항', { exact: true })).toHaveValue(`${kind} 입력 보존`);
  }
});

test('신규·미완성·무변경 저장도 목록으로 이동하고 필터·정렬·결과 안내를 보존한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses');
  await page.getByLabel('인증Set 설정 검색').fill('필터에 없는 이름');
  await page.getByLabel('상태 필터').selectOption('all');
  await page.getByLabel('목록 정렬').selectOption('desc');
  await page.getByLabel('페이지 크기').selectOption('50');
  const count = backend.store.snapshot().courses.length;
  await createCourse(page);
  await page.getByLabel('인증Set명', { exact: true }).fill('새 인증Set 저장 확인');
  await saveCriterion(page);
  await expect(page).toHaveURL(/\/admin\/courses\?lv1OrganizationId=org-photo$/);
  await expect(page.getByRole('heading', { name: '인증Set 설정', exact: true })).toBeFocused();
  await expect(page.getByLabel('인증Set 설정 검색')).toHaveValue('필터에 없는 이름');
  await expect(page.getByLabel('상태 필터')).toHaveValue('all');
  await expect(page.getByLabel('목록 정렬')).toHaveValue('desc');
  await expect(page.getByLabel('페이지 크기')).toHaveValue('50');
  const receipt = page.getByRole('region', { name: '인증Set 저장 결과' });
  await expect(receipt).toContainText('새 인증Set 저장 확인 · v1');
  await expect(receipt.locator('details')).not.toHaveAttribute('open', '');
  await receipt.locator('summary').click();
  await expect(receipt.locator('li').first()).toBeVisible();
  expect(backend.store.snapshot().courses).toHaveLength(count + 1);
  await openSavedCourse(page);
  await expect(receipt).toHaveCount(0);
  await saveCriterion(page);
  await expect(receipt).toContainText('새 인증Set 저장 확인 · v1');
  expect(backend.store.snapshot().courses).toHaveLength(count + 1);
  await page
    .locator('.admin-sidebar')
    .getByRole('link', { name: '팀 자격 설정', exact: true })
    .click();
  await page
    .locator('.admin-sidebar')
    .getByRole('link', { name: '인증Set 설정', exact: true })
    .click();
  await expect(receipt).toHaveCount(0);
});

test('새 버전 저장 뒤 최신 조회 실패는 입력을 유지하고 재시도는 중복 생성 없이 목록과 연결 근거를 표시한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  await page.getByLabel('인증Set명', { exact: true }).fill('조회 실패 후 복구');
  let saved = false;
  page.on('response', (res) => {
    if (res.request().method() === 'PUT' && res.url().includes('/api/courses/')) saved = res.ok();
  });
  await page.route('**/api/workspace*', (route) => (saved ? route.abort() : route.continue()));
  await saveCriterion(page);
  const dialog = page.getByRole('dialog', { name: '기준 저장 확인' });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/courses\/demo-course-1(?:\?|$)/);
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('조회 실패 후 복구');
  expect(
    backend.store.snapshot().courses.filter((c) => c.entityId === 'demo-course-1' && c.version > 1),
  ).toHaveLength(1);
  await page.unroute('**/api/workspace*');
  await dialog.getByRole('button', { name: '저장 확인', exact: true }).click();
  const receipt = page.getByRole('region', { name: '인증Set 저장 결과' });
  await expect(receipt).toContainText('조회 실패 후 복구 · v2');
  await expect(receipt).toContainText('기존 자격 구성에 자동 반영되지 않습니다');
  await expect(receipt.getByRole('link', { name: /자격 구성에 반영/ })).toBeVisible();
  expect(
    backend.store.snapshot().courses.filter((c) => c.entityId === 'demo-course-1' && c.version > 1),
  ).toHaveLength(1);
  await openSavedCourse(page);
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('조회 실패 후 복구');
});
