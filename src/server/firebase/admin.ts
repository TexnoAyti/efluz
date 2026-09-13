import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

let cachedDb: Firestore | null = null;
let cachedInfo: FirebaseConfigInfo | null = null;
let initError: string | null = null;

export interface FirebaseConfigInfo {
  isConfigured: boolean;
  projectId?: string;
  databaseId?: string;
  authMode: 'service_account' | 'credentials' | 'application_default' | 'local_fallback' | 'not_configured';
  error?: string;
  verifiedAt?: string;
}

function loadAppletConfig(): { projectId?: string; firestoreDatabaseId?: string } {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }
  return {};
}

export function initializeFirebaseAdmin(): { db: Firestore | null; info: FirebaseConfigInfo } {
  const isRealProduction =
    process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
    process.env.NODE_ENV === 'production';

  // Support an explicit test-only environment variable: FIREBASE_FORCE_LOCAL_FALLBACK=true
  // This fallback must never activate when VERCEL === "1", AWS_LAMBDA_FUNCTION_NAME exists,
  // or the application is running in a real production environment.
  const isForceLocalFallback =
    process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' && !isRealProduction;

  if (isForceLocalFallback) {
    if (!cachedDb || cachedInfo?.authMode !== 'local_fallback') {
      const appletConfig = loadAppletConfig();
      const fallbackProjectId =
        process.env.FIREBASE_PROJECT_ID ||
        process.env.GCLOUD_PROJECT ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        appletConfig.projectId ||
        'gen-lang-client-0195097895';
      const fallbackDatabaseId =
        process.env.FIRESTORE_DATABASE_ID ||
        process.env.FIREBASE_DATABASE_ID ||
        appletConfig.firestoreDatabaseId ||
        'ai-studio-efluz-4c6c88a6-697e-4fdf-82ed-45fec68ca34d';

      const memoryDb = createMemoryFirestore();
      cachedDb = memoryDb as unknown as Firestore;
      cachedInfo = {
        isConfigured: true,
        projectId: fallbackProjectId,
        databaseId: fallbackDatabaseId,
        authMode: 'local_fallback',
      };
      console.log(`[FIREBASE AUTH] Using forced local in-memory fallback (FIREBASE_FORCE_LOCAL_FALLBACK=true): projectId=${fallbackProjectId}, databaseId=${fallbackDatabaseId}`);
    }
    return {
      db: cachedDb,
      info: cachedInfo,
    };
  }

  // Clear stale local fallback cache if running outside forced fallback mode
  if (!isForceLocalFallback && cachedInfo?.authMode === 'local_fallback') {
    cachedDb = null;
    cachedInfo = null;
  }

  if (cachedDb && cachedInfo && cachedInfo.isConfigured) {
    return {
      db: cachedDb,
      info: cachedInfo,
    };
  }

  const appletConfig = loadAppletConfig();
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    appletConfig.projectId ||
    'gen-lang-client-0195097895';

  const databaseId =
    process.env.FIRESTORE_DATABASE_ID ||
    process.env.FIREBASE_DATABASE_ID ||
    appletConfig.firestoreDatabaseId ||
    'ai-studio-efluz-4c6c88a6-697e-4fdf-82ed-45fec68ca34d';

  // Check all possible service account credentials formats
  let serviceAccountJson =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
    process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccountJson && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath.trim().startsWith('{')) {
      serviceAccountJson = credPath;
    } else if (fs.existsSync(credPath)) {
      try {
        serviceAccountJson = fs.readFileSync(credPath, 'utf-8');
      } catch {
        // continue
      }
    }
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;

  let app: App;

  try {
    const apps = getApps();
    if (apps.length === 0) {
      if (serviceAccountJson) {
        const parsed = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
        app = initializeApp({
          credential: cert(parsed),
          projectId: parsed.project_id || projectId,
        });
      } else if (clientEmail && privateKey) {
        app = initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
          projectId,
        });
      } else {
        // In Cloud Run / GCP / production, try Application Default Credentials (ADC)
        try {
          app = initializeApp({
            credential: applicationDefault(),
            projectId,
          });
        } catch (adcErr: any) {
          if (isProduction) {
            console.error('[CRITICAL] Production Firebase initialization failed. Service account credentials required.', adcErr);
            initError = adcErr.message || 'Missing Firebase credentials in production';
            cachedInfo = {
              isConfigured: false,
              projectId,
              databaseId,
              authMode: 'not_configured',
              error: initError,
            };
            return {
              db: null,
              info: cachedInfo,
            };
          }

          // In local development only, fall back to in-memory store
          const memoryDb = createMemoryFirestore();
          cachedDb = memoryDb as unknown as Firestore;
          cachedInfo = {
            isConfigured: true,
            projectId,
            databaseId,
            authMode: 'local_fallback',
          };
          return {
            db: cachedDb,
            info: cachedInfo,
          };
        }
      }
    } else {
      app = apps[0];
    }

    cachedDb = databaseId && databaseId !== '(default)' ? getFirestore(app, databaseId) : getFirestore(app);
    try {
      cachedDb.settings({ ignoreUndefinedProperties: true });
    } catch {
      // Ignore if already initialized with settings
    }
    initError = null;
    cachedInfo = {
      isConfigured: true,
      projectId,
      databaseId,
      authMode: serviceAccountJson || (clientEmail && privateKey) ? 'credentials' : 'application_default',
    };

    console.log(`[FIREBASE AUTH] Initialized Firebase Admin successfully: projectId=${projectId}, databaseId=${databaseId}, authMode=${cachedInfo.authMode}`);

    return {
      db: cachedDb,
      info: cachedInfo,
    };
  } catch (err: any) {
    initError = err.message || 'Firebase Admin initialization failed';

    if (isProduction) {
      console.error('[CRITICAL] Firebase Admin production initialization failed:', err);
      cachedInfo = {
        isConfigured: false,
        projectId,
        databaseId,
        authMode: 'not_configured',
        error: initError,
      };
      return {
        db: null,
        info: cachedInfo,
      };
    }

    const memoryDb = createMemoryFirestore();
    cachedDb = memoryDb as unknown as Firestore;
    cachedInfo = {
      isConfigured: true,
      projectId,
      databaseId,
      authMode: 'local_fallback',
      error: initError,
    };

    return {
      db: cachedDb,
      info: cachedInfo,
    };
  }
}

