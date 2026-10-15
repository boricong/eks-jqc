import type { Page } from '@playwright/test';
import { test, expect, actor } from './fixtures';
import path from 'node:path';
const imagePath = (name: string) => test.info().outputPath(`${name}-1920x900.png`);
async function navigate(page: Page, href: string) {
  await page.evaluate((href) => {
    const a = document.createElement('a');
    a.href = href;
    a.id = 'test-navigation';
    document.body.appendChild(a);
  }, href);
  await page.locator('#test-navigation').evaluate((el) => {
    history.pushState({}, '', (el as HTMLAnchorElement).href);
    window.dispatchEvent(new PopStateEvent('popstate'));
    el.remove();
  });
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(10, 10);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: imagePath(name), fullPage: false });
}
async function noOverflow(page: Page) {
  const audit = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 15)
      .map((el) => ({
        tag: el.tagName,
        cls: el.className,
        right: el.getBoundingClientRect().right,
      })),
  }));
  expect(audit.scroll, JSON.stringify(audit)).toBeLessThanOrEqual(audit.width);
}

test('1920×900 화면 구성과 독립 메뉴', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await actor(page, 'learner-1');
  await expect(page.getByRole('heading', { name: '김민서 님' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '공지사항' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(900);
  await noOverflow(page);
  await screenshot(page, 'home');
  await page.getByRole('button', { name: '검증용 인증 안내' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: '이어서 진행' }).click();
  await expect(page.locator('.course-workspace')).toContainText('통과 유지');
  await expect(page.getByRole('link', { name: '다시 요청' })).toBeVisible();
  await screenshot(page, 'qualification');
  await page.getByRole('button', { name: /02 기록 작성/ }).click();
  await page.getByRole('link', { name: '응시하기', exact: true }).click();
  await screenshot(page, 'objective');
  await actor(page, 'admin-1');
  await page.getByRole('link', { name: '관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '자격 관리', exact: true })).toBeVisible();
  await screenshot(page, 'admin');
  await page.getByRole('link', { name: '과정 관리', exact: true }).click();
  await screenshot(page, 'admin-courses');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('부분 통과 유지, 미통과 재응시, FT 평가와 자동 인증', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.getByRole('link', { name: '이어서 진행' }).click();
  await page.getByRole('link', { name: '다시 요청' }).click();
  await page.getByRole('button', { name: '다시 요청', exact: true }).click();
  await expect(page.getByText('박준호 FT 평가 대기')).toBeVisible();
  await page.getByRole('link', { name: '다른 과정 보기' }).click();
  await expect(page.locator('.course-workspace h2')).toHaveText('기록 작성');
  await page.getByRole('link', { name: '응시하기', exact: true }).click();
  await page.getByRole('button', { name: '답안 확인', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('미응답');
  await page.getByLabel('파일 색상', { exact: true }).check();
  await page.getByLabel('글꼴 종류', { exact: true }).check();
  await page.getByRole('button', { name: '답안 확인', exact: true }).click();
  await page.getByRole('button', { name: '제출', exact: true }).click();
  await expect(page.getByRole('heading', { name: '다시 평가할 수 있습니다.' })).toBeVisible();
  await page.getByRole('button', { name: '다시 응시', exact: true }).click();
  await page.getByLabel('대상 이름과 확인한 값', { exact: true }).check();
  await page.getByLabel('항목의 누락 여부', { exact: true }).check();
  await page.getByRole('button', { name: '답안 확인', exact: true }).click();
  await page.getByRole('button', { name: '제출', exact: true }).click();
  await expect(page.getByRole('heading', { name: '평가를 통과했습니다.' })).toBeVisible();
  await page.getByRole('link', { name: '이어서 진행', exact: true }).click();
  await page.getByRole('link', { name: '평가 요청', exact: true }).click();
  await page.getByRole('button', { name: '평가 요청', exact: true }).click();
  await actor(page, 'ft-1');
  await page.getByRole('link', { name: 'FT 평가', exact: true }).click();
  await expect(page.getByRole('link', { name: '평가하기' })).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('link', { name: '평가하기' }).first().click();
    await page.getByRole('button', { name: '판정 확인', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('판정과 근거');
    for (const item of await page.locator('.ft-item').all()) {
      await item.getByLabel('통과', { exact: true }).check();
      await item.getByLabel('판정 근거').fill('항목의 판정 기준에 따라 독립 수행을 확인함.');
    }
    if (i === 0) await screenshot(page, 'ft-evaluation');
    await page.getByRole('button', { name: '판정 확인', exact: true }).click();
    await page.getByRole('button', { name: '평가 확정', exact: true }).click();
    await expect(page.getByRole('heading', { name: '과정을 수료했습니다.' })).toBeVisible();
    await page.getByRole('link', { name: '평가 목록', exact: true }).click();
  }
  await actor(page, 'learner-1');
  await page.getByRole('link', { name: '검증용 인증' }).click();
  await page.locator('.qualification-row').click();
  await expect(page.getByRole('heading', { name: '검증용 인증' })).toBeVisible();
  await expect(page.locator('.evidence-course')).toHaveCount(2);
  await page.locator('.evidence-course').first().locator('summary').click();
  await expect(page.locator('.evidence-course').first()).toContainText('1회');
  await expect(page.locator('.evidence-course').first()).toContainText('2회');
  await screenshot(page, 'certification');
});

test('관리 초안 검증, 배정, 공지, 제외', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  await actor(page, 'admin-1');
  await page.getByRole('link', { name: '관리', exact: true }).click();
  await page.getByRole('link', { name: 'Recipe Management', exact: true }).click();
  await page.getByRole('button', { name: '사용 등록' }).click();
  await expect(page.getByRole('alert')).toContainText('필수 과정을 먼저');
  await page.getByRole('link', { name: '과정 관리', exact: true }).click();
  await page.getByRole('link', { name: 'Recipe 편집', exact: true }).click();
  await page.getByRole('button', { name: '사용 등록' }).click();
  await expect(page.getByRole('alert')).toContainText('합격 기준');
  await page.getByRole('link', { name: '자격 배정', exact: true }).click();
  await page.getByRole('button', { name: '자격 배정' }).click();
  await page.getByRole('button', { name: '배정', exact: true }).click();
  await expect(page.locator('tbody')).toContainText('정하린');
  await page.getByRole('link', { name: '공지 관리', exact: true }).click();
  await page.getByRole('button', { name: '공지 등록' }).click();
  await page.getByLabel('제목', { exact: true }).fill('화면 검토 공지');
  await page.getByLabel('내용', { exact: true }).fill('테스트 공지 내용');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await actor(page, 'learner-2');
  await expect(page.getByRole('button', { name: '화면 검토 공지' })).toBeVisible();
  await page.getByRole('link', { name: '이어서 진행' }).click();
  await expect(page.getByRole('heading', { name: '평가 흐름 체험' })).toBeVisible();
  await actor(page, 'admin-1');
  await page.getByRole('link', { name: '관리', exact: true }).click();
  await page.getByRole('link', { name: '자격 배정', exact: true }).click();
  const row = page.locator('tbody tr').filter({ hasText: '정하린' });
  await row.locator('summary').click();
  await row.getByRole('button', { name: '검증 제외' }).click();
  await page.getByLabel('변경 사유').fill('중복 검증 시안');
  await page.getByRole('dialog').getByRole('button', { name: '검증 제외' }).click();
  await expect(row).toContainText('검증 제외');
  await actor(page, 'learner-2');
  await expect(page.getByText('진행 중인 자격이 없습니다.')).toBeVisible();
});

test('작은 화면과 키보드 접근', async ({ page }) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    await expect(page.getByRole('heading', { name: '공지사항' })).toBeVisible();
  }
  await page.getByRole('link', { name: '이어서 진행' }).click();
  await noOverflow(page);
  await page.getByRole('link', { name: '다시 요청' }).click();
  await noOverflow(page);
  await page.getByRole('button', { name: '학습자료', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await actor(page, 'admin-1');
  await page.getByRole('button', { name: '메뉴', exact: true }).click();
  await page.getByRole('link', { name: '관리', exact: true }).click();
  await noOverflow(page);
  await page.setViewportSize({ width: 1920, height: 900 });
  await actor(page, 'learner-1');
  await navigate(page, '/admin/qualifications');
  await expect(page.getByRole('heading', { name: '김민서 님' })).toBeVisible();
});
