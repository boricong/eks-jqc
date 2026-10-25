import { answerConfirmation } from './fixtures';
import { test, expect, actor } from './fixtures';
import type { JsonStore } from '../../server/src/storage';
import { nodeFor } from '../../server/src/organizations';
import { configureTestPolicies } from '../../server/tests/policy-helpers';

const own = 'org-photo-pyeongtaek-1';

async function members(store: JsonStore) {
  await store.transact(
    'operator-1',
    crypto.randomUUID(),
    'policy-members',
    () => {},
    (s) => {
      for (const id of ['learner-2', 'ft-1'])
        s.users.find((u) => u.id === id)!.organizationId = own;
      for (let i = 1; i <= 30; i++)
        s.users.push({
          id: `policy-member-${i}`,
          name: `후보 ${String(i).padStart(2, '0')}`,
          roles: ['learner'],
          organizationId: own,
          revision: 1,
        });
      return {};
    },
  );
}

test('조직 이름만 표시하는 좌우 설정·깊은 조직 탐색·모바일 접기와 네 화면 폭', async ({
  page,
  backend,
}) => {
  const longName = '설비 구성 및 공정 기준의 변경 대응 능력을 검증하는 상세 운영 조직';
  await configureTestPolicies(backend.store);
  await backend.store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    'long-policy-name',
    () => {},
    (doc) => {
      nodeFor(doc.roots, own)!.name = longName;
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/policies');
  const tree = page.getByRole('tree', { name: '설정 가능한 조직', includeHidden: true });
  await expect(tree).toBeVisible();
  await expect(page.getByText('관리할 조직을 먼저 선택한 뒤', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '다시 불러오기', exact: true })).toHaveCount(0);
  await expect(page.getByText('선택하지 않으면 필수 자격 없음', { exact: false })).toHaveCount(0);
  expect((await tree.innerText()).match(/Lv\d|직속|미설정|개 필수/)).toBeNull();
  const root = tree.locator('[data-id="org-photo"]');
  await root.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tree.locator('[data-id="org-photo-fmg"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tree.locator('[data-id="org-photo-fmg"]')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowLeft');
  await expect(root).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(tree.locator('[data-id="org-photo-fmg"]')).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('조직 검색').fill('존재하지 않는 조직');
  await expect(tree).toContainText('검색에 맞는 관리 가능 조직이 없습니다.');
  await page.getByLabel('조직 검색').fill('');
  await tree.locator(`[data-id="${own}"]`).click();
  await expect(page.locator('.policy-detail-stack > section > h2')).toHaveText(longName);
  await expect(
    page.getByRole('link', { name: '팀 자격 설정 · 등록·팀 적용', exact: true }),
  ).toBeVisible();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const panel = page.locator('.policy-tree-panel'),
      detail = page.locator('.policy-detail-stack');
    if (width >= 1024) {
      await expect(tree).toBeVisible();
      const left = (await panel.boundingBox())!,
        right = (await detail.boundingBox())!;
      expect(left.width).toBeGreaterThanOrEqual(240);
      expect(left.width).toBeLessThanOrEqual(300);
      expect(right.x - (left.x + left.width)).toBeGreaterThanOrEqual(23);
      expect((await tree.locator('[data-id="org-photo-pyeongtaek-2"]').boundingBox())!.height).toBe(
        28,
      );
      await expect(root).toHaveCSS('padding-top', '4px');
      await expect(root).toHaveCSS('padding-bottom', '4px');
      const row = tree.locator(`[data-id="${own}"]`);
      const rowBox = (await row.boundingBox())!,
        textBox = (await row.locator('.policy-tree-name').boundingBox())!;
      expect(textBox.y + textBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
    } else {
      const toggle = panel.getByRole('button', { name: /조직 선택 열기/ });
      await expect(toggle).toContainText(longName);
      await expect(toggle).toHaveCSS('border-radius', '0px');
      await expect(tree).toBeHidden();
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(tree).toBeVisible();
      const row = tree.locator(`[data-id="${own}"]`);
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const rowBox = (await row.boundingBox())!,
        textBox = (await row.locator('.policy-tree-name').boundingBox())!;
      expect(textBox.y + textBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
      await panel.getByRole('button', { name: /조직 선택 접기/ }).click();
      await expect(tree).toBeHidden();
    }
    await expect(tree.locator(`[data-id="${own}"]`)).toHaveCSS('font-size', '14px');
    const search = page.getByLabel('자격 검색', { exact: true }),
      searchLabel = page.locator('.policy-qualification-search > span'),
      list = page.locator('.policy-qualification-list');
    const searchBox = (await search.boundingBox())!,
      labelBox = (await searchLabel.boundingBox())!,
      listBox = (await list.boundingBox())!;
    expect(
      Math.abs(labelBox.y + labelBox.height / 2 - searchBox.y - searchBox.height / 2),
    ).toBeLessThan(1);
    expect(searchBox.x).toBeGreaterThan(labelBox.x + labelBox.width);
    expect(listBox.y - searchBox.y - searchBox.height).toBeGreaterThanOrEqual(12);
    await expect(list).toHaveCSS('border-top-width', '1px');
    await expect(list).toHaveCSS('border-color', 'rgb(227, 232, 238)');
    await expect(list.getByRole('checkbox').first()).toBeChecked();
    await expect(tree.locator(`[data-id="${own}"]`)).toHaveCSS('border-radius', '0px');
    await expect(tree.locator(`[data-id="${own}"]`)).toHaveCSS(
      'border-left-color',
      'rgb(83, 58, 253)',
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: test.info().outputPath(`policy-layout-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByLabel('자격 검색', { exact: true }).fill('검색 결과 없는 자격');
  await expect(page.locator('.policy-qualification-list')).toHaveText('검색 결과가 없습니다.');
  await page.getByLabel('자격 검색', { exact: true }).fill('');
  await expect(
    page.locator('.policy-qualification-list').getByRole('checkbox').first(),
  ).toBeChecked();
  await page.locator('.policy-tree-toggle').click();
  await tree.locator('[data-id="org-photo-pyeongtaek-2"]').click();
  await expect(tree).toBeHidden();
  await expect(page.locator('.policy-tree-toggle')).toBeFocused();
  await page.getByRole('button', { name: '세부 조직 관리자 펼치기', exact: true }).click();
  await expect(page.getByRole('region', { name: '세부 조직 관리자 지정' })).toContainText(
    '이 조직에 소속된 구성원이 없습니다',
  );
});

test('관리자 후보 검색·별도 선택 목록·저장 실패와 재조회·이동 취소·저장 중 조직 전환 차단', async ({
  page,
  backend,
}) => {
  await members(backend.store);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/policies');
  const tree = page.getByRole('tree');
  await tree.locator(`[data-id="${own}"]`).click();
  await page.getByRole('button', { name: '세부 조직 관리자 펼치기', exact: true }).click();
  const admins = page.getByRole('region', { name: '세부 조직 관리자 지정' });
  const selected = admins.getByRole('region', { name: '선택한 관리자', exact: true });
  const search = admins.getByLabel('구성원 검색');
  const save = admins.getByRole('button', { name: '관리자 지정 저장', exact: true });
  await expect(admins.getByRole('checkbox')).toHaveCount(32);
  await expect(admins.getByRole('checkbox', { name: '김민서', exact: true })).toHaveCount(0);
  await expect(selected).toContainText('선택한 관리자가 없습니다');
  expect(
    await admins
      .locator('.administrator-candidates')
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBeTruthy();
  await admins.getByRole('checkbox', { name: '정하린', exact: true }).check();
  await search.fill('박준호');
  await expect(admins.getByRole('checkbox')).toHaveCount(1);
  await expect(selected).toContainText('정하린');
  await admins.getByRole('checkbox', { name: '박준호', exact: true }).check();
  await search.fill('검색 결과 없음');
  await expect(admins).toContainText('검색에 맞는 구성원이 없습니다');
  await expect(selected).toContainText('선택한 관리자 2명');
  await selected.getByRole('button', { name: '정하린 선택 해제' }).click();
  await expect(selected).toContainText('선택한 관리자 1명');
  await search.fill('');
  await expect(admins.getByRole('checkbox', { name: '정하린', exact: true })).not.toBeChecked();
  await admins.getByRole('checkbox', { name: '정하린', exact: true }).check();
  await expect(selected).toContainText('저장 전 변경');
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(selected).toContainText('선택한 관리자 2명');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    if (width < 1024)
      expect(
        (await selected.getByRole('button').first().boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: test.info().outputPath(`administrator-selection-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  expect(backend.store.snapshot().users.filter((u) => u.organizationAdministration)).toHaveLength(
    0,
  );
  const url = '**/api/organization-policies/*/administrators?*';
  await page.route(url, async (route) => {
    if (route.request().method() === 'PUT')
      await route.fulfill({ status: 503, json: { message: '시험 저장 실패' } });
    else await route.continue();
  });
  await save.click();
  await answerConfirmation(page, true);
  await expect(admins.getByRole('alert')).toContainText('시험 저장 실패');
  await expect(selected).toContainText('선택한 관리자 2명');
  await page.unroute(url);
  await save.click();
  await answerConfirmation(page, true);
  await expect(selected).toContainText('저장된 지정');
  await page.reload();
  await page.getByRole('treeitem', { name: 'RE A조', exact: true }).click();
  await page.getByRole('button', { name: '세부 조직 관리자 펼치기', exact: true }).click();
  await expect(selected).toContainText('선택한 관리자 2명');
  await expect(admins.getByRole('checkbox', { name: '정하린', exact: true })).toBeChecked();
  await admins.getByRole('checkbox', { name: '박준호', exact: true }).uncheck();
  await tree.locator('[data-id="org-photo-pyeongtaek-2"]').click();
  await answerConfirmation(page, false);
  await expect(tree.locator(`[data-id="${own}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(selected).toContainText('선택한 관리자 1명');
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saving = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(url, async (route) => {
    if (route.request().method() === 'PUT') {
      started();
      await gate;
    }
    await route.continue();
  });
  await save.click();
  await answerConfirmation(page, true);
  await saving;
  await expect(tree.locator('[data-id="org-photo-pyeongtaek-2"]')).toBeDisabled();
  await expect(page.getByRole('button', { name: '다시 불러오기', exact: true })).toHaveCount(0);
  release();
  await expect(save).toBeDisabled();
  await expect(selected).toContainText('저장된 지정');
  await page.unroute(url);
  await admins.getByRole('checkbox', { name: '박준호', exact: true }).check();
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'candidate-move',
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'ft-1')!.organizationId = 'org-photo-pyeongtaek-2';
      return {};
    },
  );
  await save.click();
  await answerConfirmation(page, true);
  await expect(admins.getByRole('alert')).toContainText('다시 불러온 뒤');
  await expect(selected).toContainText('박준호');
  await expect(selected).toContainText('선택한 관리자 2명');
  await admins.getByRole('button', { name: '지정 현황 새로고침' }).click();
  await answerConfirmation(page, true);
  await expect(admins.getByRole('checkbox', { name: '박준호', exact: true })).toHaveCount(0);
  await expect(selected).toContainText('선택한 관리자 1명');
});
