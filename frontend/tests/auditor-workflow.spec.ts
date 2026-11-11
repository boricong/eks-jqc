import { createPoolQualification as createAuditorQualification } from '../../server/tests/auditor-fixture';
import { configureNeeds } from './workflow-helpers';
import { test, expect, actor, answerConfirmation } from './fixtures';
import type { Page } from '@playwright/test';
import { saveAuditorProgram } from '../../server/src/auditor-program';
import { userView } from '../../server/src/organizations';
import { carouselContrast } from './carousel-visual-helpers';

test('Lv1 대상 팀 지정과 개인 지정 제거·일반 메뉴 분리', async ({ page, backend }) => {
  await page.goto('/');
  await actor(page, 'operator-1');
  await page.goto('/system/users');
  await page.getByRole('button', { name: '정하린 수정', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('checkbox', { name: 'Auditor', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  await page.goto('/system/organizations');
  const setting = page.getByRole('region', { name: 'Auditor 대상 팀 설정' });
  await expect(setting).toBeVisible();
  await setting.getByRole('button', { name: 'Auditor 대상 팀 변경' }).click();
  let dialog = page.getByRole('dialog', { name: 'Auditor 대상 팀 설정' });
  await expect(dialog.getByRole('button', { name: '변경', exact: true })).toBeDisabled();
  await dialog.getByRole('radio', { name: '사용', exact: true }).check();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(dialog.getByRole('button', { name: '변경', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  }
  await dialog.getByRole('radio', { name: '사용', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: '미사용', exact: true })).toBeChecked();
  await page.keyboard.press('ArrowLeft');
  await dialog.getByRole('button', { name: '변경', exact: true }).click();
  await expect(dialog).toContainText('대상');
  await dialog.getByRole('button', { name: '변경 확정' }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    backend.store.organizations.snapshot().roots.find((r: any) => r.id === 'org-photo')!
      .auditorEnabled,
  ).toBe(true);
  expect(
    backend.store.snapshot().notifications.filter((n: any) => n.type === 'auditor_designation'),
  ).toHaveLength(0);
  await page.goto('/admin/auditor?lv1OrganizationId=org-photo');
  await expect(page.getByRole('heading', { name: 'Auditor 관리', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Auditor 관리', exact: true })).toBeVisible();
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications');
  await expect(page.getByRole('tab', { name: /Auditee|Auditor/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '자격 등록', exact: true })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Auditee');
});

async function call(page: Page, path: string, body?: unknown, method = 'POST') {
  const tab = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  const response = await page.request.fetch('/api' + path, {
    method: body === undefined ? 'GET' : method,
    data: body,
    headers: {
      'X-Session-Tab': tab!,
      'idempotency-key': crypto.randomUUID(),
      'X-EKS-Release-Contract': '7',
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function prepare(backend: any, roles = ['learner']) {
  await backend.store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    'enable test team',
    () => {},
    (doc: any) => {
      doc.roots.find((r: any) => r.id === 'org-photo').auditorEnabled = true;
      return {};
    },
  );
  return backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'Auditor isolated UI fixture',
    () => {},
    (s: any) => {
      const at = new Date().toISOString(),
        doc = backend.store.organizations.snapshot(),
        admin = userView(
          s.users.find((u: any) => u.id === 'admin-1'),
          doc,
        );
      for (const level of ['general', 'main'] as const) {
        const created = createAuditorQualification(
          s,
          admin,
          'org-photo',
          {
            revision: s.auditorPrograms[0]?.revision || 0,
            level,
            title: level === 'general' ? '일반 심사원' : '메인 심사원',
            description: '심사 교육·인증 기준',
          },
          at,
        );
        const q = s.qualifications.find((q: any) => q.id === created.id),
          c = structuredClone(s.courses.find((c: any) => c.id === 'demo-course-1'));
        c.id = crypto.randomUUID();
        c.entityId = c.id;
        c.qualificationType = 'auditor';
        c.title = level === 'general' ? '일반 심사 학습' : '메인 심사 학습';
        c.assessmentKinds = [];
        c.questions = [];
        c.practicalQuestions = [];
        c.learningItems = [
          { id: crypto.randomUUID(), title: '심사 기준 이해', type: 'team', required: true },
          { id: crypto.randomUUID(), title: '현장 확인 절차 숙지', type: 'ojt', required: true },
        ];
        c.materials = [
          {
            id: crypto.randomUUID(),
            type: 'text',
            title: '심사 학습자료',
            content: '심사 준비와 필수 인증기준을 확인합니다.',
            url: '',
            description: '',
          },
        ];
        s.courses.push(c);
        q.courseIds = [c.id];
        q.validity = { type: 'months', months: 12, reminderDays: [] };
        q.lifecycleStatus = 'Active';
      }
      saveAuditorProgram(
        s,
        admin,
        'org-photo',
        {
          revision: s.auditorPrograms[0]?.revision || 0,
          notice: {
            title: 'Auditor 지정 교육 안내',
            body: '필수학습과 일반·메인 인증기준을 확인해 주세요.',
            links: [{ title: '참고 자료', url: 'https://example.com/training' }],
          },
        },
        at,
      );
      const u = s.users.find((u: any) => u.id === 'learner-2');
      u.roles = roles;
      return {};
    },
  );
}
async function finish(page: Page) {
  const checks = page.locator('.auditor-checklist input[type=checkbox]');
  await checks.nth(0).check();
  await expect(checks.nth(0)).toBeEnabled();
  await checks.nth(1).check();
  await expect(
    page.locator('.auditor-checklist').getByRole('link', { name: '수료증 보기', exact: true }),
  ).toBeVisible();
  await expect(checks.nth(0)).toBeDisabled();
}

test('Auditor 홈에서 일정 없이 일반·메인 취득과 반응형·키보드·안내 링크', async ({
  page,
  backend,
}, info) => {
  await prepare(backend);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.getByRole('tab', { name: 'Auditor 인증', exact: true }).click();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole('button', { name: '일반 Auditor 학습 시작', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`auditor-home-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: '일반 Auditor 학습 시작', exact: true }).focus();
  await carouselContrast(page, '.auditor-learning');
  await page.keyboard.press('Enter');
  await expect(page.locator('.auditor-checklist')).toBeVisible();
  await expect(page.getByText('종료일', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '내 학습 일정' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '내 계획', exact: true })).toHaveCount(0);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: info.outputPath(`auditor-learning-${width}.png`),
      fullPage: true,
    });
  }
  await finish(page);
  await page.goto('/auditor');
  await expect(page.locator('.current-level')).toContainText('일반 Auditor');
  await page.getByRole('button', { name: '메인 Auditor 학습 시작', exact: true }).click();
  await finish(page);
  await page.goto('/auditor');
  await expect(page.locator('.current-level')).toContainText('메인 Auditor');
  expect(
    backend.store
      .snapshot()
      .assignments.filter((a) => a.auditor)
      .every((a) => !a.planId),
  ).toBeTruthy();
  expect(backend.store.snapshot().certifications.filter((c) => c.auditor)).toHaveLength(2);
  await page.goto('/auditor');
  await page.locator('.auditor-notice summary').click();
  await expect(page.getByRole('link', { name: '참고 자료' })).toHaveAttribute(
    'href',
    'https://example.com/training',
  );
  await page.goto('/plans?type=auditor');
  await expect(page).toHaveURL(/\/auditor/);
  await page.goto('/plans');
  await expect(page).toHaveURL(/\/plans$/);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/dashboard?qualificationType=auditor');
  await expect(page).toHaveURL(/qualificationType=auditor/);
  const progress = page.getByRole('region', { name: 'Auditor 학습·등급 현황', exact: true });
  await expect(progress).toContainText('메인 1명');
  await expect(progress).toContainText('학습 시작 1명');
  await expect(progress).toContainText('수료 이력 1명');
  await expect(progress).not.toContainText('계획');
  const issued = backend.store.snapshot().certifications.find((c) => c.auditor)!;
  await page.goto(`/certifications/${issued.assignmentId}?lv1OrganizationId=org-photo`);
  await expect(page.getByRole('heading', { name: 'Auditor 인증서', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '목록으로', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/results.*type=auditor/);
  expect(errors).toEqual([]);
});
test('Auditor 갱신은 현재 교육·인증기준 원문 확인으로 처리하고 만료 후 학습으로 연결한다', async ({
  page,
  backend,
}) => {
  await prepare(backend, ['admin']);
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.goto('/auditor');
  await page.getByRole('button', { name: '일반 Auditor 학습 시작', exact: true }).click();
  await finish(page);
  const c = backend.store.snapshot().certifications.find((c) => c.auditor)!;
  const renewalTime = new Date(`${c.expiresOn}T01:00:00.000Z`);
  renewalTime.setUTCMonth(renewalTime.getUTCMonth() - 1);
  backend.setClock(renewalTime.toISOString());
  const completionCount = backend.store.snapshot().completions.length;
  await page.goto('/auditor');
  await page.getByRole('link', { name: '갱신 기준 확인', exact: true }).click();
  await page.getByRole('button', { name: '갱신 기준 확인', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '교육·인증기준 확인', exact: true });
  await expect(dialog.getByRole('region', { name: '현재 교육·인증기준' })).toContainText(
    '심사 기준 이해',
  );
  await dialog.getByText('심사 학습자료', { exact: true }).click();
  await expect(
    dialog.getByText('심사 준비와 필수 인증기준을 확인합니다.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: '교육·인증기준 확인 완료', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(backend.store.snapshot().completions).toHaveLength(completionCount);
  const updated = backend.store.snapshot().certifications.find((v) => v.id === c.id)!;
  expect(updated.periods).toHaveLength(2);
  expect(updated.date).toBe(c.date);
  const proof = backend.store
    .snapshot()
    .renewals.find((r) => r.certificationId === c.id)!.confirmation!;
  expect(proof.courses[0]!.materials[0]!.content).toContain('필수 인증기준');
  const expiration = new Date(`${updated.periods!.at(-1)!.expiresOn}T15:00:00.000Z`);
  backend.setClock(expiration.toISOString());
  await page.reload();
  await expect(page.getByRole('link', { name: '재취득 학습 시작', exact: true })).toHaveAttribute(
    'href',
    '/auditor',
  );
  await expect(page.getByText('재취득 계획·요청 확인', { exact: true })).toHaveCount(0);
});

test('Auditor 확인 응답 유실 재시도와 지정 해제 후 기존 학습 완료·계정 분리', async ({
  page,
  backend,
}) => {
  await prepare(backend, ['admin']);
  await page.goto('/');
  await actor(page, 'learner-2');
  await page.goto('/auditor');
  await page.getByRole('button', { name: '일반 Auditor 학습 시작', exact: true }).click();
  await expect(page.locator('.auditor-checklist')).toBeVisible();
  const a = backend.store.snapshot().assignments.find((a) => a.auditor)!;
  let lost = true;
  await page.route('**/api/enrollments/*/checklist', async (route) => {
    if (lost) {
      lost = false;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  const checks = page.locator('.auditor-checklist input');
  await checks.first().check();
  await expect(page.getByRole('button', { name: '완료 확인 재시도' })).toBeVisible();
  await page.getByRole('button', { name: '완료 확인 재시도' }).click();
  await expect(checks.first()).toBeEnabled();
  expect(backend.store.snapshot().learningChecklists[0]!.revision).toBe(1);
  await backend.store.organizations.transact(
    'operator-1',
    crypto.randomUUID(),
    'disable test team',
    () => {},
    (doc) => {
      doc.roots.find((r) => r.id === 'org-photo')!.auditorEnabled = false;
      return {};
    },
  );
  await page.reload();
  await checks.nth(1).check();
  await expect(checks.first()).toBeDisabled();
  await page.goto('/auditor');
  await expect(
    page.getByText('소속 팀은 Auditor 미사용 상태입니다.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '메인 Auditor 학습 시작', exact: true }),
  ).toHaveCount(0);
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto(`/qualifications/${a.id}`);
  await expect(page.locator('.auditor-checklist')).toHaveCount(0);
});
test('Auditor 안내문 전용 운영·설정 충돌 입력 보존과 Auditee 요청 화면 분리', async ({
  page,
  backend,
}, info) => {
  await prepare(backend);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/auditor');
  await expect(page.getByRole('heading', { name: 'Auditor 관리', exact: true })).toBeVisible();
  const menu = page.getByRole('navigation', { name: 'Auditor 업무', exact: true });
  await expect(menu.getByRole('link')).toHaveCount(5);
  for (const [name, path] of [
    ['Auditor 자격 풀', 'qualifications'],
    ['Auditor 인증Set', 'courses'],
    ['Auditor 현황', 'dashboard'],
    ['Auditor 결과', 'results'],
    ['Auditor 보유 인증', 'credentials'],
  ]) {
    await expect(menu.getByRole('link', { name, exact: true })).toHaveAttribute(
      'href',
      new RegExp(
        `/admin/${path}\\?.*${path === 'dashboard' ? 'qualificationType' : 'type'}=auditor`,
      ),
    );
  }
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const card of await menu.getByRole('link').all()) await expect(card).toBeVisible();
    const columns = await page
      .locator('.auditor-menu-grid')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(width >= 1280 ? 3 : width >= 768 ? 2 : 1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`auditor-admin-${width}.png`), fullPage: true });
  }
  await expect(
    page.getByRole('heading', { name: 'Auditor 팀 학습 안내문 설정', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '일반 Auditor 자격 생성' })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  const firstMenu = menu.getByRole('link', { name: 'Auditor 자격 풀', exact: true });
  await firstMenu.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/qualifications.*type=auditor/);
  await page.goBack();
  await page.getByRole('button', { name: '학습 안내문', exact: true }).click();
  await expect(page.getByLabel('안내 제목', { exact: true })).toBeFocused();
  await carouselContrast(page, '.auditor-admin');
  await page.getByLabel('안내 제목', { exact: true }).fill('수정한 안내');
  await page.getByRole('button', { name: '링크 추가', exact: true }).click();
  const extraLink = page.getByRole('group', { name: '자료 링크 2', exact: true });
  await extraLink.getByLabel('링크 제목', { exact: true }).fill('추가 참고 자료');
  await extraLink
    .getByLabel('HTTP(S) 주소', { exact: true })
    .fill('https://example.com/additional');
  await menu.getByRole('link', { name: 'Auditor 자격 풀', exact: true }).click();
  await answerConfirmation(page, false);
  await expect(page.getByLabel('안내 제목', { exact: true })).toHaveValue('수정한 안내');
  await expect(extraLink.getByLabel('링크 제목', { exact: true })).toHaveValue('추가 참고 자료');
  await extraLink.getByRole('button', { name: '자료 링크 2 삭제', exact: true }).click();
  const p = (await call(page, '/auditor-program')).program;
  await call(
    page,
    '/auditor-program',
    { revision: p.revision, notice: { title: '다른 창 안내', body: '새 기준', links: [] } },
    'PUT',
  );
  await page.getByRole('button', { name: '안내문 저장', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('변경');
  await expect(page.getByLabel('안내 제목', { exact: true })).toHaveValue('수정한 안내');
  await page.getByRole('button', { name: '최신 기준 비교', exact: true }).click();
  await expect(page.getByRole('region', { name: '최신 운영 기준 비교' })).toContainText(
    '다른 창 안내',
  );
  await page.getByRole('button', { name: '입력 유지하고 저장 기준 갱신', exact: true }).click();
  await expect(page.getByLabel('안내 제목', { exact: true })).toHaveValue('수정한 안내');
  await page.getByRole('button', { name: '안내문 저장', exact: true }).click();
  await expect
    .poll(() => backend.store.snapshot().auditorPrograms[0]!.notice.title)
    .toBe('수정한 안내');
  expect(
    backend.store.snapshot().notifications.filter((n) => n.type === 'auditor_designation'),
  ).toHaveLength(0);
  await expect(page.getByRole('button', { name: '안내 발송', exact: true })).toHaveCount(0);
  await configureNeeds(page);
  await page.goto('/admin/assignments');
  await expect(page.getByRole('tab', { name: /Auditor/ })).toHaveCount(0);
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toContainText('Auditor');
});
