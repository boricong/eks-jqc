import { test, expect, actor } from './fixtures';
import { assessmentQuestions } from '@eks/contracts';

test('업무 상태 변경의 네 화면 폭·키보드·취소·간결한 표시와 자동 말소·복귀', async ({
  page,
  backend,
}, info) => {
  backend.setClock('2026-10-29T01:00:00.000Z');
  await page.goto('/');
  await actor(page, 'learner-1');
  const headers = async () => ({
    'X-Session-Tab': (await page.evaluate(() => sessionStorage.getItem('eks-session-tab')))!,
    'X-EKS-Release-Contract': '3',
    'Idempotency-Key': crypto.randomUUID(),
  });
  for (const e of backend.store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === 'assignment-1')) {
    const c = backend.store.snapshot().courses.find((c) => c.id === e.courseId)!;
    for (const kind of c.assessmentKinds) {
      if (
        backend.store
          .snapshot()
          .attempts.some((t) => t.enrollmentId === e.id && t.kind === kind && t.result === 'passed')
      )
        continue;
      const start = await page.request.post(`/api/enrollments/${e.id}/attempts`, {
        headers: await headers(),
        data: { kind },
      });
      expect(start.ok(), await start.text()).toBeTruthy();
      const t = await start.json();
      const save = await page.request.put(`/api/attempts/${t.id}/draft`, {
        headers: await headers(),
        data: {
          revision: t.revision,
          answers: Object.fromEntries(assessmentQuestions(c, kind).map((q) => [q.id, q.correct])),
        },
      });
      expect(save.ok(), await save.text()).toBeTruthy();
      const submit = await page.request.post(`/api/attempts/${t.id}/submit`, {
        headers: await headers(),
        data: { revision: t.revision + 1 },
      });
      expect(submit.ok(), await submit.text()).toBeTruthy();
    }
  }
  const user = backend.store.snapshot().users.find((u) => u.id === 'learner-1')!;
  await actor(page, 'admin-1');
  await page.goto('/admin/users');
  const button = page.getByRole('button', { name: `${user.name} 업무 상태 변경`, exact: true });
  const emptyUser = backend.store.snapshot().users.find((u) => u.id === 'learner-2')!;
  await expect(
    page.getByRole('button', { name: `${emptyUser.name} 업무 상태 변경`, exact: true }),
  ).toBeDisabled();
  const restriction =
    '현재 팀의 유효 Auditee 인증이 1개 이상 있어야 Deactive로 변경할 수 있습니다.';
  await expect(page.getByText(restriction, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: `${emptyUser.name} 업무 상태 변경`, exact: true }),
  ).toHaveAttribute('title', restriction);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await button.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '업무 상태 변경', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '변경', exact: true })).toBeEnabled();
    await expect(dialog.locator('textarea')).toHaveCount(0);
    await expect(dialog.getByText('active → deactive', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    if (width === 390)
      expect(
        await page
          .locator('.work-users-table td')
          .evaluateAll((cells) =>
            cells.every((cell) =>
              Array.from(cell.children).every(
                (child) =>
                  child.getBoundingClientRect().bottom <= cell.getBoundingClientRect().bottom + 1,
              ),
            ),
          ),
      ).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`work-status-${width}.png`), fullPage: true });
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  }
  await button.click();
  const dialog = page.getByRole('dialog', { name: '업무 상태 변경', exact: true });
  let fail = true;
  await page.route('**/api/team-users/*/work-status?*', async (route) => {
    if (route.request().method() === 'PUT' && fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '시험 저장 실패' }),
      });
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: '변경', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('시험 저장 실패');
  await dialog.getByRole('button', { name: '변경', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator('.work-users-table .status').filter({ hasText: 'deactive' }),
  ).toBeVisible();
  backend.setClock('2027-04-29T15:00:00.000Z');
  await page.reload();
  await expect(page.getByText('복귀 후 재취득 필요', { exact: true })).toBeVisible();
  await button.click();
  await dialog.getByRole('button', { name: '변경', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeDisabled();
  expect(
    backend.store.snapshot().certifications.find((c) => c.learnerId === 'learner-1')!
      .lifecycleStatus,
  ).toBe('Revoke');
});
