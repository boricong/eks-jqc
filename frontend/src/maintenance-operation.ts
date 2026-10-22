const key = 'eks-maintenance-pending';
export function pendingMaintenance(): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function retainMaintenance(id: string) {
  try {
    sessionStorage.setItem(key, id);
  } catch {
    /* The server receipt remains available. */
  }
}
export function clearMaintenance() {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Storage may be unavailable. */
  }
}
