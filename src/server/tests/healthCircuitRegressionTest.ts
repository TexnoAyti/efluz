import assert from 'node:assert/strict';
import express from 'express';
import { healthRouter } from '../routes/health.routes';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { parseFirestoreError } from '../firebase/firestoreErrorHandler';

const app = express();
app.use('/api/health', healthRouter);
const server = app.listen(0, '127.0.0.1');

try {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/health`;

  firestoreCircuitBreaker.setCooldown(0);
  firestoreCircuitBreaker.forceState('OPEN');
  for (let i = 0; i < 2; i++) {
    const response = await fetch(url);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.circuitBreaker.state, 'OPEN');
    assert.equal(body.isOffline, true);
    assert.equal(body.connected, false);
  }
  assert.equal(firestoreCircuitBreaker.getStatus().state, 'OPEN', 'Passive health must not claim the recovery probe');
  assert.equal(firestoreCircuitBreaker.canExecute(), true, 'The next real operation can probe recovery');
  assert.equal(firestoreCircuitBreaker.getStatus().state, 'HALF_OPEN');
  assert.equal(firestoreCircuitBreaker.canExecute(), false, 'Concurrent operations must wait for the probe');

  const error = parseFirestoreError(new Error('CIRCUIT_OPEN: Firestore circuit breaker is OPEN.'));
  assert.equal(error.httpStatus, 503);
  assert.equal(error.code, 'FIRESTORE_TEMPORARILY_UNAVAILABLE');
  console.log('PASS health circuit recovery probe and unavailable-write response');
} finally {
  firestoreCircuitBreaker.reset();
  firestoreCircuitBreaker.setCooldown(60000);
  server.close();
}
