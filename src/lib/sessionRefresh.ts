// JWT timestamps only schedule an authoritative refresh; they never authenticate a user.
export function sessionRefreshDue(token: string | null, lastRefreshAt: number, now = Date.now()): boolean {
  try {
    const encoded = token?.split('.')[1];
    if (encoded) {
      const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
      if (typeof payload.exp === 'number' && Number.isFinite(payload.exp) && payload.exp * 1000 - now <= 90_000) return true;
      if (typeof payload.iat === 'number' && Number.isFinite(payload.iat)) return now - payload.iat * 1000 >= 9 * 60_000;
    }
  } catch { /* Missing/malformed timestamps fall back to elapsed time. */ }
  return now - lastRefreshAt >= 9 * 60_000;
}
