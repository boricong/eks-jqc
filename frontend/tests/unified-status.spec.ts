import { test, expect, actor } from './fixtures';

test('팀·시스템 사용자 수정창은 무자격 상태와 비활성 사유를 표시하며 옛 메뉴를 제거한다', async ({
  page,
  backend,
}, info) => {
  await page.goto('/');
  const user = backend.store.snapshot().users.find((u) => u.id === 'learner-2')!;
  for (const mode of ['team', 'system']) {
    await actor(page, mode === 'team' ? 'admin-1' : 'operator-1');
    await page.goto(mode === 'team' ? '/admin/users' : '/system/users');
    await expect(page.getByRole('link', { name: '취득 대상자 상태', exact: true })).toHaveCount(0);
    const row = page
      .locator('tbody tr')
      .filter({ has: page.getByRole('button', { name: `${user.name} 수정`, exact: true }) });
    await expect(row.getByText('active', { exact: true })).toBeVisible();
    await expect(
      row.getByRole('button', { name: `${user.name} 업무 상태 변경`, exact: true }),
    ).toBeDisabled();
    await expect(
      row.getByText('유효한 자격 인증이 없어 deactive로 변경할 수 없습니다.', { exact: true }),
    ).toBeVisible();
    for (const width of [1920, 1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: `${user.name} 수정`, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `${user.name} 정보 수정`, exact: true });
      await expect(
        dialog.getByRole('button', { name: '업무 상태 변경', exact: true }),
      ).toBeDisabled();
      await expect(
        dialog.getByText('유효한 자격 인증이 없어 deactive로 변경할 수 없습니다.', { exact: true }),
      ).toBeVisible();
      await dialog.getByLabel('이름', { exact: true }).fill(`${user.name} 수정중`);
      await expect(
        dialog.getByText('사용자 정보를 먼저 저장하거나 취소해 주세요.', { exact: true }),
      ).toBeVisible();
      await dialog.getByLabel('이름', { exact: true }).fill(user.name);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBeTruthy();
      await page.screenshot({
        path: info.outputPath(`status-${mode}-${width}.png`),
        fullPage: true,
      });
      await dialog.getByRole('button', { name: '취소', exact: true }).click();
    }
    await page.goto('/');
  }
  await actor(page, 'admin-1');
  await page.goto('/admin/targets');
  await expect(page).toHaveURL(/\/admin\/users/);
  expect(backend.store.snapshot().users.find((u) => u.id === user.id)!.name).toBe(user.name);
});

test('시스템 사용자 수정창에서 무자격 deactive 사용자는 active로 복귀할 수 있다', async ({
  page,
  backend,
}) => {
  const { setWorkStatus } = await import('../../server/tests/work-status-fixture');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'fixture',
    () => {},
    (s) => {
      setWorkStatus(
        s.users.find((u) => u.id === 'learner-2')!,
        'deactive',
        new Date().toISOString(),
      );
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/users');
  const user = backend.store.snapshot().users.find((u) => u.id === 'learner-2')!;
  await page.getByRole('button', { name: `${user.name} 수정`, exact: true }).click();
  const editor = page.getByRole('dialog', { name: `${user.name} 정보 수정`, exact: true });
  await editor.getByRole('button', { name: '업무 상태 변경', exact: true }).click();
  const change = page.getByRole('dialog', { name: '업무 상태 변경', exact: true });
  await expect(change.getByText('deactive → active', { exact: true })).toBeVisible();
  await change.getByRole('button', { name: '변경', exact: true }).click();
  await expect(change).toHaveCount(0);
  await expect(editor.getByText('active', { exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: '업무 상태 변경', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: '취소', exact: true }).click();
  expect(backend.store.snapshot().users.find((u) => u.id === user.id)!.workStatus).toBe('active');
});
