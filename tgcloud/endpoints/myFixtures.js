import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {readMyFixtures} from '../lib/myFixturesRead.js';

export default async function(input={},ctx){
 const actor=verifiedTelegramId(ctx);
 try{return await readMyFixtures(db,actor,input);}
 catch(error){
  const code=String(error?.message||'FIXTURES_UNAVAILABLE');
  if(/^(INVALID_FIXTURE_REQUEST|INVALID_SEASON|INVALID_LIMIT|INVALID_CURSOR)$/.test(code))
   throw new EndpointError('Uchrashuvlar so‘rovi noto‘g‘ri.',{code});
  throw error;
 }
}
