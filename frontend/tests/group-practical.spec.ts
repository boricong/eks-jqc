import { test, expect, actor, answerConfirmation } from './fixtures';
test.use({ groupTrial: true });

test('그룹 생성·3회 근거 입력·공동 판정·개인 조회·무효화', async ({ page, backend }, info) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/group-assessments');
  await page.getByLabel('그룹명', { exact: true }).fill('현장 실기 A');
  await page.getByLabel('인증Set 버전').selectOption('demo-course-1');
  await page.getByLabel('평가자', { exact: true }).selectOption('admin-1');
  for (const checkbox of await page.locator('.member-options input').all()) await checkbox.check();
  await page.getByRole('button', { name: '그룹 만들기' }).click();
  await expect(page.getByRole('heading', { name: '현장 실기 A', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '실기 시작', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(page.locator('.trial-card')).toHaveCount(9);
  let lostUpload = false;
  await page.route(/\/api\/group-assessments\/.*\/runs\/.*\/files\?/, async (route) => {
    if (!lostUpload) {
      lostUpload = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByLabel('원자료 등록 (CSV, XLSX)').setInputFiles({
    name: 'measure.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('person,trial,value\na,1,20\n'),
  });
  await expect(page.getByRole('button', { name: '파일 등록 다시 시도' })).toBeVisible();
  expect(backend.store.snapshot().groupAssessmentFiles).toHaveLength(1);
  await page.getByRole('button', { name: '파일 등록 다시 시도' }).click();
  await expect(page.getByRole('button', { name: 'measure.csv', exact: true })).toBeVisible();
  expect(backend.store.snapshot().groupAssessmentFiles).toHaveLength(1);
  await page.getByLabel('분석 보고서 등록 (PDF)').setInputFiles({
    name: 'analysis.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nreport'),
  });
  await expect(page.getByRole('button', { name: 'analysis.pdf', exact: true })).toBeVisible();
  const cards = page.locator('.trial-card');
  // Saving one row preserves another row's draft.
  await cards.nth(1).getByLabel('기록 메모').fill('다음 수행 메모');
  for (let i = 0; i < 9; i++) {
    const card = cards.nth(i);
    await card.getByLabel('수행일').fill('2026-11-10');
    await card.getByLabel('원자료', { exact: true }).selectOption({ label: 'measure.csv' });
    await card.getByLabel('자료 내 위치').fill(`행 ${i + 2}`);
    await card.getByLabel('수행 완료').check();
    await card.getByRole('button', { name: '수행 기록 저장' }).click();
    await expect
      .poll(
        () =>
          backend.store.snapshot().groupAssessments[0]!.runs[0]!.trials.filter((t) => t.completed)
            .length,
      )
      .toBe(i + 1);
    if (i === 0) await expect(cards.nth(1).getByLabel('기록 메모')).toHaveValue('다음 수행 메모');
  }
  await page.getByLabel('변동률 (%)').fill('4.2');
  await page.getByLabel('analysis.pdf', { exact: true }).check();
  await page.getByLabel('판정 사유', { exact: true }).fill('결과가 공동 판정 기준에 부합');
  await page.getByLabel('전원의 실기 3회 원자료와 분석 보고서를 대조했습니다.').check();
  await page.getByRole('button', { name: '분석 결과 저장' }).click();
  await expect(page.getByRole('button', { name: '판정 검토', exact: true })).toBeEnabled();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.screenshot({ path: info.outputPath(`group-${width}.png`), fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.getByRole('button', { name: '판정 검토', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '공동 판정 최종 검토' });
  await expect(dialog.getByText(/시험 자격 발급 예정/)).toHaveCount(3);
  await dialog.getByRole('button', { name: '취소', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '판정 검토', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '판정 검토', exact: true }).click();
  await dialog.getByRole('button', { name: '공동 판정 확정' }).click();
  await expect(page.getByRole('heading', { name: '확정 판정 · Pass' })).toBeVisible();
  expect(backend.store.snapshot().certifications).toHaveLength(3);
  const id = backend.store.snapshot().groupAssessments[0]!.id;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto(`/group-assessments/${id}`);
  await expect(page.locator('.trial-card')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '근거 파일', exact: true })).toHaveCount(0);
  await page.goto('/certifications/group-assignment-0');
  await expect(page.getByText('시험 발급 · 그룹 실기 시험운영 인증서')).toBeVisible();
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto(`/admin/group-assessments/${id}`);
  await page.getByRole('button', { name: '판정 무효화 검토' }).click();
  const invalid = page.getByRole('dialog', { name: '판정 무효화 검토' });
  await invalid.getByLabel('사유', { exact: true }).fill('시료 식별 오기재');
  await invalid.getByRole('button', { name: '영향 확인' }).click();
  await expect(invalid.getByText(/인증 3건 말소/)).toBeVisible();
  await invalid.getByRole('button', { name: '무효화 확정' }).click();
  await expect(page.getByText('무효화 사유: 시료 식별 오기재')).toBeVisible();
  expect(backend.store.snapshot().certifications.every((c) => c.lifecycleStatus === 'Revoke')).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('그룹 지정의 미저장 이탈 취소', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/group-assessments');
  await page.getByLabel('그룹명', { exact: true }).fill('보존할 그룹');
  await page.getByRole('link', { name: '인증 현황', exact: true }).first().click();
  await answerConfirmation(page, false);
  await expect(page.getByLabel('그룹명', { exact: true })).toHaveValue('보존할 그룹');
  await page.getByRole('button', { name: '다시 불러오기' }).click();
  await answerConfirmation(page, true);
});

test('그룹 실기 기준을 편집하고 새 버전에 저장한다', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-2');
  await page.getByLabel('그룹 실기 전용 · 시험운영').check();
  await page.getByRole('tab', { name: '그룹 실기 기준' }).click();
  await page.getByLabel('수행 지침', { exact: true }).fill('같은 실기를 각자 3회 수행');
  await page.getByLabel('분석 방법', { exact: true }).fill('외부 분석');
  await page.getByLabel('공동 판정 기준', { exact: true }).fill('보고서와 원자료 대조');
  await page.getByRole('button', { name: '결과 항목 추가' }).click();
  await page.getByLabel('항목명', { exact: true }).fill('결과 지표');
  await page.getByLabel('단위', { exact: true }).fill('%');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '기준 저장 확인' });
  await expect(dialog).toContainText('v1.0 → v2.0');
  await dialog.getByRole('button', { name: '저장 확인', exact: true }).click();
  await expect
    .poll(
      () => backend.store.snapshot().courses.filter((c) => c.entityId === 'demo-course-2').length,
    )
    .toBe(2);
  const courses = backend.store.snapshot().courses.filter((c) => c.entityId === 'demo-course-2');
  expect(courses.find((c) => c.version === 1)!.groupPractical).toBeUndefined();
  expect(
    courses.find((c) => c.releaseVersion?.major === 2)!.groupPractical?.metrics[0]!.label,
  ).toBe('결과 지표');
});
