import { createPoolQualification as createAuditorQualification } from '../../server/tests/auditor-fixture';
import { test, expect, actor, answerConfirmation } from './fixtures';
import { saveAuditorProgram } from '../../server/src/auditor-program';
import { userView } from '../../server/src/organizations';
import { nodeFor } from '../../server/src/organizations';

async function setupMembers(backend: any) {
  await backend.store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (doc: any) => {
      doc.roots[0].children.push({
        id: 'ui-l2',
        name: '시험2조직',
        active: true,
        children: [
          {
            id: 'ui-l3',
            name: '시험3조직',
            active: true,
            children: [
              {
                id: 'ui-l4',
                name: '시험4조직',
                active: true,
                children: [{ id: 'ui-l5', name: '시험5조직', active: true, children: [] }],
              },
            ],
          },
        ],
      });
      return {};
    },
  );
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s: any) => {
      s.users.find((u: any) => u.id === 'learner-2').organizationId = 'ui-l5';
      s.users.push({
        id: 'outside-ui',
        name: '다른 팀 비공개',
        organizationId: 'org-etch',
        roles: ['learner'],
        revision: 1,
      });
      return {};
    },
  );
}

test('긴 조직 트리의 현재 소속·내부 스크롤·검색·접기·키보드 선택을 네 폭에서 확인한다', async ({
  page,
  backend,
}, info) => {
  await setupMembers(backend);
  await backend.store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    'long-tree',
    () => {},
    (doc) => {
      const root = doc.roots[0]!;
      root.children.splice(
        root.children.length - 1,
        0,
        ...Array.from({ length: 60 }, (_, i) => ({
          id: `tree-org-${i}`,
          name: i === 59 ? '긴 조직 이름 '.repeat(15) : `추가 조직 ${i}`,
          active: true,
          children: [],
        })),
      );
      root.children.push({
        id: 'tree-disabled',
        name: '사용 중지 부서',
        active: false,
        children: [],
      });
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '정하린 수정', exact: true }).click();
  const dialog = page.getByRole('dialog'),
    tree = dialog.getByRole('tree', { name: '변경할 소속 조직' });
  const row = (id: string) => tree.locator(`[data-id="${id}"]`);
  await expect(row('ui-l5')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => tree.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const position = await row('ui-l5').evaluate((el) => {
    const row = el.getBoundingClientRect(),
      container = el.closest('[role=tree]')!.getBoundingClientRect();
    return row.top >= container.top - 1 && row.bottom <= container.bottom + 1;
  });
  expect(position).toBe(true);
  await expect(dialog.locator('.organization-tree-selection')).toContainText(
    '시험2조직 › 시험3조직 › 시험4조직 › 시험5조직',
  );
  const state = backend.store.snapshot();
  const search = dialog.getByLabel('조직 검색');
  await search.fill('긴 조직 이름');
  await expect(tree.getByRole('treeitem')).toHaveCount(2);
  await search.press('Enter');
  await expect(dialog).toBeVisible();
  await search.clear();
  await search.fill('현장운영');
  await row('org-photo-pyeongtaek-5').click();
  await expect(dialog.locator('.organization-tree-selection')).toContainText('평택 › 현장운영');
  await row('org-photo-hwaseong-operations').click();
  await expect(dialog.locator('.organization-tree-selection')).toContainText('화성 › 현장운영');
  await search.clear();
  await row('ui-l2').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(row('ui-l5')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(row('ui-l5')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(row('ui-l3')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(row('ui-l3')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(row('tree-disabled')).toBeFocused();
  await expect(row('tree-disabled')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Enter');
  await expect(row('ui-l3')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(row('org-photo')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row('org-photo')).toHaveAttribute('aria-selected', 'true');
  expect(backend.store.snapshot()).toEqual(state);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(tree).toBeVisible();
    expect(await tree.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(
      width <= 640 ? 240 : 315,
    );
    expect(await tree.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await tree.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
    await search.fill('긴 조직 이름');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`team-tree-${width}.png`), fullPage: true });
    await search.clear();
  }
  await page.setViewportSize({ width: 768, height: 500 });
  expect(await tree.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(175);
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await answerConfirmation(page, true);
  expect(backend.store.snapshot()).toEqual(state);
});

test('비활성 현재 소속 유지·실제 이동 시 관리자 지정 해제와 충돌 후 무효 조직 재선택', async ({
  page,
  backend,
}) => {
  await setupMembers(backend);
  await backend.store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    'inactive-current',
    () => {},
    (doc) => {
      nodeFor(doc.roots, 'ui-l5')!.active = false;
      return {};
    },
  );
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'grant',
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'learner-2')!.organizationAdministration = {
        organizationId: 'ui-l5',
        grantedBy: 'admin-1',
        grantedAt: new Date().toISOString(),
      };
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '정하린 수정', exact: true }).click();
  const dialog = page.getByRole('dialog'),
    tree = dialog.getByRole('tree', { name: '변경할 소속 조직' });
  const row = (id: string) => tree.locator(`[data-id="${id}"]`);
  await expect(row('ui-l5')).toContainText('사용 중지 · 현재 소속 유지 가능');
  await expect(row('ui-l5')).not.toHaveAttribute('aria-disabled', 'true');
  await dialog.getByLabel('이름', { exact: true }).fill('비활성 소속 유지');
  await dialog.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(backend.store.snapshot().users.find((u) => u.id === 'learner-2')!.organizationId).toBe(
    'ui-l5',
  );
  await page.getByRole('button', { name: '비활성 소속 유지 수정', exact: true }).click();
  await row('ui-l3').click();
  await row('ui-l5').click();
  await expect(row('ui-l5')).toHaveAttribute('aria-selected', 'true');
  await row('ui-l3').click();
  await backend.store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    'disable-destination',
    () => {},
    (doc) => {
      nodeFor(doc.roots, 'ui-l3')!.active = false;
      return {};
    },
  );
  await dialog.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('조직이 변경');
  await dialog.getByRole('button', { name: '최신 정보 비교', exact: true }).click();
  await expect(row('ui-l3')).toHaveAttribute('aria-selected', 'true');
  await expect(row('ui-l3')).toHaveAttribute('aria-disabled', 'true');
  await dialog.getByRole('button', { name: '입력 유지하고 저장 기준 갱신', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('다시 선택');
  await expect(dialog.getByLabel('이름', { exact: true })).toHaveValue('비활성 소속 유지');
  await expect(dialog.getByRole('button', { name: '사용자 저장', exact: true })).toBeDisabled();
  await row('ui-l2').click();
  await dialog.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const user = backend.store.snapshot().users.find((u) => u.id === 'learner-2')!;
  expect(user.organizationId).toBe('ui-l2');
  expect(user.organizationAdministration).toBeUndefined();
});
test('팀 관리자 메뉴·Lv5 구성원·추가·고정 역할·운영자 조회 전용과 네 화면 폭', async ({
  page,
  backend,
}, info) => {
  await setupMembers(backend);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: '팀 사용자 관리', exact: true })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('정하린');
  await expect(page.locator('tbody')).not.toContainText('다른 팀 비공개');
  await expect(page.getByRole('row').filter({ hasText: '시스템 운영자' })).toContainText(
    '시스템 운영에서 관리',
  );
  await expect(page.getByRole('button', { name: '시스템 운영자 수정', exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel('소속 조직 필터', { exact: true }).selectOption('ui-l2');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('소속 조직 필터', { exact: true }).selectOption('');
  await page.getByRole('button', { name: '사용자 추가', exact: true }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  const tree = dialog.getByRole('tree', { name: '변경할 소속 조직' });
  await expect(tree.locator('[data-id="org-photo"]')).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByLabel('Lv1 조직', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: '시스템 운영자', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: '팀 조직 관리자', exact: true })).toHaveCount(
    0,
  );
  await dialog.getByLabel('이름', { exact: true }).fill('팀이 추가한 구성원');
  await tree.locator('[data-id="ui-l5"]').click();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`team-user-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  await dialog.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('tbody')).toContainText('팀이 추가한 구성원');
  expect(
    backend.store.snapshot().users.find((u) => u.name === '팀이 추가한 구성원')!.organizationId,
  ).toBe('ui-l5');
  await page.getByRole('button', { name: '이서연 수정', exact: true }).click();
  await expect(dialog).toContainText('팀 조직 관리자 · 지정 유지');
  await expect(dialog.getByRole('button', { name: '사용자 저장', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(backend.store.snapshot().users.find((u) => u.id === 'admin-1')!.roles).toEqual(['admin']);
  expect(errors).toEqual([]);
});

test('수정 충돌 비교·입력 보존·응답 유실 재시도와 미저장 이동을 처리한다', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '정하린 수정', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('이름', { exact: true }).fill('내가 작성한 이름');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      const u = s.users.find((u) => u.id === 'learner-2')!;
      u.name = '다른 창 이름';
      u.revision++;
      return {};
    },
  );
  await dialog.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('이름', { exact: true })).toHaveValue('내가 작성한 이름');
  await dialog.getByRole('button', { name: '최신 정보 비교', exact: true }).click();
  await expect(dialog).toContainText('다른 창 이름');
  await dialog.getByRole('button', { name: '입력 유지하고 저장 기준 갱신', exact: true }).click();
  const oldRevision = backend.store.snapshot().users.find((u) => u.id === 'learner-2')!.revision;
  let aborted = false;
  await page.route('**/api/team-users/*', async (r) => {
    if (r.request().method() === 'PATCH' && !aborted) {
      aborted = true;
      await r.fetch();
      await r.abort();
    } else await r.continue();
  });
  await dialog.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(backend.store.snapshot().users.find((u) => u.id === 'learner-2')!.revision).toBe(
    oldRevision + 1,
  );
  await page.getByRole('button', { name: '내가 작성한 이름 수정', exact: true }).click();
  await dialog.getByLabel('이름', { exact: true }).fill('저장하지 않은 값');
  await page.getByRole('link', { name: '인증 현황', exact: true }).click({ force: true });
  await answerConfirmation(page, false);
  await expect(dialog.getByLabel('이름', { exact: true })).toHaveValue('저장하지 않은 값');
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await answerConfirmation(page, true);
  await expect(dialog).not.toBeVisible();
});

test('Auditor 준비 안내·저장 제한과 준비 후 지정 알림을 재사용한다', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '정하린 수정', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: 'Auditor', exact: true }).check();
  await expect(dialog.getByRole('region', { name: 'Auditor 지정 안내 미리보기' })).toContainText(
    '확인 필요',
  );
  await expect(dialog.getByRole('button', { name: '사용자 저장', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await answerConfirmation(page, true);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      const at = new Date().toISOString(),
        admin = userView(
          s.users.find((u) => u.id === 'admin-1')!,
          backend.store.organizations.snapshot(),
        );
      const created = createAuditorQualification(
        s,
        admin,
        'org-photo',
        { revision: 0, level: 'general', title: '일반 심사원' },
        at,
      );
      const q = s.qualifications.find((q) => q.id === created.id)!,
        c = structuredClone(s.courses.find((c) => c.id === 'demo-course-1')!);
      c.id = crypto.randomUUID();
      c.entityId = c.id;
      c.qualificationType = 'auditor';
      c.assessmentKinds = [];
      c.questions = [];
      c.practicalQuestions = [];
      c.learningItems = [
        { id: crypto.randomUUID(), title: '필수 교육 원문', required: true, type: 'team' },
      ];
      s.courses.push(c);
      q.courseIds = [c.id];
      q.lifecycleStatus = 'Active';
      q.validity = { type: 'unlimited', months: null, reminderDays: [] };
      saveAuditorProgram(
        s,
        admin,
        'org-photo',
        {
          revision: s.auditorPrograms[0]?.revision || 0,
          notice: { title: '팀 지정 안내', body: '본인 교육 확인', links: [] },
        },
        at,
      );
      return {};
    },
  );
  await page.getByRole('button', { name: '정하린 수정', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Auditor', exact: true }).check();
  await expect(dialog).toContainText('팀 지정 안내');
  await dialog.getByRole('button', { name: '사용자 저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    backend.store.snapshot().notifications.filter((n) => n.type === 'auditor_designation'),
  ).toHaveLength(1);
});

test('권한 회수 시 개인 목록을 지우고 운영자 팀 전환은 선택 팀만 조회한다', async ({
  page,
  backend,
}) => {
  await setupMembers(backend);
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/admin/users?lv1OrganizationId=org-etch');
  await expect(page.locator('tbody')).toContainText('다른 팀 비공개');
  await expect(page.locator('tbody')).not.toContainText('정하린');
  await page.goto('/system/users');
  await expect(page.locator('tbody')).toContainText('정하린');
  await page.getByRole('button', { name: '정하린 수정', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '시스템 운영자', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Lv1 조직', { exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog').getByRole('tree')).toHaveCount(0);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await actor(page, 'admin-1');
  await page.goto('/admin/users');
  await page.getByLabel('사용자 검색', { exact: true }).fill('정하린');
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      s.users.find((u) => u.id === 'admin-1')!.roles = ['learner'];
      return {};
    },
  );
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible();
});
