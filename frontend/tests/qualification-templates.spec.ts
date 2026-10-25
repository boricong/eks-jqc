import { test, expect, actor } from './fixtures';
import { saveTemplate } from '../../server/src/qualification-templates';
import { saveCriterion } from './catalog-helpers';
import { randomUUID } from 'node:crypto';

test('공통 기본자격 생성 → 팀 등록·설정 → 팀 적용과 세부조직 필수 선택', async ({
  page,
  backend,
}, testInfo) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/qualification-templates');
  await page.getByRole('button', { name: '새 기본자격 만들기' }).click();
  await page.getByLabel('기본자격명', { exact: true }).fill('공통 설비 운전');
  await page.getByLabel('영문명', { exact: true }).fill('Shared Equipment');
  await page.getByLabel('공통 설명', { exact: true }).fill('작업 기준에 따라 독립 수행합니다.');
  await page.getByRole('button', { name: '기본자격 저장' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications');
  await expect(page.getByRole('button', { name: '새 자격 만들기', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Auditee 자격 등록', exact: true }).click();
  await page.getByRole('checkbox', { name: /공통 설비 운전/ }).check();
  await page.getByRole('button', { name: '팀 자격 등록', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: '공통 설비 운전', exact: true }).click();
  await expect(page.getByLabel('자격명', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '팀 설정', exact: true })).toBeVisible();
  await page.getByLabel('인증기간', { exact: true }).selectOption('unlimited');
  await page.getByRole('checkbox', { name: /자료 확인/ }).check();
  await saveCriterion(page);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/admin/qualifications');
  await page.reload();
  await page.getByRole('button', { name: '팀 적용', exact: true }).click();
  await page.getByLabel('공통 설비 운전 적용 버전').selectOption({ label: 'v2 · 적용 가능' });
  await expect(page.getByLabel('평가 흐름 체험 적용 버전')).toHaveValue('');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`team-apply-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByRole('button', { name: '팀 적용 확정' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: '공통 설비 운전' }).filter({ hasText: 'v2' }),
  ).toContainText('적용 중');
  await page.goto('/admin/policies');
  await page.getByRole('checkbox', { name: /공통 설비 운전/ }).check();
  await page.getByRole('button', { name: '조직 설정 변경 확인' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /저장|적용/ })
    .last()
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: '정하린', exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: '대상자에게 요청' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await expect(page.getByRole('region', { name: '내 소속 필수 자격' })).toHaveCount(0);
  await expect(
    page.getByRole('option', { name: '[필수] 공통 설비 운전 · v2', exact: true }),
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
  await page.goto('/admin/qualifications/demo-qualification');
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
  await expect(page.locator('.editor-errors')).toContainText('기본자격 정보가 변경');
  await expect(page.getByLabel('인증기간', { exact: true })).toHaveValue('three-years');
  await page.getByRole('button', { name: '공통 정보 다시 확인' }).click();
  await expect(
    page
      .locator('.editor-panel')
      .filter({ has: page.getByRole('heading', { name: '공통 정보', exact: true }) }),
  ).toContainText('최신 공통 이름');
  await saveCriterion(page, 'new');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(backend.store.snapshot().assignments).toEqual(before.assignments);
  const latest = backend.store
    .snapshot()
    .qualifications.find((q) => q.parentId === 'demo-qualification')!;
  expect(latest.validity.months).toBe(36);
  await page.goto('/admin/catalog');
  await page.getByTestId(`catalog-qualification-${latest.id}`).getByRole('button').click();
  await page.getByLabel('인증Set명', { exact: true }).fill('보존할 팀 학습 기준');
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (s) =>
      saveTemplate(s, 'operator-1', base.id, {
        revision: base.revision + 1,
        title: '최신 공통 이름 2',
        englishName: 'Current',
        description: '현재 공통 설명 2',
      }),
  );
  await page.getByRole('button', { name: '변경 검토 후 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '선택 기준 저장', exact: true })).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '기본정보 수정', exact: true }).click();
  await page.getByRole('button', { name: '최신 공통 정보 확인', exact: true }).click();
  await expect(page.locator('.catalog-qualification-fields')).toContainText('최신 공통 이름 2');
  await expect(page.getByLabel('인증Set명', { exact: true })).toHaveValue('보존할 팀 학습 기준');
  await page.getByRole('button', { name: '변경 검토 후 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '선택 기준 저장', exact: true })).toBeEnabled();
});
