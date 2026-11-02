import { test, actor, expect } from './fixtures';

const id = 'foundry-photo-certification-workflow';
const title = 'Foundry Photo 기술팀 자격 인증 워크플로우';

test('Photo 역할별 흐름·조직 상속·통합 시퀀스의 그림5개와 네 화면 폭·키보드·읽기 전용', async ({
  page,
  backend,
}, info) => {
  test.setTimeout(60000);
  await page.goto('/');
  await actor(page, 'operator-1');
  const state = backend.store.snapshot(),
    organizations = backend.store.organizations.snapshot();
  const writes: string[] = [],
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method()))
      writes.push(request.url());
  });
  await page.goto('/documents');
  await page.getByRole('searchbox', { name: '문서 검색' }).fill('Photo');
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.locator('.document-diagram-canvas svg')).toHaveCount(5, { timeout: 30000 });
  await expect(page.locator('.document-diagram-error')).toHaveCount(0);
  await expect(
    page.getByRole('img', { name: '시스템 운영자 공통 기준 준비', exact: true }),
  ).toHaveCount(1);
  const inheritance = page.getByRole('img', {
    name: 'Foundry Photo 조직 필요자격 상속 예시',
    exact: true,
  });
  await expect(inheritance).toHaveCount(1);
  await expect(inheritance).toContainText('RE A조');
  await expect(inheritance).toContainText('RE B조');
  await expect(
    page.getByRole('img', {
      name: 'Foundry Photo 기술팀 세 역할 통합 자격 인증 흐름',
      exact: true,
    }),
  ).toHaveCount(1);
  const body = page.getByRole('article', { name: '문서 본문' });
  await expect(body).toContainText(
    '팀 자격 풀에 등록했다고 모든 조직과 구성원의 필요자격이 되는 것은 아니다.',
  );
  await expect(body).toContainText('세부조직관리자는 팀 자격 풀 자체를 편집하지 않는다.');
  await expect(body).toContainText('세부조직관리자는 계획 요청을 발송하지 않는다.');
  await expect(body).toContainText(
    '이후 조직 설정 변경은 이미 발송한 요청이나 확정 계획을 자동으로 다시 쓰지 않는다.',
  );
  await expect(body).toContainText(
    '계획 요청에 여러 자격이 포함돼 있어도 인증은 자격별로 발급된다.',
  );
  await expect(body).toContainText('별도의 인증서 발급 신청이나 관리자 승인 버튼을 거치지 않는다.');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const canvas = page.getByRole('region', { name: '시스템 운영자 공통 기준 준비', exact: true });
    await canvas.focus();
    await expect(canvas).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => canvas.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await canvas.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: info.outputPath(`workflow-${width}.png`) });
    const inheritedCanvas = page.getByRole('region', {
      name: 'Foundry Photo 조직 필요자격 상속 예시',
      exact: true,
    });
    await inheritedCanvas.focus();
    await expect(inheritedCanvas).toBeFocused();
    if (width === 390) {
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => inheritedCanvas.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await inheritedCanvas.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await page.screenshot({ path: info.outputPath(`inheritance-${width}.png`) });
  }
  const source = page.locator('.document-diagram summary').first();
  await source.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.document-diagram details').first()).toHaveAttribute('open', '');
  await expect(page.locator('.document-diagram pre').first()).toContainText('flowchart TD');
  await page.reload();
  await expect(page.locator('.document-diagram-canvas svg')).toHaveCount(5);
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
  expect(backend.store.snapshot()).toEqual(state);
  expect(backend.store.organizations.snapshot()).toEqual(organizations);
});

test('다이어그램 문법·설정·클릭·HTML 오류는 원문 대체하며 나머지는 계속 표시한다', async ({
  page,
}) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.route(`**/api/system/documents/${id}`, async (route) => {
    const response = await route.fetch(),
      doc = await response.json();
    await route.fulfill({
      json: {
        ...doc,
        markdown: [
          '# ' + title,
          '```mermaid\nflowchart TD\nA["정상 흐름"] --> B["완료"]\n```',
          '```mermaid\nflowchart TD\nA[\n```',
          '```mermaid\n%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\nA-->B\n```',
          '```mermaid\nflowchart TD\nA-->B\nclick A "javascript:window.__workflowXss=true"\n```',
          '```mermaid\nflowchart TD\nA["<img src=x onerror=window.__workflowXss=true>"] --> B["안전한 텍스트"]\n```',
          '<script>window.__workflowXss=true</script>',
        ].join('\n\n'),
      },
    });
  });
  await page.goto(`/documents/${id}`);
  await expect(page.locator('.document-diagram')).toHaveCount(5);
  await expect(page.locator('.document-diagram-canvas[aria-busy]')).toHaveCount(0);
  await expect(page.locator('.document-diagram-canvas svg')).toHaveCount(2);
  await expect(page.locator('.document-diagram-error')).toHaveCount(3);
  await expect(page.locator('.document-diagram details[open]')).toHaveCount(3);
  await expect(
    page.locator(
      '.document-markdown script, .document-markdown iframe, .document-markdown [onerror], .document-diagram a, .document-diagram image, .document-diagram foreignObject',
    ),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__workflowXss)).toBeUndefined();
});

test('다이어그램 엔진을 불러오지 못해도 문서와 원문을 읽을 수 있다', async ({ page }) => {
  await page.route('**/*mermaid*', (route) => route.abort());
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto(`/documents/${id}`);
  await expect(page.locator('.document-diagram-error')).toHaveCount(5);
  await expect(page.locator('.document-diagram details[open]')).toHaveCount(5);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
});
