# EFL UZ

See `READ_MAP.md` for the canonical runtime database and Firestore quota policy.

EFL UZ uses a SQLite-first runtime read architecture with Firestore remote synchronization. Normal user navigation should not require Firestore reads; Firestore access is centrally gated by the circuit breaker and controlled recovery probe.
