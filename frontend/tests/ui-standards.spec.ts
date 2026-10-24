import { test, expect, actor, answerConfirmation } from './fixtures';
import type { Page } from '@playwright/test';

const widths = [1920, 1440, 768, 390];
async function audit(page: Page) {
  const result = await page.evaluate(() => {
    const visible = (e: Element) =>
      e.getBoundingClientRect().height > 0 && !!e.getClientRects().length;
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        'input:not([type="checkbox"]):not([type="radio"]),select,textarea,button',
      ),
    ].filter(visible);
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      fonts: controls
        .filter((e) => !getComputedStyle(e).fontFamily.startsWith('"Pretendard Variable"'))
        .map((e) => e.outerHTML.slice(0, 180)),
      smallInputs: controls
        .filter(
          (e) =>
            /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName) &&
            parseFloat(getComputedStyle(e).fontSize) < (innerWidth <= 768 ? 16 : 14),
        )
        .map((e) => e.outerHTML.slice(0, 180)),
      smallTargets:
        innerWidth > 768
          ? []
          : [
              ...document.querySelectorAll<HTMLElement>(
                '.button,.icon-button,[role="tab"],select,input:not([type="checkbox"]):not([type="radio"])',
              ),
            ]
              .filter(visible)
              .filter((e) => e.getBoundingClientRect().height < 44)
              .map((e) => ({
                text: e.textContent?.trim().slice(0, 50),
                class: e.className,
                height: e.getBoundingClientRect().height,
              })),
    };
  });
  expect(result, page.url()).toEqual({
    overflow: false,
    fonts: [],
    smallInputs: [],
    smallTargets: [],
  });
  await expect(page.getByTestId('process-guide').getByRole('button').first()).toHaveAttribute(
    'aria-expanded',
    'false',
  );
}

