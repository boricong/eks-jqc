import { test, expect, actor } from './fixtures';
import { exportCatalog } from '../../server/src/catalog';
import { writeCatalogWorkbook } from '../../server/src/catalog-workbook';
import ExcelJS from 'exceljs';

test('응답 유실 후 복구·동일 요청 재시도는 새 버전을 중복 생성하지 않는다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/catalog');
  await page.getByTestId('catalog-qualification-demo-qualification').getByRole('button').click();
  await page.getByLabel('과정명', { exact: true }).fill('응답 유실 검증');
  let dropped = false;
  await page.route('**/api/catalog/batches?*', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
  await page.getByRole('button', { name: '선택 기준 초안 저장', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '연결할 수 없습니다' })).toBeVisible();
  expect(
    backend.store.snapshot().qualifications.filter((q) => q.entityId === 'demo-qualification'),
  ).toHaveLength(2);
  await page.reload();
  await page.getByRole('button', { name: '이어서 작성', exact: true }).click();
  await page.getByRole('button', { name: '저장 결과 확인·재시도', exact: true }).click();
  await expect(page.getByText('서버 기준과 같습니다.', { exact: true })).toBeVisible();
  expect(
    backend.store.snapshot().qualifications.filter((q) => q.entityId === 'demo-qualification'),
  ).toHaveLength(2);
});

test('여러 탭의 자동 보관은 별개이며 다른 계정에 노출되지 않는다', async ({ page, context }) => {
  const second = await context.newPage();
  for (const [tab, title] of [
    [page, '첫 탭 수정'],
    [second, '두 번째 탭 수정'],
  ] as const) {
    await tab.goto('/');
    await actor(tab, 'admin-1');
    await tab.goto('/admin/catalog');
    await tab.getByTestId('catalog-qualification-demo-qualification').getByRole('button').click();
    await tab.getByLabel('과정명', { exact: true }).fill(title);
    await expect(tab.getByText('이 브라우저에 보관됨', { exact: true })).toBeVisible();
  }
  const records = await page.evaluate(
    async () =>
      new Promise<any[]>((resolve, reject) => {
        const r = indexedDB.open('eks-catalog-recovery');
        r.onsuccess = () => {
          const q = r.result.transaction('works').objectStore('works').getAll();
          q.onsuccess = () => {
            resolve(q.result);
            r.result.close();
          };
          q.onerror = () => reject(q.error);
        };
      }),
  );
  expect(records).toHaveLength(2);
  expect(records.map((r) => r.workbook.sheets[0].tables.courses[0].title).sort()).toEqual([
    '두 번째 탭 수정',
    '첫 탭 수정',
  ]);
  second.once('dialog', (d) => d.accept());
  await second.getByLabel('접속 계정').selectOption('learner-1');
  await expect(second.getByRole('heading', { name: '김민서 님', exact: true })).toBeVisible();
  await expect(second.getByText('두 번째 탭 수정', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('과정명', { exact: true })).toHaveValue('첫 탭 수정');
});

test('Excel 수식 오류는 재검사로 사라지지 않으며 해당 값을 수정해야 저장할 수 있다', async ({
  page,
  backend,
}) => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    (await writeCatalogWorkbook(
      exportCatalog(backend.store.snapshot(), 'org-photo', ['demo-qualification']),
    )) as any,
  );
  const ws = book.worksheets[2]!,
    t = (ws.getTables() as any[]).find((t) => t.name.startsWith('EKS_objective_')).table,
    start = Number(/\d+/.exec(t.tableRef)![0]),
    col = t.columns.findIndex((c: any) => c.name === '문항') + 1;
  ws.getCell(start + 1, col).value = { formula: '"문항"', result: '문항' };
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/catalog');
  await page.locator('input[type=file]').setInputFiles({
    name: '수식오류.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await book.xlsx.writeBuffer()),
  });
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '선택 기준 초안 저장', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('수식 대신');
});

