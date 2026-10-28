import { test, expect, actor } from './fixtures';
import { saveCriterion } from './catalog-helpers';

test('일괄 편집 메뉴·엑셀 조작을 제거하고 예전 주소는 조직·유형을 유지해 개별 설정으로 이동한다', async ({
  page,
  backend,
}, info) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await expect(
    page
      .getByRole('navigation', { name: '업무 바로가기' })
      .getByRole('link', { name: '팀 자격 설정', exact: true }),
  ).toBeVisible();
  const before = backend.store.snapshot();
  for (const type of ['auditee', 'auditor']) {
    await page.goto(`/admin/catalog?lv1OrganizationId=org-photo&type=${type}`);
    await expect(page).toHaveURL(
      type === 'auditor'
        ? /\/admin\/qualifications\?lv1OrganizationId=org-photo&type=auditor$/
        : /\/admin\/qualifications\?lv1OrganizationId=org-photo$/,
    );
    await expect(page.getByRole('heading', { name: '팀 자격 설정', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '기준 일괄 편집', exact: true })).toHaveCount(0);
    await expect(page.getByText('Excel 가져오기', { exact: true })).toHaveCount(0);
    await expect(page.locator('input[type=file]')).toHaveCount(0);
  }
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`retired-catalog-${width}.png`),
      fullPage: true,
    });
  }
  expect(backend.store.snapshot()).toEqual(before);
});
test('종료 이후에도 개별 인증Set 편집·보존 버전·저장 확인은 유지한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/courses/demo-course-1');
  await page.getByLabel('인증Set명', { exact: true }).fill('엑셀 없이 개별 수정');
  await saveCriterion(page);
  await expect(page).toHaveURL(/\/admin\/courses(?:\?|$)/);
  await expect(page.getByRole('link', { name: '엑셀 없이 개별 수정', exact: true })).toBeVisible();
  expect(backend.store.snapshot().courses.find((c) => c.id === 'demo-course-1')!.title).not.toBe(
    '엑셀 없이 개별 수정',
  );
});
test('예전 일괄 편집의 브라우저 초안 저장소는 자동 삭제하지 않는다', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('eks-catalog-recovery', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('works', { keyPath: 'id' });
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction('works', 'readwrite');
        tx.objectStore('works').put({
          id: 'preserved-old-draft',
          actorId: 'admin-1',
          lv1: 'org-photo',
          workbook: { legacy: true },
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.goto('/admin/catalog');
  await expect(page.getByRole('heading', { name: '팀 자격 설정', exact: true })).toBeVisible();
  const exists = await page.evaluate(
    async () =>
      new Promise<boolean>((resolve, reject) => {
        const r = indexedDB.open('eks-catalog-recovery', 1);
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction('works').objectStore('works').get('preserved-old-draft');
          q.onsuccess = () => {
            resolve(!!q.result);
            db.close();
          };
        };
      }),
  );
  expect(exists).toBe(true);
});
