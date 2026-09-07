export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type DatabaseOperationMode = 'FIRESTORE_PRIMARY' | 'SQLITE_FALLBACK' | 'RECOVERING';

export interface CircuitBreakerStatus {
  state: CircuitState;
  operationMode: DatabaseOperationMode;
  lastFailureTime: number | null;
  lastError: string | null;
  resourceExhaustedCount: number;
  totalErrors: number;
  consecutiveFailures: number;
  openCount: number;
  cooldownMs: number;
  cooldownRemainingMs: number;
  healthySince: string | null;
  skippedReadsCount: number;
  softLimitExceeded: boolean;
  softLimitThreshold: number;
}

// Configurable parameters
const DEFAULT_COOLDOWN_MS = 60000; // 60 seconds cooldown on quota exhaustion
const CONSECUTIVE_FAILURES_THRESHOLD = 3; // 3 consecutive general errors trip circuit
export const FIRESTORE_READ_SOFT_LIMIT = Number(process.env.FIRESTORE_READ_SOFT_LIMIT) || 35000;

class FirestoreCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private lastFailureTime: number | null = null;
  private lastError: string | null = null;
  private resourceExhaustedCount = 0;
  private totalErrors = 0;
  private consecutiveFailures = 0;
  private openCount = 0;
  private cooldownMs = DEFAULT_COOLDOWN_MS;
  private healthySince: string | null = new Date().toISOString();
  private halfOpenProbeInFlight = false;
  private skippedReadsCount = 0;
  private softLimitExceeded = false;

  constructor(cooldownMs = DEFAULT_COOLDOWN_MS) {
    this.cooldownMs = cooldownMs;
  }

  public getOperationMode(): DatabaseOperationMode {
    if (this.state === 'CLOSED') {
      return this.softLimitExceeded ? 'SQLITE_FALLBACK' : 'FIRESTORE_PRIMARY';
    }
    if (this.state === 'OPEN') {
      return 'SQLITE_FALLBACK';
    }
    return 'RECOVERING';
  }

  public checkSoftLimit(currentReads: number): boolean {
    if (currentReads >= FIRESTORE_READ_SOFT_LIMIT) {
      if (!this.softLimitExceeded) {
        this.softLimitExceeded = true;
        console.warn(`[CIRCUIT_BREAKER] Daily read soft limit reached (${currentReads} >= ${FIRESTORE_READ_SOFT_LIMIT}). Switching to conservative SQLITE_FALLBACK mode.`);
      }
      return true;
    }
    return false;
  }

  public resetSoftLimit(): void {
    this.softLimitExceeded = false;
  }

  public setCooldown(ms: number) {
    this.cooldownMs = ms;
  }

  public isQuotaExhaustedError(err: any): boolean {
    if (!err) return false;
    const rawCode = err.code ?? (err.status ?? '');
    const rawMsg = err.message || String(err);
    const strCode = String(rawCode).toUpperCase();
    const strMsg = String(rawMsg).toLowerCase();

    return (
      rawCode === 8 ||
      strCode === '8' ||
      strCode.includes('RESOURCE_EXHAUSTED') ||
      rawCode === 429 ||
      strMsg.includes('resource_exhausted') ||
      strMsg.includes('quota exceeded') ||
      strMsg.includes('quota limit exceeded') ||
      strMsg.includes('quota') ||
      strMsg.includes('read quota')
    );
  }

  public isNetworkOrUnavailableError(err: any): boolean {
    if (!err) return false;
    const rawCode = err.code ?? (err.status ?? '');
    const rawMsg = err.message || String(err);
    const strCode = String(rawCode).toUpperCase();
    const strMsg = String(rawMsg).toLowerCase();

    return (
      rawCode === 14 ||
      strCode === '14' ||
      strCode.includes('UNAVAILABLE') ||
      rawCode === 4 ||
      strCode === '4' ||
      strCode.includes('DEADLINE_EXCEEDED') ||
      strMsg.includes('unavailable') ||
      strMsg.includes('timeout') ||
      strMsg.includes('timed out') ||
      strMsg.includes('connection reset') ||
      strMsg.includes('econnrefused')
    );
  }

  public recordSkippedRead(count = 1) {
    this.skippedReadsCount += count;
  }

  public canExecute(): boolean {
    const now = Date.now();

    if (this.softLimitExceeded) {
      this.skippedReadsCount++;
      return false;
    }

    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      const elapsed = now - (this.lastFailureTime || 0);
      if (elapsed >= this.cooldownMs) {
        // Transition to HALF_OPEN to allow a single probe
        this.state = 'HALF_OPEN';
        this.halfOpenProbeInFlight = true;
        console.log(`[CIRCUIT_BREAKER] Cooldown (${this.cooldownMs}ms) expired. State -> HALF_OPEN (probing Firestore)`);
        return true;
      }
      // Still in cooldown period - short circuit
      this.skippedReadsCount++;
      return false;
    }

    if (this.state === 'HALF_OPEN') {
      // Allow only one probe in flight during half-open
      if (this.halfOpenProbeInFlight) {
        this.skippedReadsCount++;
        return false;
      }
      this.halfOpenProbeInFlight = true;
      return true;
    }

    this.skippedReadsCount++;
    return false;
  }

  public recordSuccess() {
    this.consecutiveFailures = 0;
    this.halfOpenProbeInFlight = false;

    if (this.state !== 'CLOSED') {
      console.log(`[CIRCUIT_BREAKER] Firestore probe succeeded. State -> CLOSED (restored normal operation)`);
      this.state = 'CLOSED';
      this.healthySince = new Date().toISOString();
      this.lastError = null;
    }
  }

  public recordFailure(err: any) {
    this.totalErrors++;
    this.lastFailureTime = Date.now();
    this.halfOpenProbeInFlight = false;
    const errMsg = err?.message || String(err);
    this.lastError = errMsg;

    const isQuota = this.isQuotaExhaustedError(err);
    if (isQuota) {
      this.resourceExhaustedCount++;
      this.consecutiveFailures++;
      this.tripOpen(`Firestore Quota Exhausted: ${errMsg}`);
      return;
    }

    const isNet = this.isNetworkOrUnavailableError(err);
    if (isNet) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= CONSECUTIVE_FAILURES_THRESHOLD || this.state === 'HALF_OPEN') {
        this.tripOpen(`Firestore Transient Error (${this.consecutiveFailures} consecutive): ${errMsg}`);
      }
      return;
    }

    // Other errors (e.g. not found, validation) do not trip the circuit
  }

  private tripOpen(reason: string) {
    if (this.state !== 'OPEN') {
      this.openCount++;
      console.warn(`[CIRCUIT_BREAKER] TRIP -> OPEN (${reason}). Cooldown: ${this.cooldownMs}ms. Fallback data will be served.`);
    }
    this.state = 'OPEN';
    this.healthySince = null;
  }

  public forceState(state: CircuitState) {
    this.state = state;
    this.halfOpenProbeInFlight = false;
    if (state === 'CLOSED') {
      this.healthySince = new Date().toISOString();
      this.consecutiveFailures = 0;
    } else {
      this.lastFailureTime = Date.now();
      this.healthySince = null;
    }
    console.log(`[CIRCUIT_BREAKER] State forced to ${state}`);
  }

  public reset() {
    this.forceState('CLOSED');
    this.lastError = null;
  }

  public getStatus(): CircuitBreakerStatus {
    const now = Date.now();
    let cooldownRemainingMs = 0;
    if (this.state === 'OPEN' && this.lastFailureTime) {
      cooldownRemainingMs = Math.max(0, this.cooldownMs - (now - this.lastFailureTime));
    }

    return {
      state: this.state,
      operationMode: this.getOperationMode(),
      lastFailureTime: this.lastFailureTime,
      lastError: this.lastError,
      resourceExhaustedCount: this.resourceExhaustedCount,
      totalErrors: this.totalErrors,
      consecutiveFailures: this.consecutiveFailures,
      openCount: this.openCount,
      cooldownMs: this.cooldownMs,
      cooldownRemainingMs,
      healthySince: this.healthySince,
      skippedReadsCount: this.skippedReadsCount,
      softLimitExceeded: this.softLimitExceeded,
      softLimitThreshold: FIRESTORE_READ_SOFT_LIMIT,
    };
  }

  public isHealthy(): boolean {
    return this.state === 'CLOSED';
  }
}

export const firestoreCircuitBreaker = new FirestoreCircuitBreaker();
