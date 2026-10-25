import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { test, expect, actor } from './fixtures';

const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find(
    (entry) =>
      entry &&
      entry.family === 'IPv4' &&
      !entry.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address),
  )?.address;

test('HTTP LAN에서 앱 진입·세션·저장·새로고침과 안전한 UUID 생성', async ({ page, backend }) => {
  test.skip(!lanAddress, '사설 IPv4 네트워크 인터페이스가 없는 실행 환경');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await backend.store.transact(
    'admin-1',
    randomUUID(),
    randomUUID(),
    () => {},
    (state) => {
      state.notifications.push({
        id: 'lan-notice',
        key: 'lan-notice',
        lv1OrganizationId: 'org-photo',
        recipientId: 'learner-1',
        type: 'result',
        title: 'LAN 저장 확인',
        body: '임시 데이터 알림',
        href: '/qualifications',
        createdAt: '2026-10-26T00:00:00.000Z',
      });
      return {};
    },
  );
  await page.goto(`http://${lanAddress}:5286`);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await actor(page, 'learner-1');
  expect(await page.evaluate(() => sessionStorage.getItem('eks-session-tab'))).toMatch(
    /^[a-f0-9-]{14}4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  await page.goto(`http://${lanAddress}:5286/notifications?notification=lan-notice`);
  await expect
    .poll(
      () => backend.store.snapshot().notifications.find((item) => item.id === 'lan-notice')?.readAt,
    )
    .toBeTruthy();
  await page.reload();
  await expect(page.getByRole('heading', { name: '내 알림', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('UUID 대체 함수는 v4·중복 없는 ID를 생성하고 프록시는 교차 출처 쓰기를 거부한다', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }),
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  const ids = await page.evaluate(async (url) => {
    const { randomUUID } = await import(/* @vite-ignore */ url);
    return Array.from({ length: 200 }, () => randomUUID() as string);
  }, '/src/uuid.ts');
  expect(new Set(ids).size).toBe(200);
  expect(
    ids.every((id) =>
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id),
    ),
  ).toBe(true);
  const denied = await page.request.post('/api/session', {
    headers: { Origin: 'http://192.168.1.90:5286' },
    data: { actorId: 'learner-1' },
  });
  expect(denied.status()).toBe(403);
});
