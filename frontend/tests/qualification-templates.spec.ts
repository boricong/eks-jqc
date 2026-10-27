import { requestPlan } from './workflow-helpers';
import { test, expect, actor, answerConfirmation } from './fixtures';
import { saveTemplate } from '../../server/src/qualification-templates';
import { saveCriterion } from './catalog-helpers';
import { randomUUID } from 'node:crypto';

test('공통 기본자격 생성 → 팀 등록·설정 → 자동 기준 사용과 자격 선택 계획', async ({
  page,
  backend,
}, testInfo) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/qualification-templates');
  await page.getByRole('button', { name: '새 기본자격 만들기' }).click();
  await page.getByLabel('기본자격명', { exact: true }).fill('공통 설비 운전');
  await page.getByLabel('영문명', { exact: true }).fill('Shared Equipment');
  await page.getByLabel('공통 설명 (선택)', { exact: true }).fill('');
  await page.getByRole('button', { name: '기본자격 저장' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications');
  await expect(page.getByRole('button', { name: '새 자격 만들기', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Auditee 자격 등록', exact: true }).click();
  await page.getByRole('checkbox', { name: /공통 설비 운전/ }).check();
  await page.getByRole('button', { name: '팀 자격 등록', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const readyRow = page.getByRole('row').filter({ hasText: '공통 설비 운전' });
  await expect(readyRow).toContainText('Ready · 대기');
  await expect(readyRow.getByRole('cell', { name: '—', exact: true })).toBeVisible();
  await page.getByLabel('상태 필터', { exact: true }).selectOption('Ready');
  await expect(readyRow).toBeVisible();
  await page.getByRole('link', { name: '공통 설비 운전', exact: true }).click();
  await expect(
    page.getByText('Ready · 대기 — 최초 기준을 저장하면 v1부터 시작합니다.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '운영 상태 변경', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '저장', exact: true })).toBeDisabled();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`ready-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  await expect(page.getByLabel('자격명', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '팀 설정', exact: true })).toBeVisible();
  await page.getByLabel('인증기간', { exact: true }).selectOption('unlimited');
  await page.getByRole('checkbox', { name: /자료 확인/ }).check();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('radio')).toHaveCount(0);
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'v1.0으로 최초 설정 저장', exact: true }),
  ).toBeVisible();
  await saveCriterion(page);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/admin/qualifications');
  await page.getByLabel('상태 필터', { exact: true }).selectOption('all');
  await page.reload();
  await expect(page.getByRole('button', { name: '팀 적용', exact: true })).toHaveCount(0);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`team-apply-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: '공통 설비 운전' }).filter({ hasText: 'v1' }),
  ).toContainText('현재 기준');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await expect(page.getByRole('region', { name: '내 소속 필수 자격' })).toHaveCount(0);
  await expect(
    page.getByRole('option', { name: '공통 설비 운전 · v1.0', exact: true }),
  ).toHaveCount(1);
});

test('기본자격 긴 정보·4해상도·미저장 취소와 키보드 초점', async ({ page, backend }, testInfo) => {
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      saveTemplate(s, 'operator-1', undefined, {
        title: '긴 기본자격 이름 '.repeat(12),
        englishName: 'Shared '.repeat(12),
        description: '공통 설명\n'.repeat(30),
      });
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/qualification-templates');
  await page.getByLabel('기본자격 검색').fill('긴 기본자격');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.getByRole('heading', { name: '기본자격 관리', exact: true })).toHaveCSS(
      'font-size',
      '24px',
    );
    const name = page.getByRole('button', { name: /긴 기본자격 이름/ });
    const buttonBox = (await name.boundingBox())!,
      cellBox = (await name.locator('..').boundingBox())!;
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(cellBox.x + cellBox.width);
    expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`base-templates-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: '새 기본자격 만들기' }).click();
  await page.getByLabel('기본자격명', { exact: true }).fill('취소할 입력');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('app-confirmation')).toBeVisible();
  await page
    .getByTestId('app-confirmation')
    .getByRole('button', { name: '취소', exact: true })
    .click();
  await expect(page.getByLabel('기본자격명', { exact: true })).toHaveValue('취소할 입력');
  await page
    .getByRole('dialog', { name: '기본자격 편집' })
    .getByRole('button', { name: '취소', exact: true })
    .click();
  await page
    .getByTestId('app-confirmation')
    .getByRole('button', { name: '변경 버리고 이동' })
    .click();
  await expect(page.getByRole('button', { name: '새 기본자격 만들기' })).toBeFocused();
});

test('저장 검토 중 공통 정보 변경은 팀 입력을 보존하며 과거 배정의 이름을 바꾸지 않는다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification/edit');
  await page.getByLabel('인증기간', { exact: true }).selectOption('three-years');
  const before = backend.store.snapshot(),
    base = before.qualificationTemplates.find(
      (t) => t.id === before.qualifications.find((q) => q.id === 'demo-qualification')!.templateId,
    )!;
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (s) =>
      saveTemplate(s, 'operator-1', base.id, {
        revision: base.revision,
        title: '최신 공통 이름',
        englishName: 'Current',
        description: '현재 공통 설명',
      }),
  );
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('.editor-errors')).toContainText('과거 버전은 조회만 가능합니다.');
  await expect(page.getByLabel('인증기간', { exact: true })).toHaveValue('three-years');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('인증기간', { exact: true })).toBeDisabled();
  await page.getByRole('link', { name: '최신 기준 조회', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(page.locator('.team-qualification-view')).toContainText('최신 공통 이름');
  await page.getByRole('link', { name: '변경', exact: true }).click();
  await page.getByLabel('인증기간', { exact: true }).selectOption('three-years');
  await saveCriterion(page, 'new');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(backend.store.snapshot().assignments).toEqual(before.assignments);
  const latest = backend.store
    .snapshot()
    .qualifications.filter((q) => q.entityId === 'demo-qualification')
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]!;
  expect(latest.validity.months).toBe(36);

  await expect(page.getByRole('link', { name: '기준 일괄 편집', exact: true })).toHaveCount(0);
});
