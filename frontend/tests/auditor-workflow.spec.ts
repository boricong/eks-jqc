import { test, expect, actor } from './fixtures';
import { addQualification } from '../../server/tests/dashboard-fixtures';
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
async function guideContains(page: Page, text: string) {
  const guide = page.getByTestId('process-guide');
  await expect(guide.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  await guide.getByRole('button').click();
  await expect(guide).toContainText(text);
  await expect(guide.locator('.process-steps')).toContainText('학습·본인 확인');
  await guide.getByRole('button').click();
}
async function call(page: Page, path: string, body?: unknown, method = 'POST') {
  const tab = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  const response = await page.request.fetch('/api' + path, {
    method: body === undefined ? 'GET' : method,
    data: body,
    headers: { 'X-Session-Tab': tab!, 'idempotency-key': crypto.randomUUID() },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function prepare(backend: any, roles = ['learner', 'evaluator']) {
  return backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'Auditor UI fixture',
    () => {},
    (state: any) => {
      state.users.find((u: any) => u.id === 'learner-2').roles = roles;
      const q = addQualification(
        { state, orgs: backend.store.organizations.snapshot() },
        'auditor-check-ui',
        { qualificationType: 'auditor', title: '협력업체 심사원 최소역량' },
      );
      q.courseIds = q.courseIds.slice(0, 1);
      for (const id of q.courseIds) {
        const c = state.courses.find((c: any) => c.id === id);
        c.title = '심사 준비 학습';
        c.learningItems = [
          { id: id + '-1', title: '심사 기준 이해', type: 'mtc', required: true },
          { id: id + '-2', title: '현장 확인 절차 숙지', type: 'ojt', required: true },
          { id: id + '-3', title: '추가 참고 자료 확인', type: 'team', required: false },
        ];
        c.materials = [
          {
            id: id + '-m',
            type: 'text',
            title: '심사 학습자료',
            content: '심사 준비 학습 자료\n'.repeat(60),
            url: '',
            description: '',
          },
        ];
      }
      return { id: q.id, courseId: q.courseIds[0] };
    },
  );
}
test('유형별 요청·개인 홈·선택 목표 계획과 Auditor 본인 확인 수료·인증서', async ({
  page,
  backend,
}, info) => {
  const ids = await prepare(backend);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await actor(page, 'admin-1');
  await call(
    page,
    '/organization-policies/org-photo/qualification-pool',
    { revision: backend.store.organizations.snapshot().revision, qualificationIds: [ids.id] },
    'PUT',
  );
  await page.goto('/admin/assignments');
  await page.getByRole('tab', { name: 'Auditor · 평가자', exact: true }).click();
  await page.getByRole('button', { name: '계획 수립 요청', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Auditor 계획 수립 요청' });
  await expect(dialog.getByRole('radio', { name: 'Auditor · 평가자' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: '정하린', exact: true }).check();
  await dialog.getByRole('button', { name: '대상자에게 요청' }).click();
  await expect(dialog).not.toBeVisible();
  expect(backend.store.snapshot().planningRequests.at(-1)?.qualificationType).toBe('auditor');
  await actor(page, 'learner-2');
  await page.getByRole('tab', { name: '평가자 인증 · Auditor', exact: true }).click();
  await expect(page.locator('.home-qualification-carousel')).toContainText('계획');
  await guideContains(page, 'Auditor 유형의 본인 계획 요청');
  await page.getByTestId('process-guide').getByRole('button').click();
  await page.getByRole('tab', { name: '학습자 인증 · Auditee', exact: true }).click();
  await expect(page.getByTestId('process-guide').getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByTestId('process-guide')).toContainText('Auditee 유형의 본인 계획 요청');
  await page.getByRole('tab', { name: '평가자 인증 · Auditor', exact: true }).click();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole('tab', { name: '평가자 인증 · Auditor', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`auditor-home-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/plans?type=auditor');
  await guideContains(page, 'Auditor 요청에서 취득할 자격');
  await page.getByLabel('취득할 자격').selectOption(ids.id);
  await page.getByRole('button', { name: '계획 시작', exact: true }).click();
  await page.getByLabel('목표 인증일', { exact: true }).fill('2029-12-01');
  await expect(page.getByLabel('평가 예정일', { exact: false })).toHaveCount(0);
  await guideContains(page, '평가 예정일은 입력하지 않습니다');
  await page.getByRole('button', { name: '학습 목표 입력(선택)', exact: true }).click();
  await guideContains(page, '학습 목표는 선택사항');
  await page.getByRole('button', { name: '최종 확인', exact: true }).click();
  await guideContains(page, '계획 최종 확인');
  await page.getByRole('button', { name: '계획 완료', exact: true }).click();
  await expect(page.locator('.auditor-checklist')).toBeVisible();
  await guideContains(page, 'Auditor 학습 · 본인 확인');
  await expect(page.getByRole('link', { name: '평가 시작', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '자격 취득 메뉴' })).not.toContainText('평가');
  const measurements = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.auditor-checklist')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.locator('.auditor-checklist input').first().focus();
    const metrics = await page.locator('.auditor-checklist').evaluate((el) => {
      const rgb = (s: string) => s.match(/[\d.]+/g)!.map(Number);
      const background = (e: Element | null): number[] => {
        if (!e) return [255, 255, 255];
        const color = rgb(getComputedStyle(e).backgroundColor),
          alpha = color[3] ?? 1;
        const parent = alpha < 1 ? background(e.parentElement) : [0, 0, 0];
        return color.slice(0, 3).map((v, i) => v * alpha + parent[i]! * (1 - alpha));
      };
      const luminance = (c: number[]) =>
        c
          .slice(0, 3)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const ratio = (a: number[], b: number[]) => {
        const x = luminance(a),
          y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const text = [...el.querySelectorAll('h3,strong,small,p')].map((e) =>
        ratio(rgb(getComputedStyle(e).color), background(e)),
      );
      const row = el.querySelector('.auditor-check-item')!;
      return {
        width: innerWidth,
        textMin: Math.min(...text),
        focus: ratio(rgb(getComputedStyle(row).outlineColor), background(row)),
        rowHeight: row.getBoundingClientRect().height,
        font: getComputedStyle(row).fontFamily,
      };
    });
    expect(metrics.textMin).toBeGreaterThanOrEqual(4.5);
    expect(metrics.focus).toBeGreaterThanOrEqual(3);
    expect(metrics.rowHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.font).toContain('Pretendard');
    measurements.push(metrics);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath(`auditor-learning-${width}.png`),
      fullPage: true,
    });
  }
  await writeFile(
    info.outputPath('auditor-measurements.json'),
    JSON.stringify(measurements, null, 2),
  );
  await page.setViewportSize({ width: 1920, height: 900 });
  const checks = page.locator('.auditor-checklist input[type=checkbox]');
  await checks.nth(0).check();
  await expect(checks.nth(0)).toBeEnabled();
  await checks.nth(0).uncheck();
  await expect(checks.nth(0)).toBeEnabled();
  await checks.nth(0).check();
  await expect(checks.nth(1)).toBeEnabled();
  await page.getByRole('tab', { name: /학습자료 1개/ }).click();
  await page.getByRole('tab', { name: /학습범위 3개/ }).click();
  await expect(checks.nth(0)).toBeChecked();
  await checks.nth(1).check();
  await expect(checks.nth(0)).toBeDisabled();
  await expect(page.locator('.auditor-checklist')).toContainText('수료가 확정');
  expect(
    backend.store.snapshot().attempts.filter((a: any) => a.courseId === ids.courseId),
  ).toHaveLength(0);
  const a = backend.store.snapshot().assignments.find((a: any) => a.qualificationId === ids.id)!;
  const c = backend.store.snapshot().certifications.find((c: any) => c.assignmentId === a.id)!;
  expect(c).toBeTruthy();
  await page.goto(`/qualifications/${a.id}/courses/${ids.courseId}/objective`);
  await expect(page).toHaveURL(/qualifications\/[^/?]+\?type=auditor/);
  await page.goto(`/certifications/${a.id}?from=owned&type=auditor`);
  await expect(
    page.getByRole('heading', { name: 'Auditor 자격 인증서', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /수료 근거/ }).click();
  await page.locator('.evidence-course summary').click();
  await expect(page.locator('.certificate-evidence-body')).toContainText('본인 학습 확인');
  await expect(page.getByRole('button', { name: '재인증 시작', exact: true })).toHaveCount(0);
  await expect(page.locator('.certificate-renewal')).toContainText('준비 중');
  await guideContains(page, 'Auditor 재인증 시작·완료 절차는 아직 제공하지 않습니다');
  await page.goto(`/certifications/${a.id}?from=owned&type=auditee`);
  await guideContains(page, 'Auditor 자격 인증서 조회');
  const completion = backend.store
    .snapshot()
    .completions.find(
      (record) => record.courseId === ids.courseId && record.learnerId === a.learnerId,
    )!;
  await page.goto(`/completions/${completion.id}?from=owned&type=auditee`);
  await guideContains(page, '수료 순간 보존된 학습항목 본인 확인 근거');
  const completedPlan = backend.store.snapshot().plans.find((p: any) => p.assignmentId === a.id)!;
  await page.goto(`/plans/${completedPlan.id}`);
  await guideContains(page, '이 화면에서는 수정·변경 저장할 수 없으며');
  expect(errors).toEqual([]);
});
test('학습 확인 저장 실패·응답 유실 재시도, 역할 해제 후 기존 진행과 계정 분리', async ({
  page,
  backend,
}) => {
  const ids = await prepare(backend, ['evaluator']);
  await page.goto('/');
  await actor(page, 'admin-1');
  await call(
    page,
    '/organization-policies/org-photo/qualification-pool',
    { revision: backend.store.organizations.snapshot().revision, qualificationIds: [ids.id] },
    'PUT',
  );
  const r = await call(page, '/planning-requests', {
    qualificationType: 'auditor',
    learnerIds: ['learner-2'],
    message: '',
  });
  await actor(page, 'learner-2');
  await page.goto('/plans');
  await guideContains(page, 'Auditor 요청에서 취득할 자격');
  const p = await call(page, '/plans', {
    requestId: r.ids[0],
    requestRevision: 1,
    qualificationId: ids.id,
  });
  let plan = backend.store.snapshot().plans.find((v: any) => v.id === p.id)!;
  await call(
    page,
    `/plans/${p.id}`,
    {
      revision: plan.revision,
      targetOn: '2029-12-01',
      schedules: plan.schedules.map((s: any) => ({
        ...s,
        learningStart: '2027-01-01',
        learningEnd: '2027-02-01',
        assessmentOn: '',
        goal: '',
      })),
    },
    'PUT',
  );
  plan = backend.store.snapshot().plans.find((v: any) => v.id === p.id)!;
  const a = await call(page, `/plans/${p.id}/complete`, { revision: plan.revision });
  await page.goto(`/qualifications/${a.assignmentId}`);
  let lost = true;
  await page.route('**/api/enrollments/*/checklist', async (route) => {
    if (lost) {
      lost = false;
      await route.fetch();
      await route.fulfill({ status: 503, json: { message: '응답 유실 시험' } });
    } else await route.continue();
  });
  const checks = page.locator('.auditor-checklist input[type=checkbox]');
  await checks.first().check();
  await expect(page.getByRole('button', { name: '완료 확인 재시도' })).toBeVisible();
  await page.getByRole('tab', { name: /학습자료/ }).click();
  await page.getByRole('tab', { name: /학습범위/ }).click();
  await page.getByRole('button', { name: '완료 확인 재시도' }).click();
  await expect(checks.first()).toBeEnabled();
  expect(backend.store.snapshot().learningChecklists[0].revision).toBe(1);
  await backend.store.transact(
    'operator-1',
    crypto.randomUUID(),
    'revoke evaluator fixture',
    () => {},
    (s: any) => {
      s.users.find((u: any) => u.id === 'learner-2').roles = ['learner'];
      return {};
    },
  );
  await page.reload();
  await expect(checks.first()).toBeChecked();
  await checks.nth(1).check();
  await expect(checks.first()).toBeDisabled();
  await page.goto('/');
  await expect(page.getByRole('tab', { name: '평가자 인증 · 기존 요청 진행' })).toBeVisible();
  await actor(page, 'learner-1');
  await page.goto(`/qualifications/${a.assignmentId}`);
  await expect(page.locator('.auditor-checklist')).toHaveCount(0);
});

test('유형별 팀 적용은 검색 밖 변경을 저장하고 다른 유형의 적용 기준을 보존한다', async ({
  page,
  backend,
}) => {
  const ids = await prepare(backend);
  await page.goto('/');
  await actor(page, 'admin-1');
  await call(
    page,
    '/organization-policies/org-photo/qualification-pool',
    {
      revision: backend.store.organizations.snapshot().revision,
      qualificationIds: ['demo-qualification', ids.id],
    },
    'PUT',
  );
  await page.goto('/admin/qualifications?type=auditor');
  await page.getByRole('button', { name: '팀 적용', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '팀 적용', exact: true });
  await dialog.getByLabel('협력업체 심사원 최소역량 적용 버전').selectOption('');
  await dialog.getByLabel('팀 자격 검색').fill('다른 검색 결과');
  await dialog.getByRole('button', { name: '팀 적용 확정' }).click();
  await expect(dialog).not.toBeVisible();
  const result = await call(page, '/organization-policies');
  expect(result.pool.map((p: any) => p.qualificationId)).toEqual(['demo-qualification']);
});
