import { firestoreCircuitBreaker } from './circuitBreaker';

const WRAPPED = Symbol('efluz.firestore.readGuard.wrapped');
const GUARDED_ERROR = 'FIRESTORE_READ_BLOCKED_BY_CIRCUIT_BREAKER';

const QUERY_CHAIN_METHODS = new Set([
  'where',
  'orderBy',
  'limit',
  'offset',
  'select',
  'startAt',
  'startAfter',
  'endAt',
  'endBefore',
  'withConverter',
  'count',
  'aggregate',
]);

const READ_METHODS = new Set(['get', 'stream', 'onSnapshot']);

function blockedReadError(): Error & { code: string } {
  const err = new Error(GUARDED_ERROR) as Error & { code: string };
  err.code = GUARDED_ERROR;
  return err;
}

function countReturnedDocuments(result: any): number | null {
  if (!result) return null;

  if (Array.isArray(result)) {
    return result.length;
  }

  if (Array.isArray(result.docs)) {
    return result.docs.length;
  }

  if (typeof result.exists === 'boolean') {
    return result.exists ? 1 : 0;
  }

  return null;
}

async function guardedRead<T>(operation: () => Promise<T>): Promise<T> {
  if (!firestoreCircuitBreaker.canExecute()) {
    throw blockedReadError();
  }

  try {
    const result = await operation();
    firestoreCircuitBreaker.recordSuccess();

    const documentCount = countReturnedDocuments(result);
    if (documentCount !== null) {
      firestoreCircuitBreaker.recordReadDocuments(documentCount);
    }

    return result;
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    throw err;
  }
}

function wrapQueryLike<T extends object>(target: T): T {
  if (!target || typeof target !== 'object') return target;
  if ((target as any)[WRAPPED]) return target;

  const proxy = new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === WRAPPED) return true;

      const original = Reflect.get(obj, prop, receiver);
      if (typeof original !== 'function') return original;

      const propName = String(prop);

      if (READ_METHODS.has(propName)) {
        return (...args: any[]) => guardedRead(() => Reflect.apply(original, obj, args));
      }

      if (QUERY_CHAIN_METHODS.has(propName) || propName === 'doc') {
        return (...args: any[]) => {
          const result = Reflect.apply(original, obj, args);
          return result && typeof result === 'object' ? wrapQueryLike(result) : result;
        };
      }

      return original.bind(obj);
    },
  });

  return proxy;
}

function wrapFirestoreInstance<T extends object>(target: T): T {
  if (!target || typeof target !== 'object') return target;
  if ((target as any)[WRAPPED]) return target;

  const proxy = new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === WRAPPED) return true;

      const original = Reflect.get(obj, prop, receiver);
      if (typeof original !== 'function') return original;

      const propName = String(prop);

      if (propName === 'collection') {
        return (...args: any[]) => {
          const result = Reflect.apply(original, obj, args);
          return wrapQueryLike(result);
        };
      }

      if (propName === 'getAll') {
        return (...args: any[]) => guardedRead(() => Reflect.apply(original, obj, args));
      }

      if (propName === 'listCollections') {
        return (...args: any[]) => guardedRead(() => Reflect.apply(original, obj, args));
      }

      if (propName === 'runTransaction') {
        return async (updateFunction: (transaction: any) => Promise<any>, ...args: any[]) => {
          if (!firestoreCircuitBreaker.canExecute()) {
            throw blockedReadError();
          }

          try {
            return await Reflect.apply(original, obj, [async (transaction: any) => {
              const guardedTransaction = new Proxy(transaction, {
                get(tx, txProp, txReceiver) {
                  const txOriginal = Reflect.get(tx, txProp, txReceiver);
                  if (typeof txOriginal !== 'function') return txOriginal;
                  if (txProp === 'get' || txProp === 'getAll') {
                    return (...txArgs: any[]) => guardedRead(() => Promise.resolve(Reflect.apply(txOriginal, tx, txArgs)));
                  }
                  return txOriginal.bind(tx);
                },
              });
              return updateFunction(guardedTransaction);
            }, ...args]);
          } catch (err: any) {
            firestoreCircuitBreaker.recordFailure(err);
            throw err;
          }
        };
      }

      return original.bind(obj);
    },
  });

  return proxy;
}

let installed = false;

/**
 * Installs a process-local guard around Firestore read execution.
 * This is intentionally fail-closed: once the circuit breaker is OPEN,
 * direct Firestore reads throw before making a network request.
 */
export function installFirestoreReadGuard(): void {
  if (installed) return;
  installed = true;

  const globalAny = globalThis as any;
  globalAny.__EFLUZ_FIRESTORE_READ_GUARD__ = {
    wrapFirestoreInstance,
    blockedReadError,
  };
}

/** Wrap a real Firestore instance returned by getFirestoreDb(). */
export function guardFirestoreDb<T extends object>(db: T): T {
  installFirestoreReadGuard();
  return wrapFirestoreInstance(db);
}

export function isFirestoreReadBlockedError(err: any): boolean {
  return err?.code === GUARDED_ERROR || err?.message === GUARDED_ERROR;
}
