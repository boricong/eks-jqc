import type { CatalogWorkbook, CatalogIssue } from '@eks/contracts';
export interface CatalogRecovery {
  id: string;
  actorId: string;
  lv1: string;
  updatedAt: string;
  workbook: CatalogWorkbook;
  baselines: Record<string, string>;
  fileHash: string;
  sheetIndex: number;
  courseCode: string;
  importProblems?: Array<CatalogIssue & { originalValue: string }>;
  pending?: { key: string; path: string; body: unknown };
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('eks-catalog-recovery', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('works', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('works', mode),
      request = action(tx.objectStore('works'));
    let result: T;
    request.onsuccess = () => (result = request.result);
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error || request.error || new Error('브라우저 보관 실패'));
    };
  });
}
export const saveRecovery = (v: CatalogRecovery) =>
  transact('readwrite', (s) => s.put(JSON.parse(JSON.stringify(v))));
export const deleteRecovery = (id: string) => transact('readwrite', (s) => s.delete(id));
// Keep simultaneous editors from sharing a mutable recovery record.
const releases = new Map<string, () => void>();
export async function claimRecovery(id: string): Promise<boolean> {
  if (releases.has(id)) return true;
  if (!navigator.locks) return false;
  return new Promise((resolve) => {
    void navigator.locks
      .request(`eks-catalog-${id}`, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        await new Promise<void>((release) => {
          releases.set(id, release);
          resolve(true);
        });
        releases.delete(id);
      })
      .catch(() => resolve(false));
  });
}
export function releaseRecovery(id: string) {
  releases.get(id)?.();
}
export async function listRecovery(actorId: string, lv1: string) {
  return ((await transact('readonly', (s) => s.getAll())) as CatalogRecovery[])
    .filter((v) => v.actorId === actorId && v.lv1 === lv1)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
