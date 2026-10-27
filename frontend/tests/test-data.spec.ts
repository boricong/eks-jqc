import type { Page } from '@playwright/test';
import { test, expect, actor } from './fixtures';
import { completePlan } from './workflow-helpers';

async function open(page: Page) {
  await page.goto('/system/test-data');
  await expect(
    page.getByRole('heading', { name: '테스트 데이터 관리', exact: true }),
  ).toBeVisible();
}
async function execute(page: Page, action: 'load' | 'reset') {
  const label = action === 'load' ? '테스트 데이터 로드' : '전체 데이터 초기화';
  await page.getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `${label} 확인`, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill(action === 'load' ? '테스트 로드' : '전체 초기화');
  await dialog.getByRole('button', { name: '실행 확인', exact: true }).click();
  await expect(page.getByLabel('접속 계정')).toHaveValue('');
  await actor(page, 'operator-1');
  await open(page);
  await expect(page.getByRole('heading', { name: `${label} 완료`, exact: true })).toBeVisible();
}

test('운영자 메뉴·초기화 취소·계정 보존·반복 로드와 네 화면 폭 및 키보드 확인', async ({
  page,
  backend,
}, info) => {
  const users = backend.store.snapshot().users;
  await page.goto('/');
  await actor(page, 'operator-1');
  await open(page);
  await expect(
    page.getByRole('button', { name: '테스트 데이터 로드', exact: true }),
  ).toBeDisabled();
  const before = backend.store.snapshot();
  await page.getByRole('button', { name: '전체 데이터 초기화', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('기존 인증서와 모든 버전 이력까지 삭제');
  await dialog.getByRole('textbox').fill('초기화');
  await expect(dialog.getByRole('button', { name: '실행 확인', exact: true })).toBeDisabled();
  await dialog.getByRole('textbox').press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(backend.store.snapshot()).toEqual(before);
  await execute(page, 'reset');
  await expect(
    page.getByRole('button', { name: '전체 데이터 초기화', exact: true }),
  ).toBeDisabled();
  expect(backend.store.snapshot().users).toEqual(users);
  await execute(page, 'load');
  expect(backend.store.snapshot().qualificationTemplates).toHaveLength(19);
  expect(backend.store.snapshot().commonCourses).toHaveLength(5);
  expect(backend.store.snapshot().courses.filter((c) => c.category === 'specialized')).toHaveLength(
    30,
  );
  await page.getByText('시험 방법과 보완할 설정', { exact: true }).click();
  await expect(page.getByText(/정답은 모두 첫 번째 선택지/).first()).toBeVisible();
  await expect(page.getByText(/배점 34·33·33점으로 총 100점/)).toBeVisible();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: info.outputPath(`test-data-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: '전체 데이터 초기화', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('textbox').focus();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await execute(page, 'reset');
  expect(backend.store.snapshot().courses).toHaveLength(0);
  expect(backend.store.snapshot().users).toEqual(users);
  await actor(page, 'admin-1');
  await page.goto('/system/test-data');
  await expect(page.getByRole('heading', { name: '테스트 데이터 관리', exact: true })).toHaveCount(
    0,
  );
});

test('저장 실패·동시 변경에 확인 입력 보존, 응답 유실 후 재접속·재시작은 영수증만 조회한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await open(page);
  await page.getByRole('button', { name: '전체 데이터 초기화', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('전체 초기화');
  await page.route('**/api/system/test-data/apply', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: '저장 실패 시험' }),
    }),
  );
  await dialog.getByRole('button', { name: '실행 확인', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('저장 실패 시험');
  await expect(dialog.getByRole('textbox')).toHaveValue('전체 초기화');
  await page.unroute('**/api/system/test-data/apply');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'conflict',
    () => {},
    (s) => {
      s.users[0]!.revision++;
      return {};
    },
  );
  await dialog.getByRole('button', { name: '실행 확인', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('확인 이후 데이터가 변경');
  await expect(dialog.getByRole('textbox')).toHaveValue('전체 초기화');
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '전체 데이터 초기화', exact: true }).click();
  await dialog.getByRole('textbox').fill('전체 초기화');
  await page.route('**/api/system/test-data/apply', async (route) => {
    await route.fetch();
    await route.abort();
  });
  await dialog.getByRole('button', { name: '실행 확인', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('서버에 연결할 수 없습니다');
  const revision = backend.store.snapshot().revision;
  await page.unroute('**/api/system/test-data/apply');
  await backend.restart();
  await page.goto('/');
  await actor(page, 'operator-1');
  await open(page);
  await expect(
    page.getByRole('heading', { name: '전체 데이터 초기화 완료', exact: true }),
  ).toBeVisible();
  expect(backend.store.snapshot().revision).toBe(revision);
  await expect(page.getByRole('button', { name: '테스트 데이터 로드', exact: true })).toBeEnabled();
});

test('내장 데이터의 계획 요청부터 실제 학습·평가·주관식·인증서 조회까지 진행한다', async ({
  page,
  backend,
}) => {
  test.setTimeout(90000);
  backend.setClock('2026-10-27T01:00:00.000Z');
  await page.goto('/');
  await actor(page, 'operator-1');
  await open(page);
  await execute(page, 'reset');
  await execute(page, 'load');
  const q = backend.store
    .snapshot()
    .qualifications.find(
      (q) =>
        q.entityId ===
        backend.store
          .snapshot()
          .organizationQualificationRequirements.find((r) => r.organizationId === 'org-photo')!
          .entityIds[0],
    )!;
  await actor(page, 'admin-1');
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: '정하린', exact: true }).check();
  await dialog.getByLabel('계획 작성 기한').fill('2026-12-31');
  await dialog.getByRole('button', { name: '요청 대상 확인', exact: true }).click();
  await dialog.getByRole('button', { name: '대상자에게 요청', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await actor(page, 'learner-2');
  await completePlan(page, q.title, false);
  const assignment = backend.store.snapshot().assignments.find((a) => a.learnerId === 'learner-2')!;
  for (const courseId of q.courseIds) {
    await page.goto(`/qualifications/${assignment.id}?course=${courseId}&stage=learning`);
    await expect(page.getByRole('region', { name: '학습 안내', exact: true })).toBeVisible();
    await page.goto(`/qualifications/${assignment.id}/courses/${courseId}/subjective-response`);
    await page.getByRole('button', { name: '주관식 답변 시작', exact: true }).click();
    await page
      .getByLabel('주관식 답변', { exact: true })
      .fill('표준 확인 후 이상을 기록하고 보고합니다.');
    await page.getByRole('button', { name: '제출 전 답변 확인', exact: true }).click();
    await page.getByRole('button', { name: '답변 최종 제출', exact: true }).click();
    await expect(page.getByRole('heading', { name: '제출한 답변', exact: true })).toBeVisible();
    for (const kind of ['objective', 'practical']) {
      if (courseId === q.courseIds[0]) {
        await page.goto(`/qualifications/${assignment.id}/courses/${courseId}/${kind}`);
        const tabs = page.getByRole('tablist', { name: '응시 문항', exact: true });
        for (let i = 0; i < 3; i++) {
          await tabs.getByRole('tab').nth(i).click();
          await expect(page.getByText(/\(정답: 1번\)$/).first()).toBeVisible();
          await page
            .getByRole('radio')
            .nth(i === 0 ? 1 : 0)
            .check();
          await expect(page.locator('.save-status')).toHaveText('저장됨');
        }
        await page.getByRole('button', { name: /^답안 확인(?:으로 돌아가기)?$/ }).click();
        await page.getByRole('button', { name: '최종 제출', exact: true }).click();
        await expect(page.locator('.assessment-outcome')).toHaveClass(/outcome-failed/);
      }
      await page.goto(`/qualifications/${assignment.id}/courses/${courseId}/${kind}`);
      const tabs = page.getByRole('tablist', { name: '응시 문항', exact: true });
      for (let i = 0; i < 3; i++) {
        await tabs.getByRole('tab').nth(i).click();
        await expect(page.getByText(/\(정답: 1번\)$/).first()).toBeVisible();
        await page.getByRole('radio').first().check();
        await expect(page.locator('.save-status')).toHaveText('저장됨');
      }
      await page.getByRole('button', { name: /^답안 확인(?:으로 돌아가기)?$/ }).click();
      await page.getByRole('button', { name: '최종 제출', exact: true }).click();
      await expect(page.getByRole('heading', { name: '평가 통과', exact: true })).toBeVisible();
    }
  }
  expect(backend.store.snapshot().certifications).toHaveLength(1);
  await page.goto(`/certifications/${assignment.id}`);
  await expect(page.getByText(/v1\.0/).first()).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(
    page.getByRole('region', { name: '발급 당시 자격 정보', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/v1\.0/).first()).toBeVisible();
});