test('자격·과정 중심 편집: 코드 없이 문항 작성, 제외 취소와 필터 밖 과정 보존', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/catalog');
  await expect(page.getByRole('button', { name: /선택 자격 편집/ })).toBeDisabled();
  await page.getByTestId('catalog-qualification-demo-qualification').getByRole('button').click();
  await expect(page.locator('.catalog-nav-item')).toHaveCount(1);
  await expect(page.getByLabel('과정명', { exact: true })).toHaveValue('자료 확인');
  await expect(page.getByLabel('자격코드', { exact: true })).toHaveCount(0);
  await page.getByLabel('과정명', { exact: true }).fill('자료 확인 개정');
  await page.locator('.catalog-course-tree button').filter({ hasText: '기록 작성' }).click();
  await expect(page.getByLabel('과정명', { exact: true })).toHaveValue('기록 작성');
  await page.getByRole('button', { name: '과정 제외', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('함께 제외');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('.catalog-course-tree')).toContainText('자료 확인 개정');
  await expect(page.locator('.catalog-course-tree')).toContainText('기록 작성');
  await page.getByRole('tab', { name: /지식 평가/ }).click();
  await expect(page.getByRole('button', { name: '선택 항목 제외', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '항목 추가', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('과정', { exact: true })).toHaveValue('demo-course-2');
  await dialog.getByLabel('문항', { exact: true }).fill('기록의 출처를 어떻게 확인하나요?');
  await dialog.getByLabel('1번 선택지', { exact: true }).fill('원본과 대조');
  await dialog.getByLabel('2번 선택지', { exact: true }).fill('확인 생략');
  await dialog.getByLabel('1번 선택지를 정답으로 지정', { exact: true }).check();
  await dialog.getByRole('button', { name: '내용 반영' }).click();
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
  await page.getByRole('button', { name: '선택 기준 초안 저장', exact: true }).click();
  await expect(page.getByText('서버 기준과 같습니다.', { exact: true })).toBeVisible();
  const snapshot = backend.store.snapshot(),
    q = snapshot.qualifications.find(
      (q) => q.status === 'draft' && q.entityId === 'demo-qualification',
    )!;
  expect(q).toBeTruthy();
  const courses = q.courseIds.map((id) => snapshot.courses.find((c) => c.id === id)!);
  expect(courses.map((c) => c.title)).toEqual(['자료 확인 개정', '기록 작성']);
  expect(courses[1]!.questions.at(-1)!.prompt).toContain('기록의 출처');
  expect(courses[0]!.questions).toHaveLength(2);
});

test('일부 초안 저장·등록은 다른 자격의 입력을 유지하고 브라우저 복구로 이어 쓴다', async ({
  page,
  backend,
}) => {
  const state = backend.store.snapshot(),
    data = exportCatalog(
      state,
      'org-photo',
      state.qualifications.map((q) => q.id),
    );
  data.sheets.forEach((s, i) => (s.description += ` 수정${i}`));
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/catalog');
  await page.locator('input[type=file]').setInputFiles({
    name: '두자격.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await writeCatalogWorkbook(data),
  });
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
  const review = page.getByRole('dialog');
  await review.locator('.catalog-review-list label').nth(1).getByRole('checkbox').uncheck();
  await review.getByRole('button', { name: '선택 기준 초안 저장', exact: true }).click();
  await expect(page.locator('.catalog-nav-item')).toHaveCount(2);
  await expect(page.getByText('서버 저장 전 수정 내용이 있습니다.', { exact: true })).toBeVisible();
  await expect(
    review.getByRole('button', { name: '선택 기준 초안 저장', exact: true }),
  ).toBeEnabled();
  await review.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(review).not.toBeVisible();
  await page.getByRole('button', { name: '검토 후 사용 등록', exact: true }).click();
  await page
    .getByRole('dialog')
    .locator('.catalog-review-list label')
    .nth(1)
    .getByRole('checkbox')
    .uncheck();
  await page.getByRole('button', { name: '선택 기준 사용 등록', exact: true }).click();
  expect(
    backend.store
      .snapshot()
      .qualifications.filter((q) => q.entityId === state.qualifications[1]!.entityId),
  ).toHaveLength(1);
  await expect(page.getByText('이 브라우저에 보관됨', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '이어서 작성', exact: true }).click();
  await expect(page.locator('.catalog-nav-item')).toHaveCount(2);
  await page.locator('.catalog-nav-item').nth(1).click();
  await page.getByRole('button', { name: '기본정보 수정', exact: true }).click();
  await expect(page.getByLabel('자격 설명', { exact: true })).toHaveValue(
    data.sheets[1]!.description,
  );
});

test('브라우저 보관 실패를 알리고 저장 충돌에서도 입력과 작업 파일 기능을 유지한다', async ({
  page,
  backend,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new Error('blocked');
      },
    });
  });
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/catalog');
  await page.getByTestId('catalog-qualification-demo-qualification').getByRole('button').click();
  await page.getByLabel('과정명', { exact: true }).fill('보존할 수정');
  await expect(
    page.getByText('브라우저에 보관하지 못했습니다. 작업 파일을 다운로드해 주세요.', {
      exact: true,
    }),
  ).toBeVisible();
  await backend.store.transact(
    'admin-1',
    'concurrent-catalog',
    'concurrent-catalog',
    () => {},
    (s) => {
      s.qualifications.find((q) => q.id === 'demo-qualification')!.revision++;
      return {};
    },
  );
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '선택 기준 초안 저장', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('원본이 변경');
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByLabel('과정명', { exact: true })).toHaveValue('보존할 수정');
  await expect(
    page.getByRole('button', { name: '작업 파일 다운로드', exact: true }).last(),
  ).toBeEnabled();
});

test('새 자격의 준비 상태·한글 입력과 단일 디자인·좁은 화면', async ({ page }, testInfo) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/catalog');
  await page.getByRole('button', { name: '새 자격 만들기', exact: true }).click();
  await page.getByLabel('자격명', { exact: true }).fill('신규 설비 자격');
  await page.getByLabel('인증기간', { exact: true }).selectOption('three-years');
  await page.getByRole('button', { name: '과정 추가', exact: true }).click();
  await page.getByLabel('과정명', { exact: true }).fill('설비 구성 확인');
  await page.getByLabel('객관식 · 지식 평가', { exact: true }).check();
  await page.getByLabel('실기 · 상황 대응 평가', { exact: true }).check();
  for (const theme of ['single']) {
    await expect(page.getByLabel('화면 테마')).toHaveCount(0);
    for (const width of [1920, 1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await expect(page.getByRole('button', { name: '초안 저장', exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`friendly-${theme}-${width}.png`) });
    }
  }
  await page.getByRole('button', { name: '검토 후 사용 등록', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '선택 기준 사용 등록', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('등록 전');
});
