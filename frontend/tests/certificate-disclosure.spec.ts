import { test, expect, actor } from './fixtures';
import {
  dashboardSeed,
  addCertification,
  configureDashboardFixture,
  DASHBOARD_NOW,
} from '../../server/tests/dashboard-fixtures';
import type { JsonStore } from '../../server/src/storage';
import { writeFile } from 'node:fs/promises';

const aid = 'assignment-disclosure-cert';
const english = 'Semiconductor Process Operations Professional';
async function prepare(store: JsonStore, count = 1) {
  await configureDashboardFixture(store);
  const seed = dashboardSeed();
  const original = seed.state.courses[0]!;
  seed.state.courses = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(original),
    id: `disclosure-course-${index}`,
    entityId: `disclosure-course-${index}`,
    title: `공정 전문 인증Set ${index + 1}`,
  }));
  const qualification = seed.state.qualifications[0]!;
  qualification.courseIds = seed.state.courses.map((c) => c.id);
  qualification.englishName = 'Assignment Preserved English';
  const cert = addCertification(seed, 'disclosure-cert', 'alice', { expiresOn: '2026-11-10' });
  const assignment = seed.state.assignments.find((a) => a.id === aid)!;
  cert.qualificationMetadata = { ...assignment.qualificationMetadata!, englishName: english };
  addCertification(seed, 'bob-cert', 'bob', { status: 'Hold' });
  qualification.englishName = 'Current Catalog English';
  await store.transact(
    'operator-1',
    crypto.randomUUID(),
    'disclosure-fixture',
    () => {},
    (s) => {
      const revision = s.revision;
      Object.assign(s, seed.state, { revision });
      return {};
    },
  );
  await store.refreshNotifications(DASHBOARD_NOW);
}

