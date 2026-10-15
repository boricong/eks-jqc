export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'REQUEST_FAILED',
  ) {
    super(message);
  }
}
const pending = new Map<string, string>();
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. 입력을 유지한 상태에서 다시 시도해 주세요.');
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new ApiError(0, '서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.');
  }
  if (!response.ok)
    throw new ApiError(response.status, value.message || '요청을 처리하지 못했습니다.', value.code);
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
    key = explicitKey || pending.get(fingerprint) || crypto.randomUUID();
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
