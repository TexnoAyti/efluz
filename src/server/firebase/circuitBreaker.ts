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
  trackedReadDocuments: number;
}

const DEFAULT_COOLDOWN_MS = 60000;
const CONSECUTIVE_FAILURES_THRESHOLD = 3;
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
  private trackedReadDocuments = 0;

  constructor(cooldownMs = DEFAULT_COOLDOWN_MS) {
    this.cooldownMs = cooldownMs;
  }

  public getOperationMode(): DatabaseOperationMode {
    if (this.state === 'CLOSED') {
      return this.softLimitExceeded ? 'SQLITE_FALLBACK' : 'FIRESTORE_PRIMARY';
    }
    if (this.state === 'OPEN') return 'SQLITE_FALLBACK';
    return 'RECOVERING';
  }

  public checkSoftLimit(currentReads: number): boolean {
    this.trackedReadDocuments = Math.max(this.trackedReadDocuments, currentReads);
    if (currentReads >= FIRESTORE_READ_SOFT_LIMIT) {
      if (!this.softLimitExceeded) {
        this.softLimitExceeded = true;
        console.warn(`[CIRCUIT_BREAKER] Daily read soft limit reached (${currentReads} >= ${FIRESTORE_READ_SOFT_LIMIT}). Switching to SQLITE_FALLBACK mode.`);
      }
      return true;
    }
    return false;
  }

  public recordReadDocuments(count = 0): boolean {
    if (!Number.isFinite(count) || count < 0) count = 0;
    this.trackedReadDocuments += count;
    return this.checkSoftLimit(this.trackedReadDocuments);
  }

  public getTrackedReadDocuments(): number {
    return this.trackedReadDocuments;
  }

  public resetSoftLimit(): void {
    this.softLimitExceeded = false;
    this.trackedReadDocuments = 0;
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
      rawCode === 8 || strCode === '8' || strCode.includes('RESOURCE_EXHAUSTED') || rawCode === 429 ||
      strMsg.includes('resource_exhausted') || strMsg.includes('quota exceeded') ||
      strMsg.includes('quota limit exceeded') || strMsg.includes('quota') || strMsg.includes('read quota')
    );
  }

  public isNetworkOrUnavailableError(err: any): boolean {
    if (!err) return false;
    const rawCode = err.code ?? (err.status ?? '');
    const rawMsg = err.message || String(err);
    const strCode = String(rawCode).toUpperCase();
    const strMsg = String(rawMsg).toLowerCase();
    return (
      rawCode === 14 || strCode === '14' || strCode.includes('UNAVAILABLE') || rawCode === 4 ||
      strCode === '4' || strCode.includes('DEADLINE_EXCEEDED') || strMsg.includes('unavailable') ||
      strMsg.includes('timeout') || strMsg.includes('timed out') || strMsg.includes('connection reset') ||
      strMsg.includes('econnrefused')
    );
  }

  public recordSkippedRead(count = 1) {
    this.skippedReadsCount += count;
  }

  /**
   * Eligibility check only. This method MUST NOT reserve the HALF_OPEN probe.
   * The actual Firestore read reserves it through authorizeRead().
   */
  public canExecute(): boolean {
    const now = Date.now();

    if (this.softLimitExceeded) {
      this.skippedReadsCount++;
      return false;
    }

    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      const elapsed = now - (this.lastFailureTime || 0);
      if (elapsed >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenProbeInFlight = false;
        console.log(`[CIRCUIT_BREAKER] Cooldown (${this.cooldownMs}ms) expired. State -> HALF_OPEN (probe eligible)`);
        return true;
      }
      this.skippedReadsCount++;
      return false;
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenProbeInFlight) {
        this.skippedReadsCount++;
        return false;
      }
      return true;
    }

    this.skippedReadsCount++;
    return false;
  }

  /** Atomically reserves the one real Firestore read allowed in HALF_OPEN. */
  public authorizeRead(): boolean {
    const now = Date.now();

    if (this.softLimitExceeded) {
      this.skippedReadsCount++;
      return false;
    }

    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      const elapsed = now - (this.lastFailureTime || 0);
      if (elapsed < this.cooldownMs) {
        this.skippedReadsCount++;
        return false;
      }
      this.state = 'HALF_OPEN';
      this.halfOpenProbeInFlight = true;
      console.log(`[CIRCUIT_BREAKER] Cooldown (${this.cooldownMs}ms) expired. State -> HALF_OPEN (probe reserved)`);
      return true;
    }

    if (this.state === 'HALF_OPEN') {
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
      console.log('[CIRCUIT_BREAKER] Firestore probe succeeded. State -> CLOSED.');
      this.state = 'CLOSED';
      this.healthySince = new Date().toISOString();
      this.lastError = null;
    }
  }

  public recordFailure(err: any) {
    this.totalErrors++;
    this.lastFailureTime = Date.now();
    this.halfOpenProbeInFlight = false;
    this.lastError = err?.message || String(err);

    if (this.isQuotaExhaustedError(err)) {
      this.resourceExhaustedCount++;
      this.consecutiveFailures++;
      this.tripOpen(`Firestore quota exhausted: ${this.lastError}`);
      return;
    }

    if (this.isNetworkOrUnavailableError(err)) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= CONSECUTIVE_FAILURES_THRESHOLD || this.state === 'HALF_OPEN') {
        this.tripOpen(`Firestore transient error (${this.consecutiveFailures} consecutive): ${this.lastError}`);
      }
    }
  }

  private tripOpen(reason: string) {
    if (this.state !== 'OPEN') {
      this.openCount++;
      console.warn(`[CIRCUIT_BREAKER] TRIP -> OPEN (${reason}). Cooldown: ${this.cooldownMs}ms.`);
    }
    this.state = 'OPEN';
    this.halfOpenProbeInFlight = false;
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
  }

  public reset() {
    this.forceState('CLOSED');
    this.lastError = null;
    this.resetSoftLimit();
    this.skippedReadsCount = 0;
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
      trackedReadDocuments: this.trackedReadDocuments,
    };
  }

  public isHealthy(): boolean {
    return this.state === 'CLOSED';
  }
}

export const firestoreCircuitBreaker = new FirestoreCircuitBreaker();
