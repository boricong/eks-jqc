import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { test as base, actor, expect } from './fixtures';

const reportId = 'iatf16949-competence-review';
const reportTitle = 'EKS의 IATF 16949 역량 증빙 적합성 검토와 개선안';
const example = `# Markdown 예제

## 같은 제목

**강조**와 *기울임*, ~~취소선~~, \`인라인 코드\`를 읽습니다.

> 원문을 인용합니다.

1. 첫 항목
2. 두 번째 항목

| 종류 | 기준 |
| --- | --- |
| 현장 OJT | 확인자와 결과 |

\`\`\`js
const code = '<script>window.__documentXss = true</script>';
${'long_code_'.repeat(80)}
\`\`\`

<script>window.__documentXss = true</script>
<iframe src="javascript:alert(1)"></iframe>
<img src=x onerror="window.__documentXss = true">
[위험 링크](javascript:alert(1))
[인코딩 위험](jav&#x61;script:alert(1))
[로컬 파일](/Users/local/secret.ts:2)
[미등록 문서](missing.md)
[외부 참고](https://example.invalid/reference)
![예제 이미지](https://example.invalid/figure.png)
[IATF 보고서](../report.md#1-결론)
[본문 이동](#같은-제목)

## 같은 제목

중복 제목도 이동할 수 있습니다.
`;

const test = base.extend({
  documentsRoot: async ({}, use: (root: string) => Promise<void>) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'eks-document-browser-'));
    await mkdir(path.join(root, 'guides'));
    const report = await readFile(
      fileURLToPath(new URL('../../docs/IATF16949_역량증빙_갭분석_2026-10-25.md', import.meta.url)),
      'utf8',
    );
    await writeFile(path.join(root, 'report.md'), report);
    await writeFile(path.join(root, 'guides', 'example.md'), example);
    await writeFile(
      path.join(root, 'document-catalog.json'),
      JSON.stringify([
        {
          id: reportId,
          title: reportTitle,
          description: '공통 IATF 역량 증빙 검토 보고서',
          updatedOn: '2026-10-25',
          sourcePath: 'report.md',
        },
        {
          id: 'example',
          title: 'Markdown 예제',
          description: '제목·표·코드·참고 링크 표시 예제',
          updatedOn: '2026-10-24',
          sourcePath: 'guides/example.md',
        },
      ]),
    );
    await use(root);
    await rm(root, { recursive: true, force: true });
  },
});

async function enter(page: Parameters<typeof actor>[0]) {
  await page.goto('/');
  await actor(page, 'operator-1');
}

test('공유 헤더/내부 메뉴·검색·실제 보고서·목차·뒤로/새로고침과 읽기 전용', async ({
  page,
  backend,
}) => {
  await enter(page);
  const before = backend.store.snapshot(),
    org = backend.store.organizations.snapshot();
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/') && !['GET', 'HEAD'].includes(r.method())) writes.push(r.url());
  });
  await page.locator('[data-submenu-toggle="system"]').click();
  await page
    .locator('[data-submenu-panel="system"]')
    .getByRole('link', { name: '문서 조회', exact: true })
    .click();
  await expect(page).toHaveURL(/\/system\/documents$/);
  await expect(
    page.locator('#system-navigation').getByRole('link', { name: '문서 조회' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.document-row')).toHaveCount(2);
  await page.getByRole('searchbox', { name: '문서 검색' }).fill('no result');
  await expect(page.getByText('검색 결과가 없습니다.', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '문서 검색' }).fill('IATF');
  await page.locator('.document-row').click();
  await expect(page.getByRole('heading', { level: 1, name: reportTitle })).toHaveCount(1);
  await expect(page.getByRole('article', { name: '문서 본문' })).toContainText('현장 역량 확인');
  await expect(page.locator('.document-markdown .document-table-scroll')).not.toHaveCount(0);
  await expect(page.locator('.document-reference-path').first()).toContainText('/Users/');
  await expect(
    page.locator('.document-markdown a[href^="/Users"], .document-markdown a[href^="/private"]'),
  ).toHaveCount(0);
  await expect(page.locator('.document-markdown a[target="_blank"]').first()).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  const contents = page.getByRole('button', { name: /목차/ });
  await contents.focus();
  await page.keyboard.press('Enter');
  await expect(contents).toHaveAttribute('aria-expanded', 'true');
  await page
    .getByRole('navigation', { name: '문서 목차' })
    .getByRole('link', { name: '1 결론', exact: true })
    .click();
  await expect(page.locator('#doc-1-결론')).toBeFocused();
  await page.reload();
  await expect(page.locator('#doc-1-결론')).toBeFocused();
  await page.getByRole('link', { name: '문서 목록', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '문서 검색' })).toHaveValue('IATF');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: reportTitle })).toBeVisible();
  expect(writes).toEqual([]);
  expect(backend.store.snapshot()).toEqual(before);
  expect(backend.store.organizations.snapshot()).toEqual(org);
});

