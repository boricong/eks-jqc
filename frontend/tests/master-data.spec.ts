import { test, expect, actor } from './fixtures';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { exportMaster, masterPayload } from '../../server/src/master-data';
import { configureTestPolicies } from '../../server/tests/policy-helpers';

test('설정·기준 내보내기와 전체 초기화 확인·취소·보존 결과', async ({ page, backend }) => {
  await configureTestPolicies(backend.store);
  const before = masterPayload(backend.store.snapshot(), backend.store.organizations.snapshot());
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/testing');
  await expect(
    page.getByRole('heading', { name: '학습·평가 내역 초기화', exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '설정·기준 파일 내보내기', exact: true }).click();
  const file = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(file.payload).toEqual(before);
  expect(file.payload).not.toHaveProperty('plans');
  await page.getByRole('button', { name: '보존·삭제 내역 확인', exact: true }).click();
  await page.getByRole('button', { name: '설정·기준 보존 전체 초기화', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', { name: '전체 초기화 실행', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  expect(backend.store.snapshot().assignments.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '설정·기준 보존 전체 초기화', exact: true }).click();
  await dialog.getByLabel('전체 작업 확인 문구').fill('전체 초기화');
  await dialog.getByRole('button', { name: '전체 초기화 실행', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '설정·기준 보존 초기화 완료', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '접속 계정 선택', exact: true })).toBeVisible();
  expect(masterPayload(backend.store.snapshot(), backend.store.organizations.snapshot())).toEqual(
    before,
  );
  for (const key of [
    'plans',
    'planningRequests',
    'assignments',
    'enrollments',
    'notices',
    'audits',
    'requests',
  ] as const)
    expect(backend.store.snapshot()[key]).toHaveLength(0);
  await actor(page, 'operator-1');
});

test('다른 서버 파일 검사·전체 교체와 불러온 운영자 계정', async ({ page, backend }) => {
  const file = exportMaster(
    backend.store.snapshot(),
    backend.store.organizations.snapshot(),
    new Date().toISOString(),
  );
  file.payload.users.find((u) => u.id === 'operator-1')!.id = 'new-operator';
  file.payload.users.find((u) => u.id === 'new-operator')!.name = '불러온 운영자';
  const { contentHash } = await import('../../server/src/master-data');
  file.sha256 = contentHash(file.payload);
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/testing');
  const input = page.getByLabel('설정·기준 JSON 파일 (최대 25MB)', { exact: true });
  await input.setInputFiles({
    name: '잘못된.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{bad'),
  });
  await page.getByRole('button', { name: '파일 검사', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('JSON 파일을 읽을 수 없습니다');
  await input.setInputFiles({
    name: '다른서버.eksmaster.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await page.getByRole('button', { name: '파일 검사', exact: true }).click();
  await expect(page.getByRole('heading', { name: '전체 교체 전 확인', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '전체 교체 확인', exact: true }).click();
  await page.getByRole('dialog').getByLabel('전체 작업 확인 문구').fill('전체 교체');
  await page.getByRole('button', { name: '전체 교체 실행', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '설정·기준 전체 교체 완료', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#actor option[value="new-operator"]')).toHaveText(/불러온 운영자/);
  await actor(page, 'new-operator');
  expect(backend.store.snapshot().users.some((u) => u.id === 'operator-1')).toBeFalsy();
  expect(backend.store.snapshot().assignments).toHaveLength(0);
});

test('확인 중 데이터가 바뀌면 파일·확인 입력을 보존하고 다시 검사하도록 안내한다', async ({
  page,
  backend,
}) => {
  const file = exportMaster(
    backend.store.snapshot(),
    backend.store.organizations.snapshot(),
    new Date().toISOString(),
  );
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/testing');
  await page.getByLabel('설정·기준 JSON 파일 (최대 25MB)', { exact: true }).setInputFiles({
    name: '보존.eksmaster.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await page.getByRole('button', { name: '파일 검사', exact: true }).click();
  await page.getByRole('button', { name: '전체 교체 확인', exact: true }).click();
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    'concurrent',
    () => {},
    (s) => {
      s.users[0]!.name += ' 변경';
      return {};
    },
  );
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('전체 작업 확인 문구').fill('전체 교체');
  await dialog.getByRole('button', { name: '전체 교체 실행', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('확인 이후 데이터가 바뀌었습니다');
  await expect(dialog.getByLabel('전체 작업 확인 문구')).toHaveValue('전체 교체');
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByText('보존.eksmaster.json', { exact: true })).toBeVisible();
  expect(backend.store.snapshot().assignments.length).toBeGreaterThan(0);
});

test('초기화 응답이 유실되어도 재접속 후 최초 영수증을 확인하고 새 기록을 보존한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/testing');
  await page.getByRole('button', { name: '보존·삭제 내역 확인', exact: true }).click();
  await page.getByRole('button', { name: '설정·기준 보존 전체 초기화', exact: true }).click();
  let dropped = false;
  await page.route('**/api/testing/master-reset', async (route) => {
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('전체 작업 확인 문구').fill('전체 초기화');
  await dialog.getByRole('button', { name: '전체 초기화 실행', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('서버에 연결할 수 없습니다');
  await backend.store.transact(
    'operator-1',
    randomUUID(),
    'new-record',
    () => {},
    (s) => {
      s.notices.push({
        id: 'after-reset',
        scope: 'system',
        title: '초기화 후 공지',
        body: '새 기록',
        date: '2026-10-22',
        published: true,
        revision: 1,
      });
      return {};
    },
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: '접속 계정 선택', exact: true })).toBeVisible();
  await actor(page, 'operator-1');
  await expect(
    page.getByRole('heading', { name: '설정·기준 보존 초기화 완료', exact: true }),
  ).toBeVisible();
  expect(backend.store.snapshot().notices).toHaveLength(1);
});

test('다른 탭 초기화는 기준 자동 저장을 중단하고 구형 브라우저 복구 초안을 제거한다', async ({
  page,
  context,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/catalog');
  await page.getByTestId('catalog-qualification-demo-qualification').getByRole('button').click();
  await page.getByLabel('인증Set명', { exact: true }).fill('이전 세대 입력');
  await expect(page.getByText('이 브라우저에 보관됨', { exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/');
  await actor(other, 'operator-1');
  await other.goto('/system/testing');
  await other.getByRole('button', { name: '보존·삭제 내역 확인', exact: true }).click();
  await other.getByRole('button', { name: '설정·기준 보존 전체 초기화', exact: true }).click();
  await other.getByRole('dialog').getByLabel('전체 작업 확인 문구').fill('전체 초기화');
  await other.getByRole('button', { name: '전체 초기화 실행', exact: true }).click();
  await expect(page.getByRole('heading', { name: '접속 계정 선택', exact: true })).toBeVisible();
  expect(backend.store.snapshot().courses.some((c) => c.title === '이전 세대 입력')).toBeFalsy();
  const recoveryCount = () =>
    page.evaluate(
      async () =>
        new Promise<number>((resolve, reject) => {
          const r = indexedDB.open('eks-catalog-recovery');
          r.onerror = () => reject(r.error);
          r.onsuccess = () => {
            const db = r.result,
              q = db.transaction('works').objectStore('works').count();
            q.onsuccess = () => {
              resolve(q.result);
              db.close();
            };
          };
        }),
    );
  await expect.poll(recoveryCount).toBe(0);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/catalog');
  await expect(page.getByRole('button', { name: '이어서 작성', exact: true })).toHaveCount(0);
  await other.close();
});

test('테스트 관리의 두 초기화·이전 화면은 네 가지 폭에서 조작·구분·가로 넘침이 정상이다', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/testing');
  await page.getByRole('button', { name: '보존·삭제 내역 확인', exact: true }).click();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .getByRole('heading', { name: '설정·기준 데이터 이전', exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await expect(
      page.getByRole('button', { name: '설정·기준 파일 내보내기', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`master-${width}.png`), fullPage: true });
  }
});
