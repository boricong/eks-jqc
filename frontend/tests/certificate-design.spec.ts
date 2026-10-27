import { test, expect, actor } from './fixtures';
import { configureDashboardFixture, DASHBOARD_NOW } from '../../server/tests/dashboard-fixtures';
import type { JsonStore } from '../../server/src/storage';
import { writeFile } from 'node:fs/promises';

const aid = 'assignment-active-cert';
const uuid = 'f24b1876-83a8-4f29-a9ab-e2fbde0ea180';
const issuedTitle = '발급 당시 직무 전문 자격';
async function prepare(store: JsonStore) {
  await configureDashboardFixture(store);
  await store.transact(
    'operator-1',
    crypto.randomUUID(),
    'certificate-design-fixture',
    () => {},
    (s) => {
      const cert = s.certifications.find((c) => c.assignmentId === aid)!;
      const assignment = s.assignments.find((a) => a.id === aid)!;
      cert.id = uuid;
      cert.snapshot = {
        learnerName: '발급 당시 취득자',
        title: issuedTitle,
        version: 7,
        source: 'issued',
        organizationPath: assignment.organizationPath,
      };
      for (const ref of cert.evidence) {
        const completion = s.completions.find((c) => c.id === ref.completionId)!;
        completion.snapshot = { ...cert.snapshot, title: '발급 당시 인증Set', version: 3 };
      }
      s.qualifications.find((q) => q.id === assignment.qualificationId)!.title = '최신 관리 자격명';
      return {};
    },
  );
  await store.refreshNotifications(DASHBOARD_NOW);
}

