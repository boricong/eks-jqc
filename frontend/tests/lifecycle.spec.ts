import { test, expect, actor } from './fixtures';
import { configureTestPolicies } from '../../server/tests/policy-helpers';
import { assessmentQuestions, credentialCurrent } from '@eks/contracts';

async function finishOwn(page: any, store: any) {
  const tab = await page.evaluate(() => sessionStorage.getItem('eks-session-tab'));
  const headers = () => ({ 'X-Session-Tab': tab!, 'Idempotency-Key': crypto.randomUUID() });
  const a = store.snapshot().assignments.find((a: any) => a.learnerId === 'learner-1');
  for (const e of store.snapshot().enrollments.filter((e: any) => e.assignmentId === a.id)) {
    const c = store.snapshot().courses.find((c: any) => c.id === e.courseId);
    for (const kind of c.assessmentKinds) {
      if (
        store
          .snapshot()
          .attempts.some(
            (t: any) => t.enrollmentId === e.id && t.kind === kind && t.result === 'passed',
          )
      )
        continue;
      let res = await page.request.post(`/api/enrollments/${encodeURIComponent(e.id)}/attempts`, {
        headers: headers(),
        data: { kind },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const t = await res.json();
      res = await page.request.put(`/api/attempts/${t.id}/draft`, {
        headers: headers(),
        data: {
          revision: t.revision,
          answers: Object.fromEntries(assessmentQuestions(c, kind).map((q) => [q.id, q.correct])),
        },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      res = await page.request.post(`/api/attempts/${t.id}/submit`, {
        headers: headers(),
        data: { revision: t.revision + 1 },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    }
  }
  return a.id;
}
async function prepared(page: any, backend: any) {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'renewal-policy',
    () => {},
    (s: any) => {
      const q = s.qualifications.find((q: any) => q.id === 'demo-qualification');
      q.validity = { type: 'months', months: 1, reminderDays: [7] };
      q.renewalLeadMonths = 3;
      return {};
    },
  );
  await configureTestPolicies(backend.store);
  await page.goto('/');
  await actor(page, 'learner-1');
  return finishOwn(page, backend.store);
}
test('본인 종합평가 재인증·갱신 이력·원본 근거 유지와 반응형 화면', async ({
  page,
  backend,
}, testInfo) => {
  const aid = await prepared(page, backend),
    before = backend.store.snapshot(),
    cert = before.certifications[0]!;
  await page.goto(`/certifications/${aid}`);
  await expect(page.getByRole('button', { name: '재인증 시작', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '재인증 시작', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('실제 능력 평가를 완료했다는 의미가 아니며');
  await expect(dialog).toContainText('갱신 후 만료일');
  await dialog.getByRole('button', { name: '종합평가 완료', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '재인증 시작', exact: true })).toHaveCount(0);
  const after = backend.store.snapshot();
  expect(after.certifications[0]!.id).toBe(cert.id);
  expect(after.certifications[0]!.date).toBe(cert.date);
  expect(after.attempts).toEqual(before.attempts);
  expect(after.completions).toEqual(before.completions);
  expect(after.certifications[0]!.periods).toHaveLength(2);
  await page.locator('summary').filter({ hasText: '유효기간과 갱신 근거' }).click();
  await expect(
    page
      .locator('details')
      .filter({ has: page.locator('summary').filter({ hasText: '유효기간과 갱신 근거' }) })
      .getByText('MVP 완료 버튼으로 처리 · 실제 종합평가 점수 없음', { exact: true }),
  ).toBeVisible();
  await page.locator('summary').filter({ hasText: '취득·변경·갱신·정지·폐기 이력' }).click();
  await expect(page.getByText('갱신 완료', { exact: true })).toBeVisible();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: '현재 효력과 재인증' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`credential-${width}.png`), fullPage: true });
  }
  await page.reload();
  await expect(
    page.getByText(credentialCurrent(after.certifications[0]!).expiresOn!, { exact: true }).first(),
  ).toBeVisible();
});
test('대상자 Hold 선택·실패 시 입력 보존·홈 차단 안내·개인 자격 상태 관리', async ({
  page,
  backend,
}) => {
  const aid = await prepared(page, backend);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/targets');
  await page.getByRole('checkbox', { name: '김민서 선택', exact: true }).check();
  await expect(page.getByRole('heading', { name: '선택한 인원 1명' })).toBeVisible();
  await page.getByRole('button', { name: '대상자 상태 변경', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('변경 사유').fill('대상자 제외 시험');
  backend.store.beforeReplace = async () => {
    throw new Error('save failure');
  };
  await dialog.getByRole('button', { name: '대상 상태 저장' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('변경 사유')).toHaveValue('대상자 제외 시험');
  backend.store.beforeReplace = undefined;
  await dialog.getByRole('button', { name: '대상 상태 저장' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Hold 제외 1명', { exact: false }).first()).toBeVisible();
  await page.goto('/admin/credentials');
  await page.getByRole('link', { name: '상태·이력 관리', exact: true }).click();
  await page.getByRole('button', { name: '개인 자격 상태 변경', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('변경 사유').fill('효력 검토');
  await dialog.getByRole('button', { name: '개인 자격 상태 저장' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: '자격 상태와 재인증' })
      .getByText('Hold · 정지', { exact: true }),
  ).toBeVisible();
  await page.goto('/');
  await actor(page, 'learner-1');
  await expect(
    page.getByText('취득 대상자 Hold · 취득·재인증과 대상자 통계에서 제외됩니다.', {
      exact: false,
    }),
  ).toBeVisible();
  await page.goto(`/certifications/${aid}`);
  await expect(page.getByRole('button', { name: '재인증 시작' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '개인 자격 상태 변경' })).toHaveCount(0);
});
test('기준 상태 영향 확인·사유·Revoke 이력과 신규 인증Set 명칭·재인증 정책 입력', async ({
  page,
  backend,
}) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    'period',
    () => {},
    (s) => {
      s.qualifications.find((q) => q.id === 'demo-qualification')!.validity = {
        type: 'months',
        months: 36,
        reminderDays: [30],
      };
      return {};
    },
  );
  await configureTestPolicies(backend.store);
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification');
  await expect(page.getByRole('link', { name: '인증Set 관리', exact: true })).toBeVisible();
  await expect(page.getByLabel('재인증 시작 · 만료 전 개월', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: '운영 상태 변경', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('필수 지정 조직');
  await dialog.getByLabel('변경할 운영 상태').selectOption('Revoke');
  await dialog.getByLabel('변경 사유').fill('기준 폐기 검토');
  await dialog.getByRole('button', { name: '상태 변경 저장' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '운영 상태 이력 보기' }).click();
  await dialog.locator('summary').filter({ hasText: '기준 상태 변경 이력' }).click();
  await expect(dialog).toContainText('기준 폐기 검토');
  await expect(dialog.getByRole('button', { name: '상태 변경 저장' })).toHaveCount(0);
});
