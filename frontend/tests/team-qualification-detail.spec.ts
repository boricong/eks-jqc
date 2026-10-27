import { randomUUID } from 'node:crypto';
import { test, expect, actor } from './fixtures';
import { saveCriterion } from './catalog-helpers';
import { saveTemplate } from '../../server/src/qualification-templates';

test('주요 구역의 독립적인 키보드 접기·펼치기와 입력·선택·저장 보존', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification');
  const sections = page.locator('.team-qualification-detail .collapsible-section');
  await expect(sections).toHaveCount(4);
  await expect(sections.locator('[aria-expanded="true"]')).toHaveCount(4);
  await expect(page.locator('.criterion-versions')).not.toHaveAttribute('open');
  await page.getByLabel('인증기간', { exact: true }).selectOption('months');
  await page.getByLabel('유효 개월 수', { exact: true }).fill('24');
  await page.getByLabel('재인증 시작 · 만료 전 개월', { exact: true }).fill('2');
  const check = page.locator('[data-course-id="demo-course-1"]').getByRole('checkbox');
  await check.uncheck();
  const selected = await page.locator('.qualification-course-choice input:checked').count();
  await page.getByRole('button', { name: '팀 설정 접기', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('인증기간', { exact: true })).toBeHidden();
  await expect(page.getByRole('region', { name: '팀 설정', exact: true })).toContainText(
    '취득 후 24개월',
  );
  await expect(page.getByRole('button', { name: '공통 정보 접기', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByRole('button', { name: '필수 인증Set 접기', exact: true }).click();
  await expect(page.getByRole('region', { name: '필수 인증Set', exact: true })).toContainText(
    `${selected}개 선택`,
  );
  await page.getByRole('button', { name: '팀 설정 펼치기', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('유효 개월 수', { exact: true })).toHaveValue('24');
  await expect(page.getByLabel('재인증 시작 · 만료 전 개월', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: '필수 인증Set 펼치기', exact: true }).click();
  await expect(check).not.toBeChecked();
  await check.check();
  await page.getByRole('button', { name: '공통 정보 접기', exact: true }).click();
  await saveCriterion(page, 'new');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page).not.toHaveURL(/demo-qualification$/);
  await expect(sections.locator('[aria-expanded="true"]')).toHaveCount(4);
  const saved = backend.store
    .snapshot()
    .qualifications.find((q) => q.parentId === 'demo-qualification')!;
  expect(saved.validity.months).toBe(24);
  expect(saved.renewalLeadMonths).toBe(2);
});

test('정확한 버전 구성만 조회하고 체크·검색·입력·초점을 보존한다', async ({ page, backend }) => {
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      const source = structuredClone(s.courses[0]!);
      for (const version of [1, 2])
        s.courses.push({
          ...structuredClone(source),
          id: `preview-v${version}`,
          entityId: 'preview-series',
          parentId: version === 2 ? 'preview-v1' : undefined,
          version,
          title: '버전별 조회 기준',
          operationalStatus: version === 1 ? 'retired' : 'active',
          ...(version === 1
            ? {
                retiredAt: '2026-10-23T00:00:00.000Z',
                retiredBy: 'admin-1',
                retirementReason: '이전 구성 보존',
              }
            : {}),
          assessmentKinds: ['objective'],
          passScore: version === 1 ? 70 : null,
          materials: [
            {
              id: 'preview-material',
              type: 'text',
              title: '버전별 자료',
              content: `v${version} 자료 원문`,
              description: '조회용 자료',
              url: '',
            },
          ],
          learningItems: [
            {
              id: 'preview-learning',
              title: `v${version} 학습 범위`,
              type: 'ojt',
              required: version === 1,
            },
          ],
          questions: Array.from({ length: version }, (_, index) => ({
            id: `secret-${index}`,
            prompt: '노출 금지 문항 원문',
            choices: ['노출 금지 정답', '노출 금지 오답'],
            correct: 0,
            points: 1,
          })),
        });
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification');
  await page.getByLabel('인증기간', { exact: true }).selectOption('three-years');
  await page.getByLabel('필수 인증Set 검색').fill('버전별 조회 기준');
  const before = backend.store.snapshot();
  const checked = await page
    .locator('.qualification-course-choice input:checked')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  const dialog = page.getByRole('dialog', { name: '인증Set 내용 조회' });
  for (const version of [1, 2]) {
    const row = page.locator(`[data-course-id="preview-v${version}"]`),
      button = row.getByRole('button', { name: /내용 조회/ });
    await expect(row.getByRole('checkbox')).not.toBeChecked();
    await button.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('region', { name: '기본정보' })).toBeInViewport();
    await expect(dialog).toContainText(`v${version} 학습 범위`);
    await dialog.getByRole('tab', { name: /^자료 1/ }).click();
    await expect(dialog).toContainText(`v${version} 자료 원문`);
    await expect(dialog.getByRole('region', { name: '평가 요약' })).toContainText(`${version}문항`);
    await expect(dialog).toContainText(version === 1 ? '합격 기준 70% 이상' : '합격 기준 미정');
    if (version === 1) await expect(dialog).toContainText('운영 종료');
    expect(await dialog.textContent()).not.toContain('노출 금지');
    await expect(dialog.locator('input, textarea, select')).toHaveCount(0);
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    if (version === 1) await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: '닫기', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(button).toBeFocused();
    await expect(row.getByRole('checkbox')).not.toBeChecked();
  }
  await expect(page.getByLabel('필수 인증Set 검색')).toHaveValue('버전별 조회 기준');
  await expect(page.getByLabel('인증기간', { exact: true })).toHaveValue('three-years');
  expect(
    await page
      .locator('.qualification-course-choice input:checked')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
  ).toEqual(checked);
  expect(backend.store.snapshot()).toEqual(before);
});

test('빈 구성·삭제 자격의 읽기 전용 조회와 버전 이동 시 초기화', async ({ page, backend }) => {
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      s.qualifications.push({
        ...structuredClone(q),
        id: 'preview-qualification-v2',
        parentId: q.id,
        version: 2,
        deletedAt: '2026-10-23T00:00:00.000Z',
        deletedBy: 'admin-1',
        deletionReason: '이전 버전 보존',
      });
      s.courses.push({
        ...structuredClone(s.courses[0]!),
        id: 'empty-preview',
        entityId: 'empty-preview',
        version: 1,
        title: '빈 인증Set',
        materials: [],
        learningItems: [],
        assessmentKinds: [],
        questions: [],
        practicalQuestions: [],
        passScore: null,
      });
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification');
  await page.getByRole('button', { name: '팀 설정 접기', exact: true }).click();
  await page.locator('.criterion-versions > summary').click();
  await page.locator('.criterion-versions a[href*="preview-qualification-v2"]').click();
  await expect(page.getByLabel('인증기간', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '팀 설정 접기', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByRole('button', { name: '저장', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '빈 인증Set v1 내용 조회' }).click();
  const dialog = page.getByRole('dialog', { name: '인증Set 내용 조회' });
  await expect(dialog).toContainText('등록된 학습 정보가 없습니다.');
  await expect(dialog.getByRole('region', { name: '평가 요약' })).toContainText(
    '설정된 평가가 없습니다.',
  );
  await page.goBack();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('인증기간', { exact: true })).toBeEnabled();
  await expect(page.locator('.team-qualification-detail [aria-expanded="true"]')).toHaveCount(4);
  await page.getByRole('button', { name: '공통 정보 접기', exact: true }).click();
  await actor(page, 'operator-1');
  await page.goto('/admin/qualifications/demo-qualification?lv1OrganizationId=org-photo');
  await expect(page.locator('.team-qualification-detail [aria-expanded="true"]')).toHaveCount(4);
});

test('긴 정보·네 화면 폭의 구역 정렬·글꼴·모달 본문 스크롤', async ({ page, backend }, info) => {
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      const template = s.qualificationTemplates.find((t) => t.id === q.templateId)!;
      saveTemplate(s, 'operator-1', template.id, {
        revision: template.revision,
        title: '팀 자격 상세 화면 정렬 확인',
        englishName: 'SharedQualification'.repeat(10),
        description: '공통 기준과 팀별 운영 범위를 확인합니다.\n'.repeat(5),
      });
      q.validity = { type: 'months', months: 36, reminderDays: [] };
      const course = s.courses.find((c) => c.id === 'demo-course-1')!;
      course.title = '긴 인증Set 이름과 학습 범위 '.repeat(8);
      course.materials = [
        {
          id: 'long-text',
          type: 'text',
          title: '작업 기준 자료',
          content: '긴 학습자료 본문을 끝까지 확인합니다.\n'.repeat(60),
          description: '작업 전 확인할 절차',
          url: '',
        },
        {
          id: 'external',
          type: 'url',
          title: '외부 작업 기준',
          content: '',
          description: '',
          url: 'https://example.com/material',
        },
      ];
      course.learningItems = [
        { id: 'long-learning', type: 'team', title: '긴 학습 항목 '.repeat(25), required: true },
      ];
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole('heading', { name: '팀 자격 상세 화면 정렬 확인', exact: true }),
    ).toHaveCSS('font-size', '24px');
    await expect(page.locator('.collapsible-section-title').first()).toHaveCSS('font-size', '18px');
    await expect(page.locator('.team-qualification-facts dt').first()).toHaveCSS(
      'font-size',
      '13px',
    );
    await expect(page.getByLabel('인증기간', { exact: true })).toHaveCSS(
      'font-size',
      width <= 768 ? '16px' : '14px',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const controls = page.locator(
      '.qualification-settings-grid select, .qualification-settings-grid input',
    );
    const boxes = await controls.evaluateAll((els) =>
      els.map((el) => ({
        x: el.getBoundingClientRect().x,
        width: el.getBoundingClientRect().width,
      })),
    );
    if (width <= 768) expect(new Set(boxes.map((box) => box.x)).size).toBe(1);
    else expect(new Set(boxes.map((box) => box.x)).size).toBe(2);
    await page.screenshot({
      path: info.outputPath(`team-qualification-${width}.png`),
      fullPage: true,
    });
    await page
      .locator('[data-course-id="demo-course-1"]')
      .getByRole('button', { name: /내용 조회/ })
      .click();
    const dialog = page.getByRole('dialog', { name: '인증Set 내용 조회' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('region', { name: '기본정보' })).toBeInViewport();
    await dialog.getByRole('tab', { name: /^자료 1/ }).click();
    const geometry = await dialog.evaluate((el) => {
      const rect = el.getBoundingClientRect(),
        body = el.querySelector('.dialog-body')!;
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        overflowing: body.scrollHeight > body.clientHeight,
        horizontal: body.scrollWidth > body.clientWidth + 1,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.width).toBeLessThanOrEqual(960);
    expect(geometry.bottom).toBeLessThanOrEqual(900);
    expect(geometry.overflowing).toBe(true);
    expect(geometry.horizontal).toBe(false);
    await expect(dialog.getByRole('button', { name: '닫기', exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`course-preview-${width}.png`) });
    await dialog.getByRole('region', { name: '평가 요약' }).scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole('heading', { name: '인증Set 내용 조회', exact: true }),
    ).toBeInViewport();
    await expect(dialog.getByRole('button', { name: '닫기', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: '확인', exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`course-preview-summary-${width}.png`) });
    if (width <= 768) {
      const sizes = await dialog
        .locator('button')
        .evaluateAll((els) =>
          els
            .filter((el) => el.getBoundingClientRect().height > 0)
            .map((el) => el.getBoundingClientRect().height),
        );
      expect(sizes.every((height) => height >= 44)).toBe(true);
    }
    await page.keyboard.press('Escape');
  }
});
