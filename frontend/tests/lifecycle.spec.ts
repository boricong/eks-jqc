import { test, expect, actor } from './fixtures';
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
      const template = s.qualificationTemplates.find((t: any) => t.id === q.templateId)!,
        course = s.courses.find((c: any) => c.id === q.courseIds[0])!;
      s.qualificationTemplates.push({
        ...structuredClone(template),
        id: 'renewal-template',
        purpose: 'renewal',
        title: '객관식 재인증',
        scope: 'system',
      });
      s.courses.push({
        ...structuredClone(course),
        id: 'renewal-course',
        entityId: 'renewal-course',
        assessmentKinds: ['objective'],
        practicalQuestions: [],
        subjectiveEnabled: false,
        subjectiveQuestions: [],
        questions: [{ ...course.questions[0], choices: ['정답', '오답'], correct: 0 }],
      });
      s.qualifications.push({
        ...structuredClone(q),
        id: 'renewal-q',
        entityId: 'renewal-q',
        templateId: 'renewal-template',
        purpose: 'renewal',
        lifecycleStatus: 'Active',
        title: '객관식 재인증',
        courseIds: ['renewal-course'],
      });
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  return finishOwn(page, backend.store);
}
test('객관식 재인증 대상 확인·응시·갱신 결과와 4개 화면 크기', async ({
  page,
  backend,
}, testInfo) => {
  const aid = await prepared(page, backend),
    before = backend.store.snapshot(),
    cert = before.certifications[0]!;
  await page.goto(`/certifications/${aid}`);
  await page.getByRole('link', { name: '재인증 대상·평가 확인' }).click();
  await expect(page.getByRole('checkbox')).toBeChecked();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath(`renewal-selection-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: '1개 대상 확인' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('객관식 평가 합격');
  await dialog.getByRole('button', { name: '재인증 시작', exact: true }).click();
  await page.getByRole('link', { name: '객관식 평가 시작·이어하기' }).click();
  await page.getByRole('radio').first().check();
  await expect(page.locator('.save-status')).toHaveText('저장됨');
  await page.reload();
  await expect(page.getByRole('radio').first()).toBeChecked();
  await page.getByRole('button', { name: /^답안 확인(?:으로 돌아가기)?$/ }).click();
  await page.getByRole('button', { name: '최종 제출', exact: true }).click();
  await expect(page.getByRole('heading', { name: '평가 통과', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '재인증 결과 확인', exact: true }).first().click();
  await expect(page.getByText('갱신 완료', { exact: true })).toBeVisible();
  const after = backend.store.snapshot();
  expect(after.certifications).toHaveLength(before.certifications.length);
  expect(after.certifications[0]!.periods).toHaveLength(2);
  expect(after.certifications[0]!.evidence).toEqual(cert.evidence);
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath(`renewal-result-${width}.png`),
      fullPage: true,
    });
  }
  await page.goto(`/certifications/${aid}`);
  await page.getByRole('button', { name: '유효기간·갱신 근거 펼치기', exact: true }).click();
  await expect(page.getByText('객관식 재인증 평가 합격으로 갱신', { exact: true })).toBeVisible();
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
  await page.goto('/');
  await actor(page, 'admin-1');
  await page.goto('/admin/qualifications/demo-qualification/edit');
  await expect(page.getByRole('link', { name: '인증Set 설정', exact: true })).toBeVisible();
  await expect(page.getByLabel('재인증 시작 · 만료 전 개월', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: '운영 상태 변경', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).not.toContainText('필수 지정 조직');
  await dialog.getByLabel('변경할 운영 상태').selectOption('Revoke');
  await dialog.getByLabel('변경 사유').fill('기준 폐기 검토');
  await dialog.getByRole('button', { name: '상태 변경 저장' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '운영 상태 이력 보기' }).click();
  await dialog.locator('summary').filter({ hasText: '기준 상태 변경 이력' }).click();
  await expect(dialog).toContainText('기준 폐기 검토');
  await expect(dialog.getByRole('button', { name: '상태 변경 저장' })).toHaveCount(0);
});
