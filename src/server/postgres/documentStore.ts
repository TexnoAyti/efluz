import { randomUUID } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { encodeValue, decodeValue } from '../migration/firestoreArchive';
import { migrationHeaders } from '../migration/supabaseMigration';

export type RuntimeRpc = (name: string, body: Record<string, any>) => Promise<any>;
const conflict = () => Object.assign(new Error('POSTGRES_TRANSACTION_CONFLICT'), { code: 10 });
function clean(value: any): any {
  if (Array.isArray(value)) return value.map(v => v === undefined ? null : clean(v));
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).map(([k,v]) => [k,clean(v)]));
  return value;
}
function safeIntegers(value: any): any {
  if (typeof value === 'bigint') {
    if(value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('UNSAFE_DATABASE_INTEGER');
    return Number(value);
  }
  if(Array.isArray(value)) return value.map(safeIntegers);
  if(value && Object.getPrototypeOf(value)===Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,safeIntegers(v)]));
  return value;
}
const fieldName = (field: any) => field instanceof FieldPath && field.isEqual(FieldPath.documentId()) ? '__name__' : String(field);
function pathCheck(path: string, document: boolean) {
  const parts=path.split('/');
  if(parts.some(p=>!p)||parts.length%2!==(document?0:1)) throw new Error('INVALID_DATABASE_PATH');
}
export function runtimeRpc(): RuntimeRpc {
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key||new URL(url).protocol!=='https:') throw new Error('SUPABASE_SERVER_CONFIG_REQUIRED');
  return async(name,body)=>{
    const started = Date.now();
    const target = body.p_query?.collection || body.p_query?.path?.split('/').slice(0,-1).join('/') || 'commit';
    try {
    const response=await fetch(`${url.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{
      method:'POST',headers:migrationHeaders(key),body:JSON.stringify(body),signal:AbortSignal.timeout(15000),
    });
    if(!response.ok) {
      const error=await response.json().catch(()=>({}));
      if(error.code==='40001') throw conflict();
      const safe=['RUNTIME_FROZEN','DOCUMENT_NOT_FOUND','DOCUMENT_ALREADY_EXISTS','INVALID_QUERY','UNKNOWN_RUNTIME_SPACE'];
      const code=safe.includes(error.message)?error.message:`POSTGRES_RPC_HTTP_${response.status}`;
      throw Object.assign(new Error(code),{code:error.message==='DOCUMENT_NOT_FOUND'?5:error.message==='DOCUMENT_ALREADY_EXISTS'?6:undefined});
    }
    const result = await response.json();
    if (Date.now()-started > 2000) console.warn('[POSTGRES_RPC_SLOW]', {name,target,ms:Date.now()-started});
    return result;
    } catch (error: any) {
      console.error('[POSTGRES_RPC_FAILED]', {name,target,ms:Date.now()-started,message:error?.message});
      throw error;
    }
  };
}

class Snapshot {
  readonly id:string;readonly exists:boolean;
  constructor(public ref:DocRef,private encoded:any){this.id=ref.id;this.exists=encoded!==null;}
  data(){return this.exists?safeIntegers(decodeValue(this.encoded)):undefined;}
  get(field:string){return field.split('.').reduce((v,k)=>v?.[k],this.data());}
}
class DocRef {
  readonly id:string;readonly parent:Query;
  constructor(public firestore:PostgresDocumentStore,public path:string){
    pathCheck(path,true);this.id=path.split('/').at(-1)!;this.parent=firestore.collection(path.split('/').slice(0,-1).join('/'));
  }
  collection(path:string){return this.firestore.collection(`${this.path}/${path}`);}
  async get(){const result=await this.firestore.read({path:this.path});return new Snapshot(this,result.documents[0]?.encoded??null);}
  set(data:any,options?:{merge?:boolean}){return this.firestore.write([{path:this.path,kind:'set',encoded:encodeValue(clean(data)),merge:options?.merge===true}]);}
  update(data:any){return this.firestore.write([{path:this.path,kind:'update',encoded:encodeValue(clean(data))}]);}
  create(data:any){return this.firestore.write([{path:this.path,kind:'create',encoded:encodeValue(clean(data))}]);}
  delete(){return this.firestore.write([{path:this.path,kind:'delete'}]);}
}
type QuerySpec={collection?:string;path?:string;filters?:any[];orders?:any[];limit?:number;cursor?:any;count?:boolean};
class Query {
  readonly id:string;
  constructor(public firestore:PostgresDocumentStore,public path:string,public spec:QuerySpec={}) {pathCheck(path,false);this.id=path.split('/').at(-1)!;}
  private copy(patch:Partial<QuerySpec>){return new Query(this.firestore,this.path,{...this.spec,...patch});}
  doc(id:string=randomUUID()){return this.firestore.doc(`${this.path}/${id}`);}
  async add(data:any){const ref=this.doc();await ref.create(data);return ref;}
  where(field:any,op:string,value:any){
    if(!['==','!=','>','>=','<','<=','in','not-in','array-contains','array-contains-any'].includes(op)) throw new Error('UNSUPPORTED_QUERY_OPERATOR');
    return this.copy({filters:[...(this.spec.filters||[]),{field:fieldName(field),op,value:clean(value)}]});
  }
  orderBy(field:any,direction:'asc'|'desc'='asc'){return this.copy({orders:[...(this.spec.orders||[]),{field:fieldName(field),direction}]});}
  limit(limit:number){if(!Number.isInteger(limit)||limit<1)throw new Error('INVALID_QUERY_LIMIT');return this.copy({limit});}
  startAfter(cursor:Snapshot|string){
    if(typeof cursor==='string') {
      if(this.spec.orders?.some(o=>o.field!=='__name__')) throw new Error('ORDERED_CURSOR_REQUIRES_SNAPSHOT');
      return this.copy({cursor:{id:cursor,data:{}}});
    }
    if(!cursor.exists)throw new Error('MISSING_CURSOR');
    return this.copy({cursor:{id:cursor.id,data:clean(cursor.data())}});
  }
  count(){return {get:async()=>{const r=await this.firestore.read({...this.spec,collection:this.path,count:true});return {data:()=>({count:r.count})};}};}
  snapshot(result:any){const docs=result.documents.map((d:any)=>new Snapshot(this.doc(d.id),d.encoded));return {docs,size:docs.length,empty:docs.length===0,forEach:(fn:any)=>docs.forEach(fn)};}
  async get(){return this.snapshot(await this.firestore.read({...this.spec,collection:this.path}));}
}
type Write={path:string;kind:string;encoded?:any;merge?:boolean};
class Writes {
  operations:Write[]=[];
  constructor(public db:PostgresDocumentStore){}
  set(ref:DocRef,data:any,options?:{merge?:boolean}){this.operations.push({path:ref.path,kind:'set',encoded:encodeValue(clean(data)),merge:options?.merge===true});return this;}
  update(ref:DocRef,data:any){this.operations.push({path:ref.path,kind:'update',encoded:encodeValue(clean(data))});return this;}
  create(ref:DocRef,data:any){this.operations.push({path:ref.path,kind:'create',encoded:encodeValue(clean(data))});return this;}
  delete(ref:DocRef){this.operations.push({path:ref.path,kind:'delete'});return this;}
  commit(){return this.db.write(this.operations);}
}
class Transaction extends Writes {
  generation:string|undefined;
  async get(target:DocRef|Query):Promise<any>{
    if(this.operations.length)throw new Error('TRANSACTION_READ_AFTER_WRITE');
    const result=await this.db.read(target instanceof DocRef?{path:target.path}:{...target.spec,collection:target.path});
    if(this.generation!==undefined&&this.generation!==result.generation)throw conflict();
    this.generation=result.generation;
    return target instanceof DocRef?new Snapshot(target,result.documents[0]?.encoded??null):target.snapshot(result);
  }
  commit(){return this.db.write(this.operations,this.generation);}
}
export class PostgresDocumentStore {
  readonly projectId='efluz-supabase';readonly databaseId:string;
  constructor(private rpc:RuntimeRpc=runtimeRpc(),space=process.env.SUPABASE_DATA_NAMESPACE){
    if(!space||!['preview','production'].includes(space))throw new Error('SUPABASE_DATA_NAMESPACE_REQUIRED');
    this.databaseId=space;
  }
  collection(path:string){return new Query(this,path);}
  doc(path:string){return new DocRef(this,path);}
  batch(){return new Writes(this);}
  async read(query:QuerySpec){
    const result=await this.rpc('efl_runtime_read',{p_space:this.databaseId,p_query:query});
    // Fail closed at the server bound instead of silently omitting documents.
    if(query.limit===undefined&&!query.count&&result.documents?.length>=10000) throw new Error('QUERY_REQUIRES_PAGINATION');
    return result;
  }
  write(operations:Write[],generation?:string){return this.rpc('efl_runtime_commit',{p_space:this.databaseId,p_operations:operations,p_generation:generation??null});}
  async runTransaction<T>(callback:(transaction:Transaction)=>Promise<T>):Promise<T>{
    for(let attempt=0;attempt<7;attempt++){
      const tx=new Transaction(this);
      try{const result=await callback(tx);await tx.commit();return result;}
      catch(error:any){if(error.code!==10||attempt===6)throw error;await new Promise(resolve=>setTimeout(resolve,20*(attempt+1)+Math.random()*30));}
    }
    throw conflict();
  }
}
