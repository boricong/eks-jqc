import { test, expect, actor } from './fixtures';
import {
  configureDashboardFixture,
  addQualification,
  addCertification,
  DASHBOARD_NOW,
} from '../../server/tests/dashboard-fixtures';
import { createCourse, saveCriterion } from './catalog-helpers';
import { writeFile } from 'node:fs/promises';

// Auditor credentials here are isolated read-only fixtures, never generated through issuance.
async function mixedTypes(backend: any) {
  await configureDashboardFixture(backend.store);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'mixed-types-fixture',
    () => {},
    (s: any) => {
      const seed = { state: s, orgs: backend.store.organizations.snapshot() };
      const q = addQualification(seed, 'fixture-auditor', {
        qualificationType: 'auditor',
        title: '협력업체 현장 Auditor ' + '긴 자격명 '.repeat(8),
      });
      const certificate = addCertification(seed, 'fixture-auditor-cert', 'alice', {
        qualificationId: q.id,
      });
      certificate.qualificationMetadata!.englishName = 'Supplier Process Auditor';
      return {};
    },
  );
  backend.setClock(DASHBOARD_NOW);
  await backend.store.refreshNotifications(DASHBOARD_NOW);
}

test('Auditor 전용 생성·기준 편집·미완성 준비 차단과 팀 소유 정보 분리', async ({
  page,
  backend,
}, testInfo) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/auditor');
  await page.getByLabel('일반 Auditor 자격명', { exact: true }).fill('협력업체 Auditor 기준');
  await page.getByRole('button', { name: '일반 Auditor 자격 생성', exact: true }).click();
  await expect(page.getByText('현재 기준 버전 · v1', { exact: true })).toBeVisible();
  const representative = backend.store.snapshot().auditorPrograms[0]!.general!;
  expect(
    backend.store.snapshot().qualificationTemplates.find((t) => t.id === representative.templateId)!
      .scope,
  ).toBe('team');
  await page.goto('/admin/courses?type=auditor');
  await createCourse(page, 'Auditor', '심사 준비 자료');
  await page.goto(`/admin/qualifications/${representative.entityId}`);
  await expect(
    page.getByText('Auditor는 필수 학습항목을 본인이 모두 확인하면 수료됩니다.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('인증기간', { exact: true }).selectOption('unlimited');
  await page.getByRole('checkbox', { name: /심사 준비 자료/ }).check();
  await saveCriterion(page);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`auditor-team-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/admin/auditor');
  const latest = backend.store
    .snapshot()
    .qualifications.filter((q) => q.templateId === representative.templateId)
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]!;
  await expect(
    page.getByText(`현재 기준 버전 · v${latest.version}`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('신규 지정 준비 · 확인 필요', { exact: true })).toBeVisible();
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/qualification-templates');
  await page.getByLabel('인증 유형 필터', { exact: true }).selectOption('auditor');
  await expect(
    page.getByRole('button', { name: '협력업체 Auditor 기준', exact: true }),
  ).toHaveCount(0);
  expect(backend.store.snapshot().certifications).toHaveLength(0);
});

test('보유 인증 유형 분리·건수·검색 유지·URL/키보드·인증서 수료증 왕복은 기록 유형을 따른다', async ({
  page,
  backend,
}, testInfo) => {
  await mixedTypes(backend);
  await page.goto('/');
  await actor(page, 'alice');
  const before = backend.store.snapshot();
  await page.goto('/qualifications?filter=certified');
  const tabs = page.getByRole('tablist', { name: '보유 인증 유형' });
  await expect(tabs.getByRole('tab', { name: 'Auditee 인증 (1)', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(tabs.getByRole('tab', { name: 'Auditor 인증 (1)', exact: true })).toBeVisible();
  await page.getByLabel('자격 검색').fill('찾을수없음');
  await tabs.getByRole('tab', { name: 'Auditee 인증 (1)', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/type=auditor/);
  await expect(page.getByLabel('자격 검색')).toHaveValue('찾을수없음');
  await expect(tabs.getByRole('tab', { name: 'Auditor 인증 (1)', exact: true })).toBeFocused();
  await expect(page.locator('.owned-qualification-row')).toHaveCount(0);
  await page.getByLabel('자격 검색').fill('');
  await page.getByLabel('자격 유효 상태').selectOption('valid');
  await expect(page.locator('.owned-qualification-row')).toHaveCount(1);
  const measurements: unknown[] = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const tab = tabs.getByRole('tab', { name: 'Auditor 인증 (1)', exact: true });
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(width <= 768 ? 44 : 40);
    const colors = await tab.evaluate((el) => {
      const style = getComputedStyle(el);
      const rgb = (s: string) =>
        s
          .match(/[\d.]+/g)!
          .map(Number)
          .slice(0, 3);
      const lum = (s: string) =>
        rgb(s)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const contrast = (a: string, b: string) =>
        (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      return {
        text: contrast(style.color, style.backgroundColor),
        indicator: contrast(style.borderBottomColor, style.backgroundColor),
      };
    });
    expect(colors.text).toBeGreaterThanOrEqual(4.5);
    expect(colors.indicator).toBeGreaterThanOrEqual(3);
    measurements.push({ width, ...colors });
    await page.screenshot({
      path: testInfo.outputPath(`owned-types-${width}.png`),
      fullPage: true,
    });
  }
  await writeFile(testInfo.outputPath('types-layout.json'), JSON.stringify(measurements, null, 2));
  await page.locator('.owned-qualification-row').click();
  await expect(
    page.getByRole('heading', { name: 'Auditor 자격 인증서', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '수료 근거 펼치기', exact: true }).click();
  await expect(
    page.getByText('이전 Auditor 인증·등급 미지정 기록입니다.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '재인증 시작', exact: true })).toHaveCount(0);
  await expect(page.getByText('재취득 계획·요청 확인', { exact: true })).toHaveCount(0);
  await page.locator('.evidence-course summary').first().click();
  await page.getByRole('link', { name: '인증Set 수료증 보기 →', exact: true }).first().click();
  await page.locator('.back-link').click();
  await expect(
    page.getByRole('heading', { name: 'Auditor 자격 인증서', exact: true }),
  ).toBeVisible();
  await page.locator('.back-link').click();
  await expect(page).toHaveURL(/filter=certified&type=auditor/);
  await page.reload();
  await expect(tabs.getByRole('tab', { name: 'Auditor 인증 (1)', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await tabs.getByRole('tab', { name: 'Auditee 인증 (1)', exact: true }).click();
  await expect(page).toHaveURL(/filter=certified$/);
  await page.goBack();
  await expect(tabs.getByRole('tab', { name: 'Auditor 인증 (1)', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goto('/qualifications?filter=certified&type=unknown');
  await expect(page).toHaveURL(/filter=certified$/);
  await page.goto('/certifications/assignment-active-cert?from=owned&type=auditor');
  await expect(
    page.getByRole('heading', { name: 'Auditee 자격 인증서', exact: true }),
  ).toBeVisible();
  await page.locator('.back-link').click();
  await expect(page).toHaveURL(/filter=certified$/);
  expect(backend.store.snapshot()).toEqual(before);
});

test('Auditor 빈 탭은 절차 준비 안내만 제공하며 계정 전환은 본인 기록만 표시한다', async ({
  page,
  backend,
}) => {
  await mixedTypes(backend);
  await page.goto('/');
  await actor(page, 'bob');
  await page.goto('/qualifications?filter=certified&type=auditor');
  await expect(page.getByRole('tab', { name: 'Auditor 인증 (0)', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByText('현재 보유한 Auditor 인증이 없습니다.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.owned-qualification-row')).toHaveCount(0);
  await expect(page.locator('.empty-state .button')).toHaveCount(0);
  await actor(page, 'alice');
  await page.goto('/qualifications?filter=certified&type=auditor');
  await expect(page.locator('.owned-qualification-row')).toHaveCount(1);
});
