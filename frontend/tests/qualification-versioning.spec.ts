import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { JsonStore } from '../../server/src/storage';
import { test, expect, actor, answerConfirmation } from './fixtures';
const path = '/admin/qualifications/demo-qualification';
const dialogFor = (page: Page) => page.getByRole('dialog', { name: '기준 저장 확인', exact: true });
const save = (page: Page) => page.getByRole('button', { name: '저장', exact: true });
async function setup(page: Page, store: JsonStore, long = false) {
  await store.transact(
    'admin-1',
    crypto.randomUUID(),
    'version-ui',
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      q.validity = { type: 'months', months: 36, reminderDays: [] };
      q.renewalLeadMonths = 3;
      q.renewalNoticeDaysBefore = 7;
      if (long) {
        const t = s.qualificationTemplates.find((t) => t.id === q.templateId)!;
        t.title = '설비 상태와 공정 조건을 독립적으로 확인하는 팀 자격 '.repeat(3);
      }
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(path);
  await expect(page.getByLabel('인증기간', { exact: true })).toBeEnabled();
}
function ratio(a: string, b: string) {
  const lum = (v: string) => {
    const c = v
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((n) => {
        const x = n / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
    return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
  };
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('마이너 기본 현재 버전·네 폭 모달·완료 배정의 종전 기간 표시', async ({
  page,
  backend,
}, info) => {
  await setup(page, backend.store, true);
  await page.getByLabel('인증기간', { exact: true }).selectOption('months');
  await page.getByRole('spinbutton', { name: '유효 개월 수' }).fill('12');
  const before = backend.store.snapshot();
  await save(page).click();
  const dialog = dialogFor(page),
    current = dialog.getByRole('radio', { name: /^현재 버전에 저장/ });
  await expect(current).toBeChecked();
  await expect(dialog).not.toContainText('기존 진행과 팀 적용 버전은 변경하지 않습니다.');
  await expect(dialog).toContainText('이미 완료된 계획과 기존 발급 기간은 유지');
  expect(backend.store.snapshot()).toEqual(before);
  const metrics = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.keyboard.press('Tab');
    await current.focus();
    await expect(current).toBeFocused();
    const label = current.locator('..');
    await expect(label).toHaveCSS('outline-style', 'solid');
    await expect(label).toHaveCSS('outline-width', '2px');
    expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const colors = await label.evaluate((el) => ({
      text: getComputedStyle(el).color,
      bg: getComputedStyle(el).backgroundColor,
      focus: getComputedStyle(el).outlineColor,
    }));
    expect(ratio(colors.text, colors.bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colors.focus, colors.bg)).toBeGreaterThanOrEqual(3);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    metrics.push({
      width,
      text: ratio(colors.text, colors.bg),
      focus: ratio(colors.focus, colors.bg),
      dialog: await dialog.boundingBox(),
    });
    await page.screenshot({ path: info.outputPath(`minor-${width}.png`), fullPage: true });
  }
  await dialog.getByRole('button', { name: '현재 버전에 저장', exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = backend.store.snapshot();
  expect(after.qualifications.find((q) => q.id === 'demo-qualification')!.version).toBe(1);
  expect(after.qualifications.find((q) => q.id === 'demo-qualification')!.validity.months).toBe(12);
  expect(
    after.assignments.find((a) => a.id === 'assignment-1')!.qualificationPolicySnapshot?.validity
      .months,
  ).toBe(36);
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1');
  await page.getByRole('button', { name: '자격 정보', exact: true }).click();
  await expect(page.getByRole('region', { name: '자격 상세 정보', exact: true })).toContainText(
    /3년|36개월/,
  );
  await writeFile(info.outputPath('save-contrast.json'), JSON.stringify(metrics, null, 2));
});

test('변경 없음은 쓰기 없음·인증Set 변경은 강제·취소 후 선택 복원과 마이너 새 버전', async ({
  page,
  backend,
}, info) => {
  await setup(page, backend.store);
  const before = backend.store.snapshot();
  await save(page).click();
  const dialog = dialogFor(page);
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await dialog.locator('.dialog-footer').getByRole('button', { name: '닫기', exact: true }).click();
  await expect(save(page)).toBeFocused();
  expect(backend.store.snapshot()).toEqual(before);
  const course = page.locator('[data-course-id="demo-course-1"]').getByRole('checkbox');
  await course.uncheck();
  await save(page).click();
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await expect(dialog).toContainText('인증Set 구성 변경으로 새 버전 생성이 필요');
  await expect(dialog.getByRole('button', { name: '새 버전 생성', exact: true })).toBeEnabled();
  await dialog.getByText(/변경 전후 확인/).click();
  await expect(dialog).toContainText('자료 확인 v1');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '새 버전 생성', exact: true }).focus();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
    await dialog.screenshot({ path: info.outputPath(`major-dialog-${width}.png`) });
    await page.screenshot({ path: info.outputPath(`major-${width}.png`), fullPage: true });
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await course.check();
  await page.getByLabel('재인증 시작 · 만료 전 개월', { exact: true }).fill('4');
  await save(page).click();
  await dialog.getByRole('radio', { name: /^새 버전 생성/ }).check();
  await expect(dialog).toContainText('새 버전은 신규 계획·학습·갱신에 즉시 사용');
  await dialog.getByRole('button', { name: '새 버전 생성', exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = backend.store.snapshot();
  expect(after.qualifications.find((q) => q.parentId === 'demo-qualification')!.version).toBe(2);
  expect(after.qualifications.find((q) => q.id === 'demo-qualification')).toEqual(
    before.qualifications.find((q) => q.id === 'demo-qualification'),
  );
  expect(after.assignments).toEqual(before.assignments);
});

test('빠른 방식 전환의 늦은 응답 무시·미리보기 실패와 저장 응답 유실 재시도', async ({
  page,
  backend,
}) => {
  await setup(page, backend.store);
  await page.getByLabel('재인증 시작 · 만료 전 개월', { exact: true }).fill('4');
  await save(page).click();
  const dialog = dialogFor(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route('**/api/qualifications/*/save-preview**', async (route) => {
    if (route.request().postDataJSON().versionMode === 'new') {
      const response = await route.fetch();
      entered();
      await gate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await dialog.getByRole('radio', { name: /^새 버전 생성/ }).check();
  await started;
  await dialog.getByRole('radio', { name: /^현재 버전에 저장/ }).check();
  await expect(dialog.getByRole('button', { name: '현재 버전에 저장', exact: true })).toBeEnabled();
  const response = page.waitForResponse(
    (r) => r.url().includes('/save-preview') && r.request().postDataJSON().versionMode === 'new',
  );
  release();
  await response;
  await expect(dialog.getByRole('radio', { name: /^현재 버전에 저장/ })).toBeChecked();
  await page.unroute('**/api/qualifications/*/save-preview**');
  await page.route('**/api/qualifications/*/save-preview**', (r) =>
    r.fulfill({ status: 503, json: { message: '검토 실패 시험' } }),
  );
  await dialog.getByRole('radio', { name: /^새 버전 생성/ }).check();
  await expect(dialog.getByRole('alert')).toContainText('검토 실패 시험');
  await expect(dialog.locator('.dialog-footer .primary')).toBeDisabled();
  await page.unroute('**/api/qualifications/*/save-preview**');
  await dialog.getByRole('button', { name: '다시 검토', exact: true }).click();
  const primary = dialog.getByRole('button', { name: '새 버전 생성', exact: true });
  await expect(primary).toBeEnabled();
  let first = true;
  const keys: string[] = [];
  await page.route('**/api/qualifications/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    keys.push(route.request().headers()['idempotency-key']!);
    if (first) {
      first = false;
      await route.fetch();
      await route.fulfill({ status: 503, json: { message: '저장 응답 유실 시험' } });
    } else await route.continue();
  });
  await primary.click();
  await expect(dialog.getByRole('alert')).toContainText('저장 응답 유실 시험');
  await expect(dialog.getByRole('radio', { name: /^새 버전 생성/ })).toBeChecked();
  await primary.click();
  await expect(dialog).toBeHidden();
  expect(new Set(keys).size).toBe(1);
  expect(
    backend.store.snapshot().qualifications.filter((q) => q.parentId === 'demo-qualification'),
  ).toHaveLength(1);
});

test('검토 중 닫기·계정 전환은 이전 응답으로 모달을 다시 열지 않는다', async ({
  page,
  backend,
}) => {
  await setup(page, backend.store);
  await page.getByLabel('재인증 시작 · 만료 전 개월', { exact: true }).fill('4');
  await save(page).click();
  const dialog = dialogFor(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route('**/api/qualifications/*/save-preview**', async (route) => {
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response });
  });
  await dialog.getByRole('radio', { name: /^새 버전 생성/ }).check();
  await started;
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const response = page.waitForResponse((r) => r.url().includes('/save-preview'));
  release();
  await response;
  await expect(dialog).toBeHidden();
  const switching = actor(page, 'learner-1');
  await answerConfirmation(page, true);
  await switching;
  await expect(dialog).toBeHidden();
  expect(
    backend.store.snapshot().qualifications.find((q) => q.id === 'demo-qualification')!.revision,
  ).toBe(1);
});
