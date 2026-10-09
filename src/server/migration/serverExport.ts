import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { encodeValue, digest, type ArchivedDocument } from './firestoreArchive';
import { supabaseMigrationRpc, type MigrationRpc } from './supabaseMigration';

export type ExportState = { pendingCollections: string[]; pendingDocuments: string[]; collections: string[] };
export function authorizeExport(method: string, authorization: string, expectedHash: string, expiresAt: number, environment: string): boolean {
  if (method !== 'POST' || environment !== 'preview' || Date.now() >= expiresAt || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  if (!authorization.startsWith('Bearer ')) return false;
  const actual = createHash('sha256').update(authorization.slice(7)).digest();
  return timingSafeEqual(actual, Buffer.from(expectedHash, 'hex'));
}

/** A checkpoint commits documents and the traversal cursor in one PostgreSQL transaction. */
export async function exportStep(db: any, rpc: MigrationRpc, runId: string, source: {projectId:string;databaseId:string}, maxMs=35_000) {
  const leaseId=randomUUID();
  const job=await rpc('efl_export_claim',{p_run_id:runId,p_lease_id:leaseId});
  if(job.status==='VERIFIED') return rpc('efl_export_finish',{p_run_id:runId});
  if(job.source.projectId!==source.projectId || job.source.databaseId!==source.databaseId) throw new Error('SOURCE_MISMATCH');
  const state:ExportState=structuredClone(job.state), documents:ArchivedDocument[]=[];
  const deadline=Date.now()+maxMs;
  let visited=0,bytes=0;
  const prefetched=new Map<string,{snapshot:any;children:any[]}>();
  while(visited<25 && Date.now()<deadline) {
    if(!state.pendingDocuments.length) {
      if(!state.pendingCollections.length) break;
      const collectionPath=state.pendingCollections.shift()!;
      const refs=await db.collection(collectionPath).listDocuments();
      state.collections.push(collectionPath);
      state.pendingDocuments=refs.map((ref:any)=>ref.path);
      continue;
    }
    const documentPath=state.pendingDocuments[0],ref=db.doc(documentPath);
    if(typeof db.getAll==='function'&&!prefetched.has(documentPath)) {
      const paths=state.pendingDocuments.slice(0,25-visited);
      const refs=paths.map(path=>db.doc(path));
      const [snapshots,children]=await Promise.all([
        db.getAll(...refs),Promise.all(refs.map((ref:any)=>ref.listCollections())),
      ]);
      paths.forEach((path,index)=>prefetched.set(path,{snapshot:snapshots[index],children:children[index]}));
    }
    const cached=prefetched.get(documentPath);
    const snapshot=cached?.snapshot??await ref.get();
    let document:ArchivedDocument|undefined;
    if(snapshot.exists) {
      const payload=JSON.stringify(encodeValue(snapshot.data()));
      document={path:documentPath,payload,checksum:digest(payload)};
      const size=Buffer.byteLength(JSON.stringify(document));
      if(size>2_000_000) throw new Error('EXPORT_DOCUMENT_TOO_LARGE');
      if(bytes+size>2_000_000) break;
      bytes+=size;
    }
    const children=cached?.children??await ref.listCollections();
    state.pendingCollections.push(...children.map((child:any)=>child.path));
    state.pendingDocuments.shift();
    if(document) documents.push(document);
    visited++;
  }
  const progress=await rpc('efl_export_step',{p_run_id:runId,p_lease_id:leaseId,p_revision:job.revision,p_state:state,p_documents:documents});
  if(!state.pendingCollections.length&&!state.pendingDocuments.length) return {runId,...await rpc('efl_export_finish',{p_run_id:runId})};
  return {runId,status:'EXPORTING',...progress};
}

export async function createExportSource() {
  if(process.env.FIREBASE_FORCE_LOCAL_FALLBACK==='true') throw new Error('REAL_SOURCE_REQUIRED');
  const source={projectId:process.env.FIREBASE_PROJECT_ID||'',databaseId:process.env.FIRESTORE_DATABASE_ID||''};
  if(!source.projectId||!source.databaseId) throw new Error('SOURCE_CONFIG_REQUIRED');
  const {initializeApp,cert,getApps}=await import('firebase-admin/app');
  const {getFirestore}=await import('firebase-admin/firestore');
  let app=getApps().find(app=>app.name==='efl-readonly-export');
  if(!app) {
    const credentials=process.env.FIREBASE_SERVICE_ACCOUNT_JSON?JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON):{
      projectId:source.projectId,clientEmail:process.env.FIREBASE_CLIENT_EMAIL,privateKey:process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g,'\n')};
    if((credentials.project_id||credentials.projectId)!==source.projectId) throw new Error('SOURCE_PROJECT_MISMATCH');
    app=initializeApp({projectId:source.projectId,credential:cert(credentials)},'efl-readonly-export');
    getFirestore(app,source.databaseId).settings({useBigInt:true});
  }
  return {db:getFirestore(app,source.databaseId),source};
}

// This is bundled into a temporary preview-only deployment, never the production API.
export function exportHandler(expectedHash:string,expiresAt:number) {
  return async (req:any,res:any)=>{
    res.setHeader('Cache-Control','no-store');
    if(!authorizeExport(req.method,req.headers.authorization||'',expectedHash,expiresAt,process.env.VERCEL_ENV||'')) {
      res.statusCode=403;res.end(JSON.stringify({error:'EXPORT_DISABLED_OR_UNAUTHORIZED'}));return;
    }
    let phase='SOURCE_INIT';
    try {
      const {db,source}=await createExportSource(),rpc=supabaseMigrationRpc();
      const runId=req.body?.runId;
      if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(runId||'')) throw new Error('INVALID_RUN_ID');
      if(req.body?.action==='start') {
        phase='SOURCE_CATALOG';
        const roots=await db.listCollections();
        phase='TARGET_START';
        await rpc('efl_export_start',{p_run_id:runId,p_source:source,p_state:{pendingCollections:roots.map((ref:any)=>ref.path),pendingDocuments:[],collections:[]}});
        res.end(JSON.stringify({runId,status:'EXPORTING'}));return;
      }
      if(req.body?.action!=='step') throw new Error('INVALID_ACTION');
      phase='COPY_STEP';
      const result=await exportStep(db,rpc,runId,source);
      res.end(JSON.stringify(result));
    } catch(error:any) {
      // Do not expose SDK errors, keys, document values or internal source paths.
      console.error('[MIGRATION] Export step failed; no source writes were performed');
      const message=typeof error?.message==='string'?error.message:'';
      const rpcFailure=/^SUPABASE_MIGRATION_RPC_FAILED:efl_(?:export|migration)_[a-z_]+:HTTP_\d{3}$/.test(message);
      const safeCodes=new Set(['SOURCE_CONFIG_REQUIRED','SOURCE_PROJECT_MISMATCH','SOURCE_MISMATCH','REAL_SOURCE_REQUIRED','INVALID_RUN_ID','INVALID_ACTION','SUPABASE_SERVER_CREDENTIALS_REQUIRED','EXPORT_DOCUMENT_TOO_LARGE']);
      const reason=rpcFailure||safeCodes.has(message)?message:
        error?.code===7?'SOURCE_PERMISSION_DENIED':error?.code===8?'SOURCE_QUOTA_EXHAUSTED':'REQUEST_FAILED';
      res.statusCode=503;res.end(JSON.stringify({error:'EXPORT_STEP_FAILED',phase,reason}));
    }
  };
}
