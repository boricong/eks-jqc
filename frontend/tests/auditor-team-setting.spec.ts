import { test, expect, actor } from './fixtures';
import { carouselContrast } from './carousel-visual-helpers';

test('대상 팀 설정 영역·선택/확인 모달의 네 폭·긴 조직명·취소와 초점 복귀', async ({
  page,
  backend,
}, info) => {
  await backend.store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    'long team name fixture',
    () => {},
    (doc) => {
      doc.roots[0]!.name =
        'Foundry Photo 기술팀 · 설비 공정 기술 및 인증 운영 기준을 관리하는 조직 '.repeat(3).trim();
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/organizations');
  const section = page.getByRole('region', { name: 'Auditor 대상 팀 설정' }),
    trigger = section.getByRole('button', { name: 'Auditor 대상 팀 변경' });
  await expect(section).toContainText('미사용');
  const revision = backend.store.organizations.snapshot().revision;
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Auditor 대상 팀 설정' });
    await expect(dialog.getByRole('radio', { name: '미사용', exact: true })).toBeFocused();
    await expect(dialog.getByRole('button', { name: '변경', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '변경 검토', exact: true })).toHaveCount(0);
    await dialog.getByRole('radio', { name: '사용', exact: true }).check();
    await page.screenshot({ path: info.outputPath(`team-selection-${width}.png`), fullPage: true });
    await dialog.getByRole('button', { name: '변경', exact: true }).click();
    const confirmation = dialog.getByRole('button', { name: '변경 확정', exact: true });
    await expect(confirmation).toBeFocused();
    await expect(dialog.getByRole('region', { name: '대상 팀 변경 내용' })).toContainText(
      '현재 미사용',
    );
    await expect(dialog).toContainText('변경 후 사용');
    await expect(dialog.locator('dd').first()).toHaveText('6명');
    await expect(dialog.getByRole('radio', { name: '사용', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`team-confirmation-${width}.png`),
      fullPage: true,
    });
    if (width === 390) {
      await page.setViewportSize({ width, height: 600 });
      await confirmation.focus();
      await expect(confirmation).toBeInViewport();
      const box = await dialog.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(600);
      await page.screenshot({
        path: info.outputPath('team-confirmation-390-short.png'),
        fullPage: true,
      });
    }
    await dialog.getByRole('button', { name: '다시 선택', exact: true }).click();
    await expect(dialog.getByRole('radio', { name: '사용', exact: true })).toBeFocused();
    await dialog.getByRole('radio', { name: '미사용', exact: true }).check();
    await expect(dialog.getByRole('button', { name: '변경', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(backend.store.organizations.snapshot().revision).toBe(revision);
  }
  await trigger.click();
  await carouselContrast(page, '.auditor-team-dialog');
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  await expect(section).toContainText('미사용');
});

test('조직 정보 수정 중 대상 팀 변경을 보류하고 하위 조직에서는 별도 설정을 표시하지 않는다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/organizations');
  const section = page.getByRole('region', { name: 'Auditor 대상 팀 설정' });
  await page.getByLabel('조직명', { exact: true }).fill('저장하지 않은 조직명');
  await expect(section.getByRole('button', { name: 'Auditor 대상 팀 변경' })).toBeDisabled();
  await expect(section).toContainText('먼저 저장하거나 취소');
  await page
    .locator('.organization-detail form')
    .getByRole('button', { name: '취소', exact: true })
    .click();
  await expect(section.getByRole('button', { name: 'Auditor 대상 팀 변경' })).toBeEnabled();
  const root = backend.store.organizations.snapshot().roots[0]!,
    child = root.children[0]!;
  await page.getByRole('button', { name: `${root.name} 펼치기`, exact: true }).click();
  await page.locator('.tree-node').filter({ hasText: child.name }).first().click();
  await expect(section).toHaveCount(0);
});

test('처리 중 닫기를 막고 저장 실패·응답 유실 재시도는 한 번만 변경한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/organizations');
  const trigger = page.getByRole('button', { name: 'Auditor 대상 팀 변경' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Auditor 대상 팀 설정' });
  await dialog.getByRole('radio', { name: '사용', exact: true }).check();
  let resume!: () => void;
  const held = new Promise<void>((resolve) => (resume = resolve));
  await page.route('**/api/system/organizations/*/auditor-eligibility/preview', async (route) => {
    await held;
    await route.continue();
  });
  try {
    await dialog.getByRole('button', { name: '변경', exact: true }).click();
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await expect(dialog.getByRole('button', { name: '닫기', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '취소', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
  } finally {
    resume();
  }
  const confirm = dialog.getByRole('button', { name: '변경 확정', exact: true });
  await expect(confirm).toBeFocused();
  backend.store.beforeReplace = () => {
    throw Error('temporary save failure');
  };
  await confirm.click();
  await expect(dialog.getByRole('alert')).toBeFocused();
  expect(backend.store.organizations.snapshot().roots[0]!.auditorEnabled).toBe(false);
  backend.store.beforeReplace = undefined;
  let lost = true;
  const keys: string[] = [];
  await page.route('**/api/system/organizations/*/auditor-eligibility', async (route) => {
    keys.push(route.request().headers()['idempotency-key']!);
    if (lost) {
      lost = false;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const org = backend.store.organizations.snapshot();
  expect(org.roots[0]!.auditorEnabled).toBe(true);
  expect(org.audits.filter((a) => a.action === 'auditor.team.change')).toHaveLength(1);
});
