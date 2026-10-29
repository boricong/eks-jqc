import { test, expect, actor } from './fixtures';
import { requestPlan, savePlanViaApi } from './workflow-helpers';

for (const mode of ['skip', 'empty', 'partial'] as const) {
  test(`목표 ${mode} 상태로 최종 확인·완료, 선택 단계 왕복·확정 화면 잠금과 API 목표 추가/삭제`, async ({
    page,
    backend,
  }) => {
    await page.goto('/');
    await actor(page, 'admin-1');
    await page.goto('/admin/assignments');
    await requestPlan(page, '정하린');
    await actor(page, 'learner-2');
    await page.goto('/plans');
    const row = page.locator('.request-schedule-row').first();
    await row.getByLabel('완료일', { exact: true }).fill('2027-02-01');
    await row.locator('summary').click();
    const goals = row.getByLabel('학습 목표(선택)');
    if (mode !== 'skip') {
      await expect(page.getByLabel('학습 목표(선택)', { exact: true })).toBeVisible();
      if (mode === 'partial')
        await goals.first().fill('줄바꿈을 보존하는 목표\n독립적으로 기준을 설명한다.');
      else await goals.first().fill('   ');
    }
    await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '전체 계획 최종 확인', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.request-schedule-review')).toBeVisible();
    await expect(page.getByRole('button', { name: '전체 계획 확정', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '일정 수정', exact: true }).click();
    await row.locator('summary').click();
    await expect(goals.first()).toHaveValue(
      mode === 'partial'
        ? '줄바꿈을 보존하는 목표\n독립적으로 기준을 설명한다.'
        : mode === 'empty'
          ? '   '
          : '',
    );
    await page.getByRole('button', { name: '전체 계획 확인', exact: true }).click();
    await page.getByRole('button', { name: '전체 계획 확정', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '전체 계획 확정 완료', exact: true }),
    ).toBeVisible();
    const plan = backend.store.snapshot().plans[0]!;
    await page.getByRole('link', { name: '학습·평가로 이동', exact: true }).click();
    const summary = page.getByRole('region', { name: '인증Set 요약', exact: true });
    await expect(summary.getByRole('heading', { name: '학습 목표', exact: true })).toHaveCount(0);
    await expect(summary).not.toContainText('작성된 학습 목표가 없습니다.');
    expect(backend.store.snapshot().planningRequests[0]!.completion).toBeDefined();
    await page.goto(`/plans/${plan.id}`);
    await expect(page.getByRole('navigation', { name: '계획 작성 단계' })).toHaveCount(0);
    await expect(page.getByLabel('계획 변경 사유')).toHaveCount(0);
    await savePlanViaApi(
      page,
      plan.id,
      { goal: '확정 후 서버에서 선택 목표 추가' },
      '선택 목표 추가',
    );
    await page.reload();
    await expect(page.locator('.plan-review-goal')).toContainText(
      '확정 후 서버에서 선택 목표 추가',
    );
    await savePlanViaApi(page, plan.id, { goal: '' }, '선택 목표 삭제');
    await page.reload();
    await expect(page.locator('.plan-review-goal')).toContainText('미입력');
    await expect(page.getByRole('button', { name: '학습 목표 수정', exact: true })).toHaveCount(0);
    expect(backend.store.snapshot().assignments.filter((a) => a.planId === plan.id)).toHaveLength(
      1,
    );
  });
}
