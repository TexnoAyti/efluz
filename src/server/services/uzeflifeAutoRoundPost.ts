import {getFirestoreDb} from '../firebase/admin';
import type {UState} from '../../types/uzeflife';
import {requestRoundPost,processPendingRoundPost} from './uzeflifeRoundPost';
/** Preserve the already-authorized first-round auto-post; later rounds require the owner's button/AI request. */
export async function autoPublishUzeflifeFirstRound():Promise<boolean>{
 if(process.env.MIGRATION_WRITE_FREEZE==='true'||process.env.DATABASE_PROVIDER==='supabase'&&process.env.SUPABASE_DATA_NAMESPACE==='preview')return false;
 if(!process.env.TELEGRAM_BOT_TOKEN)return false;
 const db=getFirestoreDb(),state=(await db.collection('uzeflife').doc('championship').get()).data() as UState|undefined;
 if(state?.format==='LEAGUE'&&state.status==='playing'&&state.round===1&&state.matches.filter(m=>m.round===1).length===121){
  const existing=await db.collection('uzeflife_channel_posts').doc('round-1').get();
  if(!existing.exists)await requestRoundPost(state,1,'automatic');
 }
 return processPendingRoundPost();
}
