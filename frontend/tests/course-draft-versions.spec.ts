import { test, expect, actor, answerConfirmation } from './fixtures';
import { CourseContentSchema } from '@eks/contracts';
import { saveCommonCourse } from '../../server/src/common-courses';

test('공통 목록의 초안 버전·상태 배지와 최초 준비 완료·문항 메이저를 네 폭에서 표시한다', async ({
  page,
  backend,
}, info) => {
  const complete = CourseContentSchema.parse(backend.store.snapshot().courses[0]);
  let id = '';
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'draft-version-fixture',
    () => {},
    (s) => {
      id = saveCommonCourse(s, 'operator-1', undefined, {
        ...complete,
        title: '초안 버전 시험',
        questions: [],
      }).id;
      return {};
    },
  );
  await backend.restart();
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/common-courses');
  const row = page.getByRole('row').filter({ hasText: '초안 버전 시험' });
  await expect(page.getByRole('columnheader', { name: '유형', exact: true })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: '버전', exact: true })).toBeVisible();
  await expect(row).toContainText('v0.1');
  await expect(row.locator('.status-active')).toHaveText('운영 중');
  await expect(row.locator('.status-catalogDraft')).toHaveText('보완 필요');
  await row.getByRole('button', { name: '내용 보기·수정', exact: true }).click();
  await page.getByLabel('인증Set명', { exact: true }).fill('초안 버전 시험 개정');
  await page.getByRole('button', { name: '공통인증Set 저장', exact: true }).click();
  await expect(page.getByTestId('app-confirmation')).toContainText('v0.1 → v0.2');
  await expect(page.getByTestId('app-confirmation')).toContainText('보완 필요 단계');
  await answerConfirmation(page, true);
  await expect(row).toContainText('v0.2');
  const update = async (content: unknown) => {
    const tab = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
    const headers = {
      'X-Session-Tab': tab!,
      'X-Eks-Release-Contract': '1',
      'Idempotency-Key': crypto.randomUUID(),
    };
    const current = backend.store.snapshot().commonCourses.find((c) => c.id === id)!;
    const body = { ...(content as object), revision: current.revision };
    const preview = await page.request.post('/api/system/common-courses/save-preview', {
      headers,
      data: { id, content: body },
    });
    expect(preview.ok()).toBe(true);
    const review = await preview.json();
    const result = await page.request.put(`/api/system/common-courses/${id}`, {
      headers,
      data: {
        ...body,
        review: {
          stateRevision: review.stateRevision,
          organizationRevision: review.organizationRevision,
        },
      },
    });
    expect(result.ok()).toBe(true);
    return result.json();
  };
  expect((await update({ ...complete, title: '초안 버전 시험 개정' })).releaseVersion).toEqual({
    major: 1,
    minor: 0,
  });
  await page.reload();
  await expect(row).toContainText('v1.0');
  await expect(row.locator('.status-complete')).toHaveText('준비 완료');
  const questions = structuredClone(complete.questions);
  questions[0]!.prompt += ' 문항 변경';
  expect(
    (await update({ ...complete, title: '초안 버전 시험 개정', questions })).releaseVersion,
  ).toEqual({ major: 2, minor: 0 });
  await page.reload();
  await expect(row).toContainText('v2.0');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(row.locator('.status-active')).toBeVisible();
    expect(
      await row.locator('.status-active').evaluate((el) => getComputedStyle(el).paddingLeft),
    ).toBe('8px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`common-versions-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await row.getByRole('button', { name: '운영 종료', exact: true }).click();
  await page.getByRole('dialog').getByLabel('변경 사유').fill('시험 운영 종료');
  await page.getByRole('dialog').getByRole('button', { name: '상태 변경', exact: true }).click();
  await page.getByLabel('운영 상태', { exact: true }).selectOption('all');
  await expect(row.locator('.status-retired')).toHaveText('운영 종료');
  await expect(row).toContainText('v2.0');
});
