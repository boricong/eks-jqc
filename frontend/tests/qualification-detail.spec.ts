import { showLearningMaterials } from './learning-helpers';
import { test, expect, actor } from './fixtures';
import { requestPlan, completePlan } from './workflow-helpers';

test('학습 히어로·설명 펼치기·단일 자료·인증Set별 선택 기억·열람은 기록을 변경하지 않는다', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'detail-materials',
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      q.description = (
        '자격의 목적은 기준을 확인하고 변경에 대응하는 능력을 평가하는 것입니다.\n\n' +
        '반도체 설비의 구성과 기록을 비교하여 적절한 판단을 설명합니다.\n'
      ).repeat(12);
      q.englishName = 'Equipment Process Test';
      // Existing confirmed assignment fixture keeps its own display metadata.
      Object.assign(
        s.qualificationTemplates.find((t) => t.id === q.templateId)!,
        { description: q.description, englishName: q.englishName },
      );
      s.assignments
        .filter((a) => a.qualificationId === q.id)
        .forEach((a) =>
          Object.assign(a.qualificationMetadata!, {
            description: q.description,
            englishName: q.englishName,
          }),
        );
      q.validity = { type: 'months', months: 36, reminderDays: [90, 30, 7] };
      s.courses.find((c) => c.id === 'demo-course-1')!.materials = [
        {
          id: 'external-first',
          type: 'url',
          title: '기준 문서',
          description: '변경 전 기준을 확인합니다.',
          content: '',
          url: 'https://example.com/reference',
        },
        {
          id: 'read-one',
          type: 'text',
          title: '첫 번째 학습자료',
          description: '학습 범위와 판단 근거',
          content: '첫 문단입니다.\n\n둘째 문단에서 결과를 확인합니다.',
          url: '',
        },
        {
          id: 'read-two',
          type: 'text',
          title: '두 번째 학습자료',
          description: '',
          content: '비교를 위해 함께 펼치는 자료입니다.',
          url: '',
        },
        {
          id: 'edm',
          type: 'edm',
          title: 'EDM 기준',
          description: '사내 문서 접근 권한이 필요합니다.',
          content: '',
          url: 'https://example.com/edm',
        },
        {
          id: 'confluence',
          type: 'confluence',
          title: 'Confluence 지침',
          description: '',
          content: '',
          url: 'https://example.com/wiki',
        },
      ];
      s.courses.find((c) => c.id === 'demo-course-2')!.materials = [];
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  await page.getByRole('link', { name: '상세정보 보기', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '평가 흐름 체험', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page).toHaveTitle('자격 학습 · EKS 직무자격인증');
  await expect(page.getByRole('navigation', { name: '현재 위치' })).toHaveCount(0);
  const summary = page.getByRole('region', { name: '자격 요약', exact: true });
  const info = summary.getByRole('region', { name: '자격 상세 정보', includeHidden: true });
  await expect(info).toBeHidden();
  await summary.getByRole('button', { name: '자격 정보', exact: true }).click();
  await expect(info).toBeVisible();
  await expect(info).toContainText('Equipment Process Test');
  await expect(info).toContainText('취득 후 3년');
  await expect(info.locator('.prose-text')).toHaveText(
    before.assignments.find((a) => a.id === 'assignment-1')!.qualificationMetadata!.description,
  );
  await expect(info.locator('.prose-text')).toHaveCSS('white-space', 'pre-wrap');
  await summary.getByRole('button', { name: '자격 정보', exact: true }).click();
  await expect(info).toBeHidden();
  await showLearningMaterials(page);
  const materials = page.getByRole('region', { name: '학습자료', exact: true });
  const tabs = materials.getByRole('tablist', { name: '학습자료 선택' });
  const first = tabs.getByRole('tab', { name: /첫 번째 학습자료/ });
  const second = tabs.getByRole('tab', { name: /두 번째 학습자료/ });
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(materials.locator('.material-content')).toHaveCount(1);
  await expect(materials.locator('.material-content')).toHaveCSS('white-space', 'pre-wrap');
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(materials.locator('.material-content')).toHaveText(
    '비교를 위해 함께 펼치는 자료입니다.',
  );
  await page
    .getByRole('navigation', { name: '인증Set', exact: true })
    .getByRole('button')
    .nth(1)
    .click();
  await showLearningMaterials(page);
  await expect(materials).toContainText('등록된 학습자료가 없습니다.');
  await expect(page.getByRole('link', { name: '평가 시작', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: '인증Set', exact: true })
    .getByRole('button')
    .first()
    .click();
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: /EDM 기준/ }).click();
  const external = materials.getByRole('link', { name: 'EDM 기준 자료 열기 · 새 창' });
  await expect(external).toHaveAttribute('target', '_blank');
  await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(materials.locator('.material-content')).toHaveCount(0);
  await page.getByRole('link', { name: '평가 시작', exact: true }).click();
  await expect(page.getByRole('heading', { name: '평가 유형 선택', exact: true })).toBeVisible();
  await expect(summary).toHaveCount(0);
  await expect(materials).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '자격 취득 메뉴' })
    .getByRole('link', { name: '학습', exact: true })
    .click();
  await expect(tabs.getByRole('tab', { name: /EDM 기준/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(backend.store.snapshot()).toEqual(before);
});

test('개인 목표·일정과 전체 진행 분리 → 자료 → 응시 복귀·통과 유지 → 수료증·인증서', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'detail-validity',
    () => {},
    (s) => {
      s.qualifications.find((q) => q.id === 'demo-qualification')!.validity = {
        type: 'months',
        months: 1,
        reminderDays: [7],
      };
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications');
  await requestPlan(page, '정하린');
  await actor(page, 'learner-2');
  await completePlan(page, '평가 흐름 체험', false);
  const a = backend.store.snapshot().assignments.find((a) => a.learnerId === 'learner-2')!;
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'distinct-plan-goals',
    () => {},
    (s) => {
      const p = s.plans.find((p) => p.id === a.planId)!;
      p.goal = '기준의 이름과 버전을 독립적으로 확인한다.';
      return {};
    },
  );
  await page.reload();
  const summary = page.getByRole('region', { name: '자격 요약', exact: true });
  const goals = page.getByRole('region', { name: '내 학습 일정', exact: true });
  await expect(summary).toContainText('2027-02-01');
  await expect(goals).toContainText('2026-10-01');
  await expect(page.locator('.qualification-learning')).not.toContainText(
    '기준의 이름과 버전을 독립적으로 확인한다.',
  );
  await page.getByRole('navigation', { name: '인증Set' }).getByRole('button').nth(1).click();
  await expect(goals).toContainText('2027-02-01');
  await expect(page.locator('.learning-course-hero')).not.toContainText(
    '수행 기록의 누락 여부를 판단한다.',
  );
  await expect(goals).not.toContainText('평가 예정일');
  await page.getByRole('link', { name: '평가 시작', exact: true }).click();
  await page.getByRole('link', { name: '응시하기', exact: true }).first().click();
  await page.getByRole('radio').first().check();
  await expect(page.locator('.save-status')).toHaveText('저장됨');
  const draft = backend.store.snapshot().attempts.find((t) => t.learnerId === 'learner-2')!;
  await page.getByRole('link', { name: '평가 선택으로', exact: true }).click();
  await expect(page.locator('.qualification-course-heading')).toContainText('기록 작성');
  await page.goto(`/qualifications/${a.id}`);
  await expect(page.locator('.qualification-course-heading')).toContainText('기록 작성');
  await page.getByRole('link', { name: '평가 시작', exact: true }).click();
  await page.getByRole('link', { name: '답안 이어 쓰기', exact: true }).click();
  await expect(page.getByRole('radio').first()).toBeChecked();
  expect(backend.store.snapshot().attempts.find((t) => t.id === draft.id)?.answers).toEqual(
    draft.answers,
  );
  for (const enrollment of backend.store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === a.id)) {
    const c = backend.store.snapshot().courses.find((c) => c.id === enrollment.courseId)!;
    for (const kind of c.assessmentKinds) {
      await page.goto(`/qualifications/${a.id}/courses/${c.id}/${kind}`);
      const questions = kind === 'objective' ? c.questions : c.practicalQuestions;
      for (const [i, question] of questions.entries()) {
        await page.getByRole('tablist', { name: '응시 문항' }).getByRole('tab').nth(i).click();
        await page.getByRole('radio').nth(question.correct!).check();
      }
      await page.getByRole('button', { name: /^답안 확인(?:으로 돌아가기)?$/ }).click();
      await page.getByRole('button', { name: '최종 제출', exact: true }).click();
      await expect(page.locator('.result-panel')).toContainText('평가 통과');
    }
  }
  await page.goto(`/qualifications/${a.id}?course=demo-course-2`);
  await expect(summary).toContainText('인증 취득');
  await expect(summary).toContainText('유효');
  await page.getByRole('link', { name: '평가 시작', exact: true }).click();
  await expect(page.getByRole('link', { name: '인증Set 수료증 보기', exact: true })).toBeVisible();
  await page.locator('.qualification-history > summary').click();
  await expect(page.locator('.qualification-history')).toContainText('자동 채점');
  await page.getByRole('link', { name: '인증Set 수료증 보기', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '검증용 인증Set 수료증', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.award-document')).toContainText('정하린');
  await page.goto(`/qualifications/${a.id}`);
  await page.getByRole('link', { name: '인증서 보기', exact: true }).click();
  await expect(page.locator('.certificate-recipient')).toHaveText('정하린');
  await page.clock.install({ time: Date.now() + 100 * 86400000 });
  await page.goto(`/qualifications/${a.id}`);
  await expect(summary.locator('.validity-badge')).toHaveText('Revoke · 폐기');
  await expect(summary).toContainText('인증 취득');
});

test('최대 100인증Set·긴 설명/자료의 네 화면 폭과 모바일 선택·제외 배정의 읽기 전용 상태', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'many-detail-courses',
    () => {},
    (s) => {
      const q = s.qualifications.find((q) => q.id === 'demo-qualification')!;
      q.description = '설비 구성과 변경 기준에 대한 상세 설명입니다.\n\n'.repeat(50);
      Object.assign(s.assignments.find((a) => a.id === 'assignment-1')!.qualificationMetadata!, {
        title: '설비 변경과 공정 조건의 차이를 판단하고 기록 근거를 설명하는 직무 자격 '.repeat(3),
        description: q.description,
      });
      for (let i = 3; i <= 100; i++) {
        const c = structuredClone(s.courses.find((c) => c.id === 'demo-course-2')!);
        c.id = c.entityId = `detail-course-${i}`;
        c.title = `${i}번째 인증Set · 설비 변경 시 반도체 공정 기준과 구성 버전 및 기록을 확인하는 상세 학습`;
        c.materials = [
          {
            id: `detail-material-${i}`,
            type: 'text',
            title: '학습자료 제목과 반도체 설비의 구성 기준을 확인하는 상세 설명',
            content: (
              '긴 본문과 줄바꿈을 읽고 평가 기준을 확인합니다.\n\n' +
              'A'.repeat(160) +
              '\n'
            ).repeat(20),
            description: '자료 설명',
            url: '',
          },
        ];
        if (i === 100) {
          c.operationalStatus = 'retired';
          c.retiredAt = new Date().toISOString();
          c.retiredBy = 'admin-1';
          c.retirementReason = '기존 배정 보존 시험';
        }
        s.courses.push(c);
        q.courseIds.push(c.id);
        s.enrollments.push({
          id: `detail-enrollment-${i}`,
          assignmentId: 'assignment-1',
          courseId: c.id,
        });
      }
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1?course=detail-course-100');
  await showLearningMaterials(page);
  await expect(page.locator('.qualification-course-content')).toContainText(
    '확정된 배정은 계속 진행할 수 있습니다.',
  );
  await expect(page.getByRole('link', { name: '평가 시작', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '인증Set', includeHidden: true });
  await expect(nav.getByRole('button')).toHaveCount(100);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width >= 1280) {
      await expect(nav).toBeVisible();
      expect(await nav.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    } else {
      await expect(nav).toBeHidden();
      await page.locator('.qualification-course-toggle').click();
      await expect(nav).toBeVisible();
      expect(await nav.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await page.locator('.qualification-course-toggle').click();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: test.info().outputPath(`qualification-detail-${width}.png`),
      fullPage: true,
    });
  }
  await page.locator('.qualification-course-toggle').click();
  await nav.getByRole('button').first().click();
  await expect(nav).toBeHidden();
  await expect(page.locator('.qualification-course-toggle')).toBeFocused();
  await expect(page).toHaveURL(/course=demo-course-1/);
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'exclude-detail',
    () => {},
    (s) => {
      s.assignments.find((a) => a.id === 'assignment-1')!.excludedReason = '시험 제외';
      return {};
    },
  );
  await page.reload();
  await expect(page.getByRole('link', { name: '평가 시작', exact: true })).toHaveCount(0);
  await expect(page.locator('.qualification-context-note')).toContainText('검증 제외');
  await page.goto('/qualifications/assignment-1?course=demo-course-1&stage=assessment');
  await expect(page.locator('.assessment-grid').getByRole('link')).toHaveCount(0);
});
