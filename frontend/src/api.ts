import { randomUUID } from './uuid';
import {
  getDataGeneration,
  getDataEpoch,
  observeGeneration,
  DATASET_EVENT,
} from './data-generation';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'REQUEST_FAILED',
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
const pending = new Map<string, string>();
window.addEventListener(DATASET_EVENT, () => pending.clear());
// sessionStorage survives reloads and keeps independently opened tabs separate.
const tabStorageKey = 'eks-session-tab';
const sessionTab = sessionStorage.getItem(tabStorageKey) || randomUUID();
sessionStorage.setItem(tabStorageKey, sessionTab);
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const epoch = getDataEpoch();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
        'X-Session-Tab': sessionTab,
        ...(getDataGeneration() ? { 'X-EKS-Data-Generation': getDataGeneration() } : {}),
      },
    });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. 입력을 유지한 상태에서 다시 시도해 주세요.');
  }
  const generation = response.headers.get('X-EKS-Data-Generation');
  if (epoch !== getDataEpoch() && generation !== getDataGeneration())
    throw new ApiError(
      409,
      '이전 데이터의 응답입니다. 계정을 다시 선택해 주세요.',
      'DATASET_CHANGED',
    );
  observeGeneration(generation);
  let value;
  try {
    value = await response.json();
  } catch {
    throw new ApiError(0, '서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.');
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      value.message || '요청을 처리하지 못했습니다.',
      value.code,
      value.details,
    );
  return value as T;
}
export async function mutate<T = { id: string; revision: number }>(
  path: string,
  body: unknown,
  method = 'POST',
  scope = '',
  explicitKey?: string,
): Promise<T> {
  const fingerprint = JSON.stringify({ path, body, method, scope }),
    key = explicitKey || pending.get(fingerprint) || randomUUID();
  pending.set(fingerprint, key);
  try {
    const result = await api<T>(path, {
      method,
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': key },
    });
    pending.delete(fingerprint);
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500)
      pending.delete(fingerprint);
    throw error;
  }
}
export async function downloadWorkbook(path: string, body?: unknown) {
  const epoch = getDataEpoch();
  const response = await fetch(`/api${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: {
      'X-Session-Tab': sessionTab,
      ...(getDataGeneration() ? { 'X-EKS-Data-Generation': getDataGeneration() } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const generation = response.headers.get('X-EKS-Data-Generation');
  if (epoch !== getDataEpoch() && generation !== getDataGeneration())
    throw new ApiError(
      409,
      '이전 데이터의 다운로드 응답입니다. 다시 선택해 주세요.',
      'DATASET_CHANGED',
    );
  observeGeneration(generation);
  if (!response.ok) {
    const error = await response.json();
    throw new ApiError(response.status, error.message);
  }
  const url = URL.createObjectURL(await response.blob()),
    link = document.createElement('a');
  link.href = url;
  link.download = 'eks-catalog.xlsx';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadMasterData() {
  const file = await api<unknown>('/system/master-data/export');
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `eks-master-${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())}.eksmaster.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
