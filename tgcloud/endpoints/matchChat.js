import {db,EndpointError} from 'sdk';
import {runMatchChat} from '../lib/matchChatEngine.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';

export default async function(input={},ctx){
  if(input?.action==='send'&&!MUTATION_CONTROL.enabled)
    throw new EndpointError('Staging chat yozish hozircha yopiq.',{code:'SHADOW_WRITE_DISABLED'});
  try{return await runMatchChat(db,input,ctx?.initData?.user?.id);}
  catch(error){
    const code=String(error?.message||'CHAT_FAILED');
    if(/^(AUTH_REQUIRED|INVALID_MATCH|INVALID_CURSOR|INVALID_ACTION|INVALID_MESSAGE|INVALID_CLIENT_ID|CHAT_FORBIDDEN|CHAT_READ_ONLY|CHAT_WRITE_CONFLICT)$/.test(code))
      throw new EndpointError('O‘yin chatiga so‘rov rad etildi.',{code});
    throw error;
  }
}