for (const count of [1, 15, 30]) {
  test(`인증Set ${count}개의 기본 접힘·개별 상세·키보드·동일 인증서 재조회 상태 보존`, async ({
    page,
    backend,
  }, info) => {
    await prepare(backend.store, count);
    backend.setClock(DASHBOARD_NOW);
    await page.goto('/');
    await actor(page, 'alice');
    await page.goto(`/certifications/${aid}?from=owned`);
    await expect(page.getByRole('heading', { name: '현재 효력', exact: true })).toBeVisible();
    const before = backend.store.snapshot();
    const toggles = page.locator('.certificate-disclosure .collapsible-section-toggle');
    await expect(toggles).toHaveCount(3);
    for (const button of await toggles.all())
      await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.evidence-course summary').first()).not.toBeVisible();
    const evidence = page.locator('.certificate-evidence .collapsible-section-toggle');
    await expect(evidence).toContainText(`인증Set ${count}개 · 펼쳐 보기`);
    await evidence.focus();
    await page.keyboard.press('Enter');
    await expect(evidence).toHaveAttribute('aria-expanded', 'true');
    const panelId = await evidence.getAttribute('aria-controls');
    await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
    await expect(page.locator('.evidence-course summary')).toHaveCount(count);
    const first = page.locator('.evidence-course').first();
    await first.locator('summary').focus();
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('open', '');
    await expect(first.locator('.certificate-detail-action')).toHaveText('접기');
    await expect(first.locator('.certificate-attempt').first()).toBeVisible();
    await evidence.click();
    await expect(first).not.toBeVisible();
    await evidence.click();
    await expect(first).toHaveAttribute('open', '');
    const events = page.getByRole('button', { name: '취득·변경 이력 펼치기', exact: true });
    await events.focus();
    await page.keyboard.press('Space');
    await expect(
      page.getByText('기록된 취득·변경 이력이 없습니다.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '유효기간·갱신 근거 펼치기', exact: true }).click();
    const refreshed = page.waitForResponse(
      (r) =>
        r.url().includes('/certifications/disclosure-cert/history') &&
        r.request().method() === 'GET',
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await refreshed;
    await expect(toggles.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(toggles.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(toggles.nth(2)).toHaveAttribute('aria-expanded', 'true');
    await expect(first).toHaveAttribute('open', '');
    expect(backend.store.snapshot()).toEqual(before);
    // A revision refresh may remount the loaded body; local disclosure state must survive it.
    await backend.store.transact(
      'operator-1',
      crypto.randomUUID(),
      'credential-revision',
      () => {},
      (s) => {
        s.certifications.find((c) => c.id === 'disclosure-cert')!.revision!++;
        return {};
      },
    );
    const revised = page.waitForResponse((r) =>
      r.url().includes('/certifications/disclosure-cert/history'),
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await revised;
    await expect(toggles.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(toggles.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(first).toHaveAttribute('open', '');
    await page.screenshot({ path: info.outputPath(`expanded-${count}.png`), fullPage: true });
    await actor(page, 'bob');
    await page.goto('/certifications/assignment-bob-cert?from=owned');
    await expect(page.locator('.certificate-current')).toContainText('정지');
    for (const button of await toggles.all())
      await expect(button).toHaveAttribute('aria-expanded', 'false');
    await actor(page, 'alice');
    await page.goto(`/certifications/${aid}?from=owned`);
    await expect(evidence).toHaveAttribute('aria-expanded', 'false');
    await evidence.click();
    await expect(page.locator('.evidence-course[open]')).toHaveCount(0);
    if (count === 1) {
      await actor(page, 'admin-1');
      await page.goto(`/certifications/${aid}?lv1OrganizationId=org-photo`);
      await evidence.click();
      await page.getByRole('button', { name: '취득·변경 이력 펼치기', exact: true }).click();
      await page.goto(`/certifications/${aid}`);
      for (const button of await toggles.all())
        await expect(button).toHaveAttribute('aria-expanded', 'false');
      await evidence.click();
      await page.goto('/certifications/assignment-bob-cert');
      await expect(page.locator('.certificate-current')).toContainText('정지');
      for (const button of await toggles.all())
        await expect(button).toHaveAttribute('aria-expanded', 'false');
    }
  });
}

test('영문명은 인증서 보존값을 우선하고 명시적 빈 값과 미등록에 현재 관리명을 사용하지 않는다', async ({
  page,
  backend,
}) => {
  await prepare(backend.store);
  backend.setClock(DASHBOARD_NOW);
  await page.goto('/');
  await actor(page, 'alice');
  for (const variant of ['issued', 'blank', 'whitespace', 'assignment', 'none'] as const) {
    await backend.store.transact(
      'operator-1',
      crypto.randomUUID(),
      `english-${variant}`,
      () => {},
      (s) => {
        const cert = s.certifications.find((c) => c.id === 'disclosure-cert')!;
        const assignment = s.assignments.find((a) => a.id === aid)!;
        const preserved = assignment.qualificationMetadata!;
        cert.qualificationMetadata =
          variant === 'assignment' || variant === 'none'
            ? undefined
            : {
                ...preserved,
                englishName: variant === 'blank' ? '' : variant === 'whitespace' ? '   ' : english,
              };
        if (variant === 'none') assignment.qualificationMetadata = undefined;
        s.qualifications.find((q) => q.id === cert.qualificationId)!.englishName =
          'CHANGED CURRENT ENGLISH';
        return {};
      },
    );
    await page.goto(`/certifications/${aid}?from=owned`);
    await page.reload();
    if (variant === 'issued' || variant === 'assignment') {
      const name = page.locator('.certificate-english-name');
      await expect(name).toHaveText(
        variant === 'issued' ? english : 'Assignment Preserved English',
      );
      await expect(name).toHaveAttribute('lang', 'en');
      await expect(name).toHaveCSS('font-size', '18px');
      await expect(name).toHaveCSS('font-weight', '500');
    } else {
      await expect(page.locator('.certificate-english-name')).toHaveCount(0);
      await expect(page.getByText('영문 자격명 미등록', { exact: true })).toBeVisible();
    }
    await expect(page.locator('.certificate-document')).not.toContainText(
      'CHANGED CURRENT ENGLISH',
    );
  }
});

test('긴 영문명과 30개 근거의 네 화면 폭·초기 높이·명확한 동작·대비·모바일 조작', async ({
  page,
  backend,
}, info) => {
  await prepare(backend.store, 30);
  backend.setClock(DASHBOARD_NOW);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'long-english',
    () => {},
    (s) => {
      s.certifications.find((c) => c.id === 'disclosure-cert')!.qualificationMetadata!.englishName =
        `${english} `.repeat(6);
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'alice');
  const metrics = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/certifications/${aid}?from=owned`);
    const name = page.locator('.certificate-english-name');
    await expect(name).toBeVisible();
    const evidence = page.getByRole('button', { name: '수료 근거 펼치기', exact: true });
    await expect(evidence).toContainText('인증Set 30개 · 펼쳐 보기');
    const collapsed = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await evidence.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const values = await evidence.evaluate((el) => {
      const color = (v: string) => v.match(/[\d.]+/g)!.map(Number);
      const bg = (e: Element | null): string => {
        if (!e) return 'rgb(255,255,255)';
        const c = getComputedStyle(e).backgroundColor;
        return (color(c)[3] ?? 1) === 1 ? c : bg(e.parentElement);
      };
      const lum = (v: string) =>
        color(v)
          .slice(0, 3)
          .map((n) => n / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
          .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const contrast = (a: string, b: string) => {
        const x = lum(a),
          y = lum(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const style = getComputedStyle(el);
      const labels = [
        ...el.querySelectorAll('span'),
        document.querySelector('.certificate-english-name')!,
      ];
      return {
        height: el.getBoundingClientRect().height,
        minText: Math.min(...labels.map((e) => contrast(getComputedStyle(e).color, bg(e)))),
        focus: contrast(style.outlineColor, bg(el)),
        focused: el.matches(':focus-visible'),
      };
    });
    expect(values.height).toBeGreaterThanOrEqual(44);
    expect(values.minText).toBeGreaterThanOrEqual(4.5);
    expect(values.focus).toBeGreaterThanOrEqual(3);
    expect(values.focused).toBe(true);
    await page.screenshot({ path: info.outputPath(`collapsed-${width}.png`), fullPage: true });
    await page.keyboard.press('Enter');
    await expect(page.locator('.evidence-course summary')).toHaveCount(30);
    const expanded = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(expanded - collapsed).toBeGreaterThan(1000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.locator('.evidence-course summary').first().click();
    await expect(page.locator('.certificate-detail-action').first()).toHaveText('접기');
    await page.screenshot({ path: info.outputPath(`expanded-${width}.png`), fullPage: true });
    metrics.push({ width, collapsed, expanded, ...values });
  }
  await writeFile(info.outputPath('disclosure-metrics.json'), JSON.stringify(metrics, null, 2));
});