export function resetFirebaseAdminCache(): void {
  cachedDb = null;
  cachedInfo = null;
  initError = null;
}

export function getFirestoreDb(): Firestore {
  const { db, info } = initializeFirebaseAdmin();
  if (!db) {
    throw new Error(
      `Firestore is not initialized. Please ensure Firebase environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) are configured. Details: ${info.error || 'Unknown error'}`
    );
  }
  return db;
}

export function isFirebaseConfigured(): boolean {
  const { info } = initializeFirebaseAdmin();
  return info.isConfigured && info.authMode !== 'not_configured';
}

export function getFirebaseStatus(): FirebaseConfigInfo {
  const { info } = initializeFirebaseAdmin();
  return info;
}

// ----------------------------------------------------
// Memory-backed Firestore Emulation for Offline Sandbox & Testing
// ----------------------------------------------------
function createMemoryFirestore() {
  const store: Record<string, Record<string, any>> = {};

  function getCol(colName: string) {
    if (!store[colName]) store[colName] = {};
    return store[colName];
  }

  class MemDocRef {
    constructor(public colName: string, public docId: string) {}

    get id() {
      return this.docId;
    }

    async get() {
      const col = getCol(this.colName);
      const data = col[this.docId];
      return {
        id: this.docId,
        exists: data !== undefined,
        data: () => (data !== undefined ? JSON.parse(JSON.stringify(data)) : undefined),
      };
    }

    async set(data: any, options?: { merge?: boolean }) {
      const col = getCol(this.colName);
      if (options?.merge && col[this.docId]) {
        col[this.docId] = { ...col[this.docId], ...data };
      } else {
        col[this.docId] = JSON.parse(JSON.stringify(data));
      }
    }

    async update(data: any) {
      const col = getCol(this.colName);
      if (!col[this.docId]) {
        throw new Error(`NOT_FOUND: No document to update: ${this.colName}/${this.docId}`);
      }
      col[this.docId] = { ...col[this.docId], ...data };
    }

    async delete() {
      const col = getCol(this.colName);
      delete col[this.docId];
    }
  }

  class MemQuery {
    private filters: Array<{ field: string; op: string; val: any }> = [];
    private orderBys: Array<{ field: string; dir: 'asc' | 'desc' }> = [];
    private limitVal: number | null = null;

    constructor(public colName: string) {}

    where(field: string, op: string, val: any) {
      const q = new MemQuery(this.colName);
      q.filters = [...this.filters, { field, op, val }];
      q.orderBys = [...this.orderBys];
      q.limitVal = this.limitVal;
      return q;
    }

    orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
      const q = new MemQuery(this.colName);
      q.filters = [...this.filters];
      q.orderBys = [...this.orderBys, { field, dir }];
      q.limitVal = this.limitVal;
      return q;
    }

    limit(n: number) {
      const q = new MemQuery(this.colName);
      q.filters = [...this.filters];
      q.orderBys = [...this.orderBys];
      q.limitVal = n;
      return q;
    }

    async get() {
      const col = getCol(this.colName);
      let docs = Object.entries(col).map(([id, data]) => ({
        id,
        ref: new MemDocRef(this.colName, id),
        exists: true,
        data: () => JSON.parse(JSON.stringify(data)),
      }));

      // Apply where filters
      for (const f of this.filters) {
        docs = docs.filter((d) => {
          const val = d.data()[f.field];
          if (f.op === '==' || f.op === '===') return val === f.val;
          if (f.op === '!=') return val !== f.val;
          if (f.op === '>') return val > f.val;
          if (f.op === '>=') return val >= f.val;
          if (f.op === '<') return val < f.val;
          if (f.op === '<=') return val <= f.val;
          if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(val);
          return true;
        });
      }

      // Apply orderBy
      for (const o of this.orderBys) {
        docs.sort((a, b) => {
          const vA = a.data()[o.field];
          const vB = b.data()[o.field];
          if (vA < vB) return o.dir === 'asc' ? -1 : 1;
          if (vA > vB) return o.dir === 'asc' ? 1 : -1;
          return 0;
        });
      }

      // Apply limit
      if (this.limitVal !== null) {
        docs = docs.slice(0, this.limitVal);
      }

      return {
        docs,
        size: docs.length,
        empty: docs.length === 0,
      };
    }
  }

  class MemCollectionRef extends MemQuery {
    doc(id?: string) {
      const docId = id || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      return new MemDocRef(this.colName, docId);
    }

    async add(data: any) {
      const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const docRef = new MemDocRef(this.colName, docId);
      await docRef.set(data);
      return docRef;
    }
  }

  class MemBatch {
    private operations: Array<() => Promise<void>> = [];

    set(docRef: any, data: any, options?: any) {
      this.operations.push(() => docRef.set(data, options));
      return this;
    }

    update(docRef: any, data: any) {
      this.operations.push(() => docRef.update(data));
      return this;
    }

    delete(docRef: any) {
      this.operations.push(() => docRef.delete());
      return this;
    }

    async commit() {
      for (const op of this.operations) {
        await op();
      }
    }
  }

  return {
    collection(name: string) {
      return new MemCollectionRef(name);
    },
    batch() {
      return new MemBatch();
    },
    async runTransaction(updateFunction: (transaction: any) => Promise<any>) {
      const tx = {
        async get(docRef: any) {
          return docRef.get();
        },
        set(docRef: any, data: any, options?: any) {
          docRef.set(data, options);
          return tx;
        },
        update(docRef: any, data: any) {
          docRef.update(data);
          return tx;
        },
        delete(docRef: any) {
          docRef.delete();
          return tx;
        },
      };
      return await updateFunction(tx);
    },
    async listCollections() {
      return Object.keys(store).map((name) => new MemCollectionRef(name));
    },
  };
}
