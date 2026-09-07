import assert from 'node:assert/strict';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';

/** Structural regression checks for the recovery contract. */
assert.equal(typeof firestoreCircuitBreaker.getStatus, 'function');
assert.equal(typeof firestoreCircuitBreaker.canExecute, 'function');
assert.equal(typeof firestoreCircuitBreaker.authorizeRead, 'function');
assert.equal(typeof firestoreCircuitBreaker.recordSuccess, 'function');
assert.equal(typeof firestoreCircuitBreaker.recordFailure, 'function');

firestoreCircuitBreaker.reset();
firestoreCircuitBreaker.forceState('OPEN');
const status = firestoreCircuitBreaker.getStatus();
assert.equal(status.state, 'OPEN');
assert.ok(status.cooldownRemainingMs >= 0);
assert.ok(status.cooldownMs <= 10000, `Recovery cooldown is too long: ${status.cooldownMs}ms`);

// The HALF_OPEN state must admit exactly one real Firestore read.
firestoreCircuitBreaker.forceState('HALF_OPEN');
assert.equal(firestoreCircuitBreaker.authorizeRead(), true, 'First HALF_OPEN read must be authorized');
assert.equal(firestoreCircuitBreaker.authorizeRead(), false, 'Second concurrent HALF_OPEN read must be blocked');
assert.equal(firestoreCircuitBreaker.getStatus().state, 'HALF_OPEN');
firestoreCircuitBreaker.recordSuccess();
assert.equal(firestoreCircuitBreaker.getStatus().state, 'CLOSED');

firestoreCircuitBreaker.reset();
assert.equal(firestoreCircuitBreaker.getStatus().state, 'CLOSED');

console.log('PASS: recovery probe circuit lifecycle contract');
