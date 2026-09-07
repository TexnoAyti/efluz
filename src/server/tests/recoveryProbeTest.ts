import assert from 'node:assert/strict';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';

/** Structural regression checks for the recovery contract. */
assert.equal(typeof firestoreCircuitBreaker.getStatus, 'function');
assert.equal(typeof firestoreCircuitBreaker.canExecute, 'function');
assert.equal(typeof firestoreCircuitBreaker.recordSuccess, 'function');
assert.equal(typeof firestoreCircuitBreaker.recordFailure, 'function');

firestoreCircuitBreaker.reset();
firestoreCircuitBreaker.forceState('OPEN');
const status = firestoreCircuitBreaker.getStatus();
assert.equal(status.state, 'OPEN');
assert.ok(status.cooldownRemainingMs >= 0);

firestoreCircuitBreaker.reset();
assert.equal(firestoreCircuitBreaker.getStatus().state, 'CLOSED');

console.log('PASS: recovery probe circuit lifecycle contract');