test('Markdown 기본 문법·중복 제목·안전한 링크/이미지와 등록 문서 간 이동', async ({ page }) => {
  await page.route('https://example.invalid/**', (r) => r.abort());
  await enter(page);
  await page.goto('/system/documents/example');
  const body = page.getByRole('article', { name: '문서 본문' });
  await expect(body.locator('strong')).toHaveText('강조');
  await expect(body.locator('em')).toHaveText('기울임');
  await expect(body.locator('s')).toHaveText('취소선');
  await expect(body.locator('blockquote')).toContainText('원문을 인용');
  await expect(body.locator('pre')).toHaveAttribute('tabindex', '0');
  await expect(body.locator('script, iframe, [onerror], a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__documentXss)).toBeUndefined();
  await expect(body.locator('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(body.locator('.document-reference')).toContainText(['로컬 파일', '미등록 문서']);
  await expect(body.locator('#doc-같은-제목-2')).toHaveCount(1);
  await body.getByRole('link', { name: '본문 이동' }).click();
  await expect(body.locator('#doc-같은-제목')).toBeFocused();
  await body.getByRole('link', { name: 'IATF 보고서' }).click();
  await expect(page).toHaveURL(new RegExp(`/system/documents/${reportId}#1-`));
  await expect(page.locator('#doc-1-결론')).toBeFocused();
});

test('실패 재시도·없는 문서·빈 목록을 구분한다', async ({ page }) => {
  await enter(page);
  let failed = false;
  await page.route('**/api/system/documents', async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({ status: 503, json: { message: '문서 목록 시험 오류' } });
    } else await route.continue();
  });
  await page.goto('/system/documents');
  await expect(page.getByRole('alert')).toContainText('문서 목록 시험 오류');
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await expect(page.locator('.document-row')).toHaveCount(2);
  await page.goto('/system/documents/missing');
  await expect(page.getByRole('alert')).toContainText('문서를 찾을 수 없습니다.');
  await page.route('**/api/system/documents', (route) => route.fulfill({ json: { items: [] } }));
  await page.getByRole('link', { name: '문서 목록', exact: true }).click();
  await expect(page.getByText('등록된 문서가 없습니다.', { exact: true })).toBeVisible();
});

test('문서 응답 전에 계정을 바꾸면 이전 본문이 표시되지 않고 다른 역할의 직접 진입도 차단한다', async ({
  page,
}) => {
  await enter(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const request = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(`**/api/system/documents/${reportId}`, async (route) => {
    const response = await route.fetch();
    requested();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.goto(`/system/documents/${reportId}`);
  await request;
  await actor(page, 'learner-1');
  release();
  await expect(page.locator('.document-markdown')).toHaveCount(0);
  await expect(page.locator('[data-submenu-toggle="system"]')).toHaveCount(0);
  await page.goto(`/system/documents/${reportId}`);
  await expect(page).toHaveURL(/\/$/);
  await actor(page, 'admin-1');
  await page.goto('/system/documents');
  await expect(page).toHaveURL(/\/$/);
});

test('권한 회수 후 전역 갱신은 본문을 제거한다', async ({ page, backend }) => {
  await enter(page);
  await page.goto(`/system/documents/${reportId}`);
  await expect(page.locator('.document-markdown')).toBeVisible();
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'revoke-documents-role',
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'admin-1')!.roles.push('system_operator');
      s.users.find((u) => u.id === 'operator-1')!.roles = ['learner'];
      return {};
    },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.document-markdown')).toHaveCount(0);
});

test('4폭의 실제 보고서·표/코드 내부 스크롤·목차 초점·타이포그래피', async ({ page }, testInfo) => {
  await enter(page);
  const metrics = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/system/documents');
    await expect(page.locator('.document-row')).toHaveCount(2);
    await page.screenshot({
      path: testInfo.outputPath(`documents-list-${width}.png`),
      fullPage: true,
    });
    await page.locator('.document-row').first().click();
    await expect(page.locator('.document-markdown')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const measured = await page.locator('.document-markdown').evaluate((el) => ({
      font: getComputedStyle(el).fontSize,
      leading: getComputedStyle(el).lineHeight,
      family: getComputedStyle(el).fontFamily,
      width: el.getBoundingClientRect().width,
    }));
    expect(measured.font).toBe('15px');
    expect(measured.leading).toBe('26.25px');
    expect(measured.family).toContain('Pretendard');
    expect(measured.width).toBeLessThanOrEqual(1120);
    metrics.push({ viewportWidth: width, ...measured });
    const contrast = await page.evaluate(() => {
      const luminance = (color: string) => {
        const parts = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
        return parts[0]! * 0.2126 + parts[1]! * 0.7152 + parts[2]! * 0.0722;
      };
      const ratio = (a: string, b: string) => {
        const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
        return (values[0]! + 0.05) / (values[1]! + 0.05);
      };
      const surface = getComputedStyle(document.documentElement).backgroundColor;
      const body = getComputedStyle(document.querySelector('.document-markdown')!);
      const meta = getComputedStyle(document.querySelector('.document-meta')!);
      const link = getComputedStyle(document.querySelector('.document-markdown a')!);
      const th = getComputedStyle(document.querySelector('.document-markdown th')!);
      return {
        body: ratio(body.color, surface),
        meta: ratio(meta.color, surface),
        link: ratio(link.color, surface),
        table: ratio(th.color, th.backgroundColor),
      };
    });
    for (const ratio of Object.values(contrast)) expect(ratio).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: testInfo.outputPath(`documents-report-${width}.png`),
      fullPage: true,
    });
    await page.screenshot({ path: testInfo.outputPath(`documents-report-top-${width}.png`) });
    const toggle = page.getByRole('button', { name: /목차/ });
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Tab');
    await toggle.focus();
    await expect(toggle).toBeFocused();
    const focus = await toggle.evaluate((el) => {
      const style = getComputedStyle(el),
        parent = getComputedStyle(el.parentElement!);
      return {
        outline: style.outlineColor,
        width: style.outlineWidth,
        background: parent.backgroundColor,
      };
    });
    expect(focus.width).toBe('2px');
    expect(focus.outline).toBe('rgb(83, 58, 253)');
    expect(focus.background).toBe('rgb(246, 249, 252)');
    metrics.push({ viewportWidth: width, contrast, focus });
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({ path: testInfo.outputPath(`documents-contents-${width}.png`) });
    await page.route('https://example.invalid/**', (r) => r.abort());
    await page.goto('/system/documents/example');
    await expect(page.locator('.document-markdown pre')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page
        .locator('.document-markdown pre')
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);
    if (width < 640)
      expect(
        await page
          .locator('.document-table-scroll')
          .evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`documents-example-${width}.png`),
      fullPage: true,
    });
  }
  const metricsFile = testInfo.outputPath('document-layout.json');
  await writeFile(metricsFile, JSON.stringify(metrics, null, 2));
  await testInfo.attach('document-layout', { path: metricsFile, contentType: 'application/json' });
});
