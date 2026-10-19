import { test, expect, actor } from './fixtures';

for (const pass of [true, false]) {
  test(`평가자·학습자 관점 구분: 실기 ${pass ? '통과 후 객관식 대기' : '미통과'}`, async ({
    page,
  }) => {
    await page.goto('/');
    await actor(page, 'learner-1');
    await page.getByRole('link', { name: '이어서 진행' }).click();
    await page.getByRole('button', { name: /02 기록 작성/ }).click();
    await page.getByRole('link', { name: '평가 요청', exact: true }).click();
    await page.getByRole('button', { name: '평가 요청', exact: true }).click();
    await actor(page, 'ft-1');
    await page.getByRole('link', { name: 'FT 평가', exact: true }).click();
    await page.getByRole('link', { name: '평가하기' }).click();
    await expect(page.getByText('학습자 김민서', { exact: true })).toBeVisible();
    await expect(page.getByText('평가자 박준호', { exact: true })).toBeVisible();
    for (const item of await page.locator('.ft-item').all()) {
      await item.getByLabel(pass ? '통과' : '미통과', { exact: true }).check();
      await item.getByLabel('판정 근거').fill('가상 수행을 관찰한 판정 근거');
    }
    await page.getByRole('button', { name: '판정 확인', exact: true }).click();
    await expect(page.getByRole('button', { name: '판정 수정', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '평가 확정', exact: true }).click();
    await expect(page.getByRole('heading', { name: '실기 평가를 확정했습니다.' })).toBeVisible();
    await expect(page.locator('.result-panel')).toContainText(
      pass
        ? '김민서 님이 실기 평가를 통과했습니다. 과정 수료에는 객관식 평가 통과가 필요합니다.'
        : '김민서 님의 실기 평가 결과는 미통과입니다. 학습자가 다시 요청하면 재평가할 수 있습니다.',
    );
    await expect(page.getByRole('heading', { name: '과정을 수료했습니다.' })).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath(`ft-result-${pass ? 'passed' : 'failed'}.png`),
    });
    await actor(page, 'learner-1');
    await page.getByRole('link', { name: '이어서 진행' }).click();
    await page.getByRole('button', { name: /02 기록 작성/ }).click();
    if (pass) {
      await page.getByRole('link', { name: '응시하기', exact: true }).click();
      await page.getByLabel('대상 이름과 확인한 값', { exact: true }).check();
      await page.getByLabel('항목의 누락 여부', { exact: true }).check();
      await page.getByRole('button', { name: '답안 확인', exact: true }).click();
      await page.getByRole('button', { name: '제출', exact: true }).click();
      await expect(page.getByRole('heading', { name: '과정을 수료했습니다.' })).toBeVisible();
    } else {
      await expect(page.getByRole('link', { name: '다시 요청', exact: true })).toBeVisible();
    }
  });
}

test('운영자 전체 진행 초기화·취소·기존 화면 보호·처음부터 재요청', async ({
  page,
  context,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.getByRole('link', { name: '이어서 진행' }).click();
  await page.getByRole('link', { name: '다시 요청' }).click();
  await page.getByRole('button', { name: '다시 요청', exact: true }).click();
  const ftPage = await context.newPage();
  await ftPage.goto('/');
  await actor(ftPage, 'ft-1');
  await ftPage.getByRole('link', { name: 'FT 평가', exact: true }).click();
  await ftPage.getByRole('link', { name: '평가하기' }).click();
  const ftItem = ftPage.locator('.ft-item').first();
  await ftItem.getByLabel('통과', { exact: true }).check();
  await ftItem.getByLabel('판정 근거').fill('초기화 전 가상 판정');
  await expect(ftPage.locator('.save-status')).toHaveText('저장됨');

  const adminPage = await context.newPage();
  await adminPage.goto('/');
  await actor(adminPage, 'operator-1');
  await adminPage.getByRole('link', { name: '시스템 운영', exact: true }).click();
  await adminPage.getByRole('link', { name: '테스트 관리', exact: true }).click();
  await adminPage.getByLabel('초기화 대상', { exact: true }).selectOption('all');
  await expect(adminPage.locator('.reset-counts')).toContainText('객관식 응시');
  await adminPage.getByRole('button', { name: '진행 내역 초기화', exact: true }).click();
  const dialog = adminPage.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '초기화 실행' })).toBeDisabled();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  expect(backend.store.snapshot().attempts.length).toBeGreaterThan(0);
  await adminPage.getByRole('button', { name: '진행 내역 초기화', exact: true }).click();
  await dialog.getByLabel('확인을 위해 ‘초기화’를 입력해 주세요.').fill('초기화');
  await dialog.getByRole('button', { name: '초기화 실행', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    adminPage.getByText('초기화할 진행 내역이 없습니다.', { exact: true }),
  ).toBeVisible();
  expect(backend.store.snapshot().attempts).toHaveLength(0);
  expect(backend.store.snapshot().assignments).toHaveLength(1);
  await adminPage.screenshot({ path: test.info().outputPath('progress-reset-complete.png') });

  await ftItem.getByLabel('판정 근거').fill('초기화 뒤 도착한 이전 요청');
  await expect(ftPage.locator('.save-error')).toContainText('기록을 찾을 수 없습니다.');
  expect(backend.store.snapshot().attempts).toHaveLength(0);
  ftPage.once('dialog', (dialog) => dialog.accept());
  await ftPage.reload();
  await expect(
    ftPage.getByRole('heading', { name: '학습자의 실기 평가 요청을 기다리고 있습니다.' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '평가 요청', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '평가 요청', exact: true }).click();
  await expect(page.getByText('박준호 FT 평가 대기')).toBeVisible();
  expect(backend.store.snapshot().attempts[0]).toMatchObject({
    round: 1,
    evaluatorId: 'ft-1',
    status: 'in_progress',
  });
});
