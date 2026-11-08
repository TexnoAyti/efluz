import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {readCompetitionDetail} from '../lib/competitionDetail.js';

export default async function(input={},ctx){
  verifiedTelegramId(ctx);
  try{return await readCompetitionDetail(db,input);}
  catch(error){
    const code=String(error?.message||'COMPETITION_ERROR');
    if(/^(INVALID_COMPETITION|INVALID_LIMIT|UNKNOWN_DETAIL_FIELD|COMPETITION_UNAVAILABLE)$/.test(code))
      throw new EndpointError('Musobaqa ma’lumoti mavjud emas.',{code});
    throw error;
  }
}
