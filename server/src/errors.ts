export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "INVALID_REQUEST",
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export function demand(
  value: unknown,
  status: number,
  message: string,
  code?: string,
): asserts value {
  if (!value) throw new DomainError(status, message, code);
}