test('보유 목록은 이름·취득일·현재 만료일·상태만 표시하고 상세는 발급 스냅샷을 사용한다', async ({
  page,
  backend,
}) => {
  await prepare(backend.store);
  backend.setClock(DASHBOARD_NOW);
  await page.goto('/');
  await actor(page, 'alice');
  const before = backend.store.snapshot();
  await page.goto('/qualifications?filter=certified');
  const row = page.locator('.owned-qualification-row');
  await expect(row).toContainText(issuedTitle);
  await expect(row.locator('.owned-acquired')).toContainText('2025-11-10');
  await expect(row.locator('.owned-expires')).toContainText('2026-11-10');
  await expect(row.locator('.validity-badge')).toHaveText('유효');
  await expect(
    row.locator('.qualification-progress, .qualification-target, .renewal-phase-label'),
  ).toHaveCount(0);
  await expect(row).not.toContainText(/인증Set|v7|재인증 시작/);
  await page.getByLabel('자격 검색').fill(issuedTitle);
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/certifications/${aid}\\?from=owned$`));
  await expect(page.locator('.certificate-identifier dd')).toHaveText(uuid);
  await expect(page.locator('.certificate-title')).toHaveText(issuedTitle);
  await expect(page.locator('.certificate-recipient')).toHaveText('발급 당시 취득자');
  await expect(page.locator('.release-footer').first()).toContainText('v7.0');
  await expect(page.locator('.certificate-record')).toContainText('발급 당시 정보');
  await expect(page.locator('.certificate-document')).not.toContainText('최신 관리 자격명');
  await expect(page.getByRole('button', { name: '최신 상태 확인', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '수료 근거 펼치기', exact: true }).click();
  const summary = page.locator('.evidence-course summary').first();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.certificate-evidence')).toContainText('발급 당시 인증Set');
  await expect(page.locator('.certificate-evidence')).toContainText('v3');
  await expect(page.locator('.certificate-attempt').first()).toContainText('확정 일시');
  await expect(page.locator('.certificate-evidence')).not.toContainText('정답');
  const lifecycle = page.locator('.lifecycle-panel');
  await expect(lifecycle).toBeVisible();
  expect(
    await lifecycle.evaluate((el) =>
      el.lastElementChild?.classList.contains('certificate-renewal'),
    ),
  ).toBe(true);
  const action = page.getByRole('link', { name: '재인증 대상·평가 확인', exact: true });
  await expect(action).toBeEnabled();
  expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await page.getByRole('link', { name: '인증Set 수료증 보기 →', exact: true }).first().click();
  await page.locator('.back-link').click();
  await expect(page.locator('.certificate-title')).toHaveText(issuedTitle);
  expect(backend.store.snapshot()).toEqual(before);
});

test('인증서 조회 실패 재시도와 계정 전환 후 지연된 이전 응답 무시', async ({ page, backend }) => {
  await prepare(backend.store);
  backend.setClock(DASHBOARD_NOW);
  await page.goto('/');
  await actor(page, 'alice');
  let fail = true;
  await page.route(`**/api/certifications/${uuid}/history*`, async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '인증 이력 조회 실패' }),
      });
    else await route.continue();
  });
  await page.goto(`/certifications/${aid}?from=owned`);
  await expect(page.getByRole('alert')).toContainText('인증 이력 조회 실패');
  await expect(page.locator('.certificate-identifier dd')).toHaveText(uuid);
  fail = false;
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '현재 효력', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '다시 불러오기', exact: true })).toHaveCount(0);
  await page.unroute(`**/api/certifications/${uuid}/history*`);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted!: () => void;
  const seen = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route(`**/api/certifications/${uuid}/history*`, async (route) => {
    const response = await route.fetch();
    intercepted();
    await gate;
    await route.fulfill({ response });
  });
  await page.reload();
  await seen;
  await actor(page, 'bob');
  await page.goto('/certifications/assignment-held-cert?from=owned');
  await expect(page.locator('.certificate-current .lifecycle-badge')).toContainText('정지');
  release();
  await expect(page.locator('.certificate-identifier dd')).not.toHaveText(uuid);
  await expect(page.locator('.certificate-current .lifecycle-badge')).toContainText('정지');
});

test('이관·스냅샷 없는 기록·무기한·기간 미설정·폐기 상태를 구별한다', async ({ page, backend }) => {
  await prepare(backend.store);
  backend.setClock(DASHBOARD_NOW);
  await page.goto('/');
  await actor(page, 'alice');
  for (const state of ['migration', 'legacy', 'unlimited', 'unknown', 'revoked'] as const) {
    await backend.store.transact(
      'operator-1',
      crypto.randomUUID(),
      `certificate-${state}`,
      () => {},
      (s) => {
        const c = s.certifications.find((c) => c.id === uuid)!;
        if (state === 'migration') c.snapshot!.source = 'migration';
        if (state === 'legacy') c.snapshot = undefined;
        if (state === 'unlimited') {
          c.periods!.at(-1)!.validity = { type: 'unlimited', months: null, reminderDays: [] };
          c.periods!.at(-1)!.expiresOn = undefined;
          c.validity = c.periods!.at(-1)!.validity;
          c.expiresOn = undefined;
        }
        if (state === 'unknown') {
          c.periods!.at(-1)!.validity = { type: 'unknown', months: null, reminderDays: [] };
          c.validity = c.periods!.at(-1)!.validity;
          c.lifecycleStatus = 'Hold';
        }
        if (state === 'revoked') c.lifecycleStatus = 'Revoke';
        c.revision!++;
        return {};
      },
    );
    await page.goto(`/certifications/${aid}?from=owned`);
    await page.reload();
    await expect(page.getByRole('heading', { name: '현재 효력', exact: true })).toBeVisible();
    if (state === 'migration')
      await expect(page.locator('.certificate-record')).toContainText('이관 시 확보한 정보');
    if (state === 'legacy')
      await expect(page.locator('.certificate-record')).toContainText('기존 기록 기준');
    if (state === 'unlimited')
      await expect(page.locator('.certificate-current-facts')).toContainText('무기한');
    if (state === 'unknown')
      await expect(page.locator('.certificate-current .lifecycle-badge')).toContainText('미설정');
    if (state === 'revoked')
      await expect(page.locator('.certificate-current')).toContainText('폐기된 자격');
  }
});

test('긴 인증서·UUID와 보유 목록의 네 화면 폭·타이포그래피·조작 크기·대비', async ({
  page,
  backend,
}, info) => {
  await prepare(backend.store);
  backend.setClock(DASHBOARD_NOW);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'long-certificate',
    () => {},
    (s) => {
      const c = s.certifications.find((c) => c.id === uuid)!;
      c.snapshot!.title = '긴 이름의 반도체 공정 운영 전문 자격 '.repeat(5);
      c.snapshot!.learnerName = '발급 당시 취득자 이름';
      c.snapshot!.organizationPath.at(-1)!.name = '아주 긴 조직 이름 '.repeat(6);
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'alice');
  const metrics = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/qualifications?filter=certified');
    await expect(page.locator('.owned-qualification-row')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`owned-${width}.png`), fullPage: true });
    await page.locator('.owned-qualification-row').click();
    await expect(page.getByRole('heading', { name: '현재 효력', exact: true })).toBeVisible();
    await expect(page.locator('.certificate-title')).toHaveCSS('font-size', '24px');
    await expect(page.locator('.certificate-recipient')).toHaveCSS('font-size', '18px');
    await expect(page.locator('.certificate-identifier dd')).toHaveCSS('font-size', '13px');
    await expect(page.locator('.certificate-identifier dd')).toHaveText(uuid);
    const action = page.getByRole('link', { name: '재인증 대상·평가 확인', exact: true });
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const ratios = await page.evaluate(() => {
      const rgb = (s: string) => s.match(/[\d.]+/g)!.map(Number);
      const bg = (el: Element | null): string => {
        if (!el) return 'rgb(255,255,255)';
        const color = getComputedStyle(el).backgroundColor;
        return (rgb(color)[3] ?? 1) === 1 ? color : bg(el.parentElement);
      };
      const lum = (s: string) =>
        rgb(s)
          .slice(0, 3)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const contrast = (a: string, b: string) => {
        const x = lum(a),
          y = lum(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      return [
        ...document.querySelectorAll(
          '.certificate-page dt,.certificate-page dd,.certificate-eyebrow,.certificate-title,.lifecycle-badge,.certificate-renewal .button',
        ),
      ]
        .filter((el) => el.getBoundingClientRect().height)
        .map((el) => contrast(getComputedStyle(el).color, bg(el)));
    });
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('button', { name: '수료 근거 펼치기', exact: true }).click();
    await page.locator('.evidence-course summary').first().focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const focus = await page
      .locator('.evidence-course summary')
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        const lum = (color: string) =>
          color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((v) => v / 255)
            .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
            .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i]!, 0);
        const f = lum(style.outlineColor);
        return { visible: el.matches(':focus-visible'), ratio: 1.05 / (f + 0.05) };
      });
    expect(focus.visible).toBe(true);
    expect(focus.ratio).toBeGreaterThanOrEqual(3);
    metrics.push({ width, minText: Math.min(...ratios), focus: focus.ratio });
    await page.keyboard.press('Enter');
    await expect(page.locator('.certificate-attempt').first()).toBeVisible();
    await page.screenshot({ path: info.outputPath(`certificate-${width}.png`), fullPage: true });
  }
  await info.attach('certificate-metrics', {
    body: JSON.stringify(metrics),
    contentType: 'application/json',
  });
  await writeFile(info.outputPath('certificate-metrics.json'), JSON.stringify(metrics, null, 2));
});