const routes = {
  'learner-1': ['/', '/qualifications', '/plans', '/notifications'],
  'admin-1': [
    '/',
    ...[
      'catalog',
      'credentials',
      'targets',
      'policies',
      'qualifications',
      'courses',
      'assignments',
      'results',
      'notices',
    ].map((s) => `/admin/${s}`),
    '/admin/courses/demo-course-1',
    '/admin/qualifications/demo-qualification',
  ],
  'operator-1': [
    '/',
    ...['organizations', 'users', 'overview', 'testing', 'notices'].map((s) => `/system/${s}`),
  ],
  'learner-2': ['/', '/admin/policies', '/admin/targets'],
};
for (const [id, paths] of Object.entries(routes)) {
  test(`${id} 전체 메뉴의 네 화면 폭·글꼴·입력·조작 기준`, async ({ page, backend }, info) => {
    test.setTimeout(120000);
    if (id === 'learner-2')
      await backend.store.transact(
        'operator-1',
        crypto.randomUUID(),
        'ui-org-admin',
        () => {},
        (s) => {
          const user = s.users.find((u) => u.id === id)!;
          user.organizationAdministration = {
            organizationId: user.organizationId,
            grantedBy: 'operator-1',
            grantedAt: new Date().toISOString(),
          };
          return {};
        },
      );
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await actor(page, id);
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await audit(page);
        if (width === 1920 || width === 390)
          await page.screenshot({
            path: info.outputPath(`${path.replaceAll('/', '-') || 'home'}-${width}.png`),
            fullPage: true,
          });
      }
      if (path.startsWith('/admin/'))
        await expect(page.locator('.admin-sidebar .organization-context')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test('홈 공지의 첫 화면 배치와 관리 표의 실제 글자 크기', async ({ page }) => {
  await page.goto('/');
  for (const id of ['learner-1', 'admin-1', 'operator-1']) {
    await actor(page, id);
    for (const name of ['시스템 공지', '내 팀 공지']) {
      const heading = page.getByRole('heading', { name, exact: true });
      await expect(heading).toBeInViewport();
    }
    await expect(page.locator('.home-journey,.focus-card,.home-heading .eyebrow')).toHaveCount(0);
  }
  await actor(page, 'admin-1');
  for (const path of ['/admin/catalog', '/admin/qualifications', '/admin/courses']) {
    await page.goto(path);
    for (const th of await page.locator('th').all())
      await expect(th).toHaveCSS('font-size', '14px');
  }
});

test('확인창의 취소·키보드 초점 복귀·이동과 중첩 확인에서 입력 보존', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  const title = page.getByLabel('인증Set명', { exact: true });
  await title.fill('저장하지 않은 변경');
  const link = page
    .getByRole('navigation', { name: '관리 메뉴' })
    .getByRole('link', { name: '팀 자격 설정', exact: true });
  await link.click();
  const confirmation = page.getByTestId('app-confirmation');
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('button', { name: '취소', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).not.toBeVisible();
  await expect(link).toBeFocused();
  await expect(title).toHaveValue('저장하지 않은 변경');
  await link.click();
  await answerConfirmation(page, true);
  await expect(page).toHaveURL(/\/admin\/qualifications/);
  expect(backend.store.snapshot().courses.find((c) => c.id === 'demo-course-1')!.title).not.toBe(
    '저장하지 않은 변경',
  );

  await actor(page, 'operator-1');
  await page.goto('/system/notices');
  const create = page.getByRole('button', { name: '시스템 공지 작성', exact: true });
  await create.click();
  await page.getByRole('dialog').getByLabel('제목', { exact: true }).fill('작성 중인 공지');
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('제목', { exact: true })).toHaveValue(
    '작성 중인 공지',
  );
  await page.keyboard.press('Escape');
  await answerConfirmation(page, true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(create).toBeFocused();
});

test('평면 관리 목록의 제목·행 작업·취소 초점과 의미 색상 대비', async ({ page, backend }) => {
  const revision = backend.store.snapshot().revision;
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications');
  await expect(page.locator('h1')).toHaveCSS('font-size', '24px');
  await expect(page.locator('.topbar')).toHaveCSS('height', '56px');
  for (const selector of ['.management-context', '.table-panel', '.list-controls']) {
    await expect(page.locator(selector)).toHaveCSS('border-radius', '0px');
    await expect(page.locator(selector)).toHaveCSS('box-shadow', 'none');
  }
  const table = await page.locator('.table-panel').boundingBox();
  const controls = await page.locator('.list-controls').boundingBox();
  expect(controls!.y).toBeGreaterThanOrEqual(table!.y + table!.height - 1);
  const more = page.getByRole('button', { name: '평가 흐름 체험 더보기', exact: true });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '자격 삭제', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await page.getByRole('button', { name: '자격 삭제', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('삭제 사유')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  expect(backend.store.snapshot().revision).toBe(revision);
  const ratios = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const lum = (hex: string) => {
      const rgb = hex
        .trim()
        .replace('#', '')
        .match(/../g)!
        .map((s) => parseInt(s, 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
    };
    return [
      ['--on-primary', '--primary', 4.5],
      ['--ink-muted', '--surface-tint', 4.5],
      ['--success', '--success-bg', 4.5],
      ['--warning', '--warning-bg', 4.5],
      ['--danger', '--danger-bg', 4.5],
      ['--control-border', '--surface', 3],
    ].map(([fg, bg, minimum]) => {
      const a = lum(css.getPropertyValue(String(fg))),
        b = lum(css.getPropertyValue(String(bg)));
      return {
        fg,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        minimum: Number(minimum),
      };
    });
  });
  for (const pair of ratios)
    expect(pair.ratio, String(pair.fg)).toBeGreaterThanOrEqual(pair.minimum);
});

test('긴 학습·평가 내용의 글자 위계와 네 화면 폭에서 응시 조작', async ({
  page,
  backend,
}, info) => {
  await backend.store.transact(
    'admin-1',
    'reading-layout',
    'reading-layout',
    () => {},
    (s) => {
      const course = s.courses.find((c) => c.id === 'demo-course-2')!;
      course.questions[0]!.prompt =
        '장비 상태와 기준 문서를 확인한 뒤 다음 작업을 선택합니다. '.repeat(12);
      course.questions[0]!.choices[0] = '기준을 확인하고 기록을 남깁니다. '.repeat(10);
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1/courses/demo-course-2/objective');
  await expect(page.locator('.answer-panel')).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await audit(page);
    await expect(page.locator('h1')).toHaveCSS('font-size', '24px');
    await expect(page.locator('.answer-panel > h3')).toHaveCSS('font-size', '16px');
    await expect(page.locator('.choice').first()).toHaveCSS('font-size', '14px');
    await expect(page.locator('.choice input').first()).toBeEnabled();
    await page.locator('.choice input').first().focus();
    await expect(page.locator('.choice input').first()).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.locator('.choice input').first()).toBeChecked();
    await page.screenshot({ path: info.outputPath(`reading-${width}.png`), fullPage: true });
  }
});
