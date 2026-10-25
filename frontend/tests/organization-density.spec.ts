import { readFile, writeFile } from 'node:fs/promises';
import { organizationEntries, type OrganizationNode } from '@eks/contracts';
import { actor, expect, test } from './fixtures';

test('182개 조직의 조밀한 행·독립 스크롤·검색 오른쪽/테두리·네 화면 폭', async ({
  page,
  backend,
}, info) => {
  await backend.store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    'dense-tree-fixture',
    () => {},
    (doc) => {
      for (let group = 0; group < 5; group++)
        doc.roots[0]!.children.push({
          id: `dense-${group}`,
          name: `확장 조직 ${group}`,
          active: true,
          children: Array.from({ length: 27 }, (_, index) => ({
            id: `dense-${group}-${index}`,
            name:
              index === 26
                ? `긴조직명${'공백없는조직명'.repeat(20)}`
                : `세부 조직 ${group}-${index}`,
            active: index !== 25,
            children: [],
          })),
        });
      let nodes = doc.roots[0]!.children;
      for (let level = 0; level < 7; level++) {
        const node: OrganizationNode = {
          id: `deep-${level}`,
          name: `깊은 조직 ${level}`,
          active: true,
          children: [],
        };
        nodes.push(node);
        nodes = node.children;
      }
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/organizations');
  const before = await readFile(backend.store.organizations.file, 'utf8');
  const count = organizationEntries(backend.store.organizations.snapshot()).length;
  expect(count).toBe(182);
  await expect(page.locator('.tree-node')).toHaveCount(
    backend.store.organizations.snapshot().roots.length,
  );
  await page.getByRole('button', { name: '모두 펼치기', exact: true }).click();
  await expect(page.locator('.tree-node')).toHaveCount(count);
  const metrics = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      scrollTo(0, 0);
      document.querySelector('.organization-nodes')!.scrollTop = 0;
    });
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: '모두 접기', exact: true }).focus();
    const values = await page.locator('.organization-tree').evaluate((panel) => {
      const list = panel.querySelector('.organization-nodes')!,
        row = [...panel.querySelectorAll('.tree-node')].find((entry) =>
          entry.textContent?.includes('확장 조직 0'),
        )!;
      const tools = panel.querySelector('.organization-tree-tools')!.getBoundingClientRect();
      const search = panel.querySelector('.organization-search')!.getBoundingClientRect();
      const heading = document.querySelector('.organization-heading')!.getBoundingClientRect();
      const add = document
        .querySelector('.organization-heading > .button')!
        .getBoundingClientRect();
      const css = getComputedStyle(panel),
        button = getComputedStyle(panel.querySelector('button:focus-visible')!);
      const rgb = (value: string) =>
        value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      const luminance = (color: string) =>
        rgb(color)
          .map((x) => {
            x /= 255;
            return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i]!, 0);
      const ratio = (a: string, b: string) => {
        const x = luminance(a),
          y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      return {
        panelBorder: css.borderTopWidth,
        panelBackground: css.backgroundColor,
        row: row.getBoundingClientRect().height,
        font: getComputedStyle(row).fontSize,
        listHeight: list.clientHeight,
        listScroll: list.scrollHeight,
        overflow: getComputedStyle(list).overflowY,
        search: { x: search.x, y: search.y },
        tools: { x: tools.x, y: tools.y, right: tools.right },
        headingRight: heading.right,
        addRight: add.right,
        focus: ratio(button.outlineColor, css.backgroundColor),
        text: ratio(getComputedStyle(row).color, css.backgroundColor),
        pageWidth: document.documentElement.scrollWidth,
      };
    });
    expect(values.panelBorder).toBe('1px');
    expect(values.panelBackground).toBe('rgb(255, 255, 255)');
    expect(values.font).toBe('14px');
    expect(values.row).toBe(width <= 768 ? 44 : 32);
    expect(values.pageWidth).toBeLessThanOrEqual(width);
    expect(Math.abs(values.headingRight - values.addRight)).toBeLessThan(1);
    expect(values.focus).toBeGreaterThanOrEqual(3);
    expect(values.text).toBeGreaterThanOrEqual(4.5);
    if (width > 768) {
      expect(values.listHeight).toBeLessThanOrEqual(640);
      expect(values.listScroll).toBeGreaterThan(values.listHeight * 5);
      expect(values.overflow).toBe('auto');
      expect(Math.abs(values.tools.y - values.search.y)).toBeLessThan(2);
      expect(values.search.x).toBeGreaterThan(values.tools.right);
      await page.locator('.organization-nodes').evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect(page.locator('.tree-node').last()).toBeInViewport();
      await page.locator('.organization-nodes').evaluate((el) => (el.scrollTop = 0));
    } else {
      expect(values.overflow).toBe('visible');
      expect(values.listHeight).toBeGreaterThan(640);
      for (const button of await page
        .locator('.tree-toggle, .organization-tree-tools > button')
        .all())
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    metrics.push({ width, ...values });
    await page.screenshot({
      path: info.outputPath(`organization-density-${width}.png`),
      fullPage: width > 768,
    });
  }
  await page.getByLabel('조직 검색').fill('깊은 조직 6');
  await page.locator('.tree-node').filter({ hasText: '깊은 조직 6' }).click();
  await expect(page.locator('.organization-path')).toContainText('깊은 조직 0');
  await page.getByRole('button', { name: '모두 접기', exact: true }).click();
  await page.getByRole('button', { name: '선택 조직으로 이동', exact: true }).click();
  await expect(page.getByLabel('조직 검색')).toHaveValue('');
  await expect(page.locator('.tree-node.selected')).toBeInViewport();
  expect(await readFile(backend.store.organizations.file, 'utf8')).toBe(before);
  await writeFile(
    info.outputPath('organization-density-metrics.json'),
    JSON.stringify(metrics, null, 2),
  );
});

