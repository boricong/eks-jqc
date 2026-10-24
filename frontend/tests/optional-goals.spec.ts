import { test, expect, actor } from './fixtures';
import { requestPlan } from './workflow-helpers';

for (const mode of ['skip', 'empty', 'partial'] as const) {
  test(`목표 ${mode} 상태로 최종 확인·완료, 선택 단계 왕복·확정 후 추가/삭제`, async ({
    page,
    backend,
  }) => {
    await page.goto('/');
    await actor(page, 'admin-1');
    await page.goto('/admin/assignments');
    await requestPlan(page, '정하린');
    await actor(page, 'learner-2');
    await page.goto('/plans');
    await page.getByLabel('취득할 자격').selectOption('demo-qualification');
    await page.getByRole('button', { name: '계획 시작', exact: true }).click();
    await page.getByLabel('목표 인증일', { exact: true }).fill('2029-12-01');
    const plan = backend.store.snapshot().plans[0]!;
    const goals = page.locator('textarea[data-plan-field]');
    if (mode !== 'skip') {
      await page.getByRole('button', { name: '학습 목표 입력(선택)', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: '학습 목표(선택)', exact: true }),
      ).toBeVisible();
      if (mode === 'partial')
        await goals.first().fill('줄바꿈을 보존하는 목표\n독립적으로 기준을 설명한다.');
      else await goals.first().fill('   ');
      await page.getByRole('button', { name: '2. 일정 수립', exact: true }).click();
    }
    await page.getByRole('button', { name: '최종 확인', exact: true }).click();
    await expect(page.getByRole('heading', { name: '계획 최종 확인', exact: true })).toBeVisible();
    await expect(page.locator('.plan-review-goal')).toHaveCount(mode === 'partial' ? 1 : 0);
    await expect(page.getByRole('button', { name: '계획 완료', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '3. 학습 목표(선택)', exact: true }).click();
    await expect(goals.first()).toHaveValue(
      mode === 'partial'
        ? '줄바꿈을 보존하는 목표\n독립적으로 기준을 설명한다.'
        : mode === 'empty'
          ? '   '
          : '',
    );
    await page.getByRole('button', { name: '최종 확인', exact: true }).click();
    await page.getByRole('button', { name: '계획 완료', exact: true }).click();
    await expect(page).toHaveURL(/\/qualifications\/[^/?]+$/);
    const summary = page.getByRole('region', { name: '인증Set 요약', exact: true });
    await expect(summary.getByRole('heading', { name: '학습 목표', exact: true })).toHaveCount(0);
    await expect(summary).not.toContainText('작성된 학습 목표가 없습니다.');
    expect(backend.store.snapshot().planningRequests[0]!.completion).toBeUndefined();
    await page.goto(`/plans/${plan.id}`);
    const course = page.locator(`[data-review-course="${plan.schedules[0]!.courseId}"]`);
    await course
      .getByRole('button', {
        name: mode === 'partial' ? '학습 목표 수정' : '학습 목표 추가(선택)',
        exact: true,
      })
      .click();
    const goal = page.locator(`[data-plan-field="${plan.schedules[0]!.courseId}.goal"]`);
    await expect(goal).toBeFocused();
    await goal.fill('확정 후 선택 목표 추가');
    await expect(page.getByRole('button', { name: '일정·목표 변경 저장' })).toBeDisabled();
    await page.getByLabel('계획 변경 사유').fill('선택 목표 추가');
    await page.getByRole('button', { name: '일정·목표 변경 저장' }).click();
    await expect(page.locator('.save-status')).toHaveText('계획 완료');
    await goal.fill('');
    await page.getByLabel('계획 변경 사유').fill('선택 목표 삭제');
    await page.getByRole('button', { name: '일정·목표 변경 저장' }).click();
    await expect
      .poll(() => backend.store.snapshot().plans.find((p) => p.id === plan.id)!.schedules[0]!.goal)
      .toBe('');
    await page.getByRole('button', { name: '4. 최종 확인', exact: true }).click();
    await expect(course.locator('.plan-review-goal')).toHaveCount(0);
    await expect(
      course.getByRole('button', { name: '학습 목표 추가(선택)', exact: true }),
    ).toBeVisible();
    expect(backend.store.snapshot().assignments.filter((a) => a.planId === plan.id)).toHaveLength(
      1,
    );
  });
}
