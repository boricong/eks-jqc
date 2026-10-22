import { test as base, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JsonStore } from '../../server/src/storage';
import { seedState } from '../../server/src/seed';
import { buildApp } from '../../server/src/app';

export const test = base.extend<{
  backend: { store: JsonStore; restart: () => Promise<void>; setClock: (now?: string) => void };
}>({
  backend: [
    async ({}, use) => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'eks-browser-')),
        file = path.join(dir, 'runtime', 'state.json'),
        seed = seedState(true);
      await new JsonStore(file).initialize(seed);
      let fixedNow: string | undefined;
      const options = {
        origins: ['http://127.0.0.1:5286'],
        clock: () => fixedNow || new Date().toISOString(),
      };
      let store = await new JsonStore(file).load(),
        app = await buildApp(store, options);
      await app.listen({ host: '127.0.0.1', port: 5287 });
      try {
        await use({
          get store() {
            return store;
          },
          setClock: (now) => {
            fixedNow = now;
          },
          restart: async () => {
            await app.close();
            store = await new JsonStore(file).load();
            app = await buildApp(store, options);
            await app.listen({ host: '127.0.0.1', port: 5287 });
          },
        });
      } finally {
        await app.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
    { auto: true },
  ],
});
export { expect };
export async function answerConfirmation(page: Page, accept: boolean) {
  const dialog = page.getByTestId('app-confirmation');
  await expect(dialog).toBeVisible();
  if (accept) await dialog.locator('.dialog-footer .primary').click();
  else await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
export async function actor(page: Page, id: string) {
  const label = await page.locator(`#actor option[value="${id}"]`).textContent();
  const name = label!.split('·')[0]!.trim();
  await page.getByLabel('접속 계정').selectOption(id);
  await expect(page.getByLabel('접속 계정')).toBeEnabled();
  await expect(page.getByRole('heading', { name: `${name} 님`, exact: true })).toBeVisible();
}