test('저장 실패/충돌 입력 보존·재시도·재조회는 저장한 조상만 펼침', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/organizations');
  await page.getByLabel('조직 검색').fill('RE A조');
  await page
    .locator('.tree-node')
    .filter({ hasText: /RE A조$/ })
    .click();
  await page.getByLabel('조직명', { exact: true }).fill('저장 검증 조직');
  let fail = true;
  await page.route('**/api/system/organizations/*', async (route) => {
    if (fail && route.request().method() === 'PATCH')
      await route.fulfill({ status: 409, json: { message: '다른 창에서 변경되었습니다.' } });
    else await route.continue();
  });
  await page.getByRole('button', { name: '조직 저장', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('다른 창');
  await expect(page.getByLabel('조직명', { exact: true })).toHaveValue('저장 검증 조직');
  fail = false;
  await page.getByRole('button', { name: '조직 저장', exact: true }).click();
  await expect(page.locator('.tree-node.selected')).toContainText('저장 검증 조직');
  await expect(page.getByLabel('조직 검색')).toHaveValue('');
  // 다른 Lv1은 계속 접힌 채로 남고 선택 조직까지의 경로만 열린다.
  const other = backend.store.organizations.snapshot().roots[1]!;
  if (other.children.length)
    await expect(
      page.getByRole('button', { name: `${other.name} 펼치기`, exact: true }),
    ).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: '다시 불러오기', exact: true })).toHaveCount(0);
});

test('계정 전환 후 도착한 조직 응답은 무시하고 재진입은 Lv1부터 시작', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/organizations');
  await page.getByRole('button', { name: '모두 펼치기', exact: true }).click();
  let waiting = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hold = true;
  await page.route('**/api/system/organizations', async (route) => {
    const response = await route.fetch();
    if (hold) {
      hold = false;
      const doc = await response.json();
      doc.entries[0].name = '이전 계정의 늦은 조직 응답';
      waiting = true;
      await gate;
      await route.fulfill({ response, json: doc });
    } else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect.poll(() => waiting).toBe(true);
  await actor(page, 'learner-1');
  release();
  await expect(page.getByRole('heading', { name: '김민서 님', exact: true })).toBeVisible();
  await expect(page.getByText('이전 계정의 늦은 조직 응답', { exact: true })).toHaveCount(0);
  await actor(page, 'operator-1');
  await page.goto('/system/organizations');
  await expect(page.locator('.tree-node')).toHaveCount(
    backend.store.organizations.snapshot().roots.length,
  );
  await expect(page.getByLabel('조직명', { exact: true })).toHaveValue(
    backend.store.organizations.snapshot().roots[0]!.name,
  );
});
