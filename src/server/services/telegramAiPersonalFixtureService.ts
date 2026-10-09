import { normalizeAiEntity } from './telegramAiEntities';
import { createAiSnapshotReader } from './telegramAiSnapshotReader';
import { createAiTournamentReader } from './telegramAiDataService';
import { ReadModelKeys, type OwnerNeutralClub } from '../readModel/readModelStore';
import { nextSeasonFixture } from '../../lib/fixtureOrder';
import { findConversationCompetitions, requestedMatchday } from './telegramAiConversationCommands';
import { SEED_COMPETITIONS } from '../db/seed';
import type { Competition, Fixture } from '../../types';

export function isPersonalFixtureQuestion(text: string): boolean {
  const q=normalizeAiEntity(text);
  return /\b(?:raqibim\w*|oyinim\w*|uchrashuvim\w*)\b|\b(?:meni|mening)(?:\s+\w+){0,2}\s+(?:raqib\w*|oyin\w*|uchrashuv\w*)\b|\bmen\s+kim(?:ga|\s+bilan)\b|\bkim(?:ga|\s+bilan)\s+oynay(?:man|miz)\b|\bmy (?:opponent|next match)\b/.test(q) || /мой соперник|с кем я играю/i.test(text);
}

/** Caller ID is Telegram's verified sender, never an @username or previous chat selection. */
export async function buildPersonalFixtureReply(text: string, senderId: number, signal?: AbortSignal): Promise<{text:string;clubIds:string[];fixtureIds?:string[]}> {
  const season='season-2026-27';
  if (!Number.isSafeInteger(senderId) || senderId<=0) return {text:'Telegram akkauntingizni aniqlab bo‘lmadi. Shaxsiy akkauntingizdan yozing.',clubIds:[]};
  const ownership=await createAiSnapshotReader(signal).read<OwnerNeutralClub>(ReadModelKeys.clubsWithOwners(season));
  if (!ownership.available || !ownership.data.length) return {text:'Klub biriktirilganligi haqidagi saqlangan ma’lumot hozir o‘qilmadi. Raqibni taxmin qilmayman; qayta urinib ko‘ring.',clubIds:[]};
  const owned=ownership.data.filter(c=>c.ownerUserId===`user-${senderId}` && (!(c as any).seasonId || (c as any).seasonId===season));
  if (!owned.length) return {text:'Telegram akkauntingizga tasdiqlangan klub biriktirilganligi saqlangan bazada topilmadi. Klub tanlash so‘rovi hali tasdiqlanmagan bo‘lishi mumkin.'+(ownership.stale?' Ma’lumot eski snapshotdan.':''),clubIds:[]};
  const reader=createAiTournamentReader(signal);
  const catalog:any=await reader.read({dataset:'competitions',limit:30});
  const named=findConversationCompetitions(text,(catalog.data||[]) as Competition[]);
  const explicitCup = /\b(?:kub(?:ok|og)\w*|cup|copa|pokal)\b/.test(normalizeAiEntity(text));
  if (!named.length && (explicitCup || findConversationCompetitions(text,SEED_COMPETITIONS as unknown as Competition[]).length)) return {text:'So‘ralgan turnir saqlangan musobaqalar ro‘yxatida topilmadi. Boshqa turnirdagi raqibni bunga almashtirmayman.',clubIds:owned.map(c=>c.id)};
  const round=requestedMatchday(text);
  const blocks:string[]=[];
  const fixtureIds:string[]=[];
  let stale=ownership.stale || Boolean(catalog.stale);
  for (const club of owned) {
    const query={dataset:'fixtures',club:club.id,...(named.length===1?{competition:named[0].id}:{}),...(round?{matchday:round}:{})};
    if (named.length>1) return {text:'Qaysi bitta liga yoki kubokdagi raqibingizni aytay?',clubIds:owned.map(c=>c.id)};
    const result:any=await reader.read({...query,limit:30});
    stale ||= Boolean(result.stale) || Boolean(result.missingDatasets?.length);
    const games:any[]=[...(result.data||[])];
    for(let offset=30;offset<(result.total||0);offset+=30){const page:any=await reader.read({...query,offset,limit:30});games.push(...(page.data||[]));stale ||= Boolean(page.stale);}
    const next=nextSeasonFixture(games as Fixture[]);
    if(!next){
      blocks.push(`${club.name}: ${round?round+'-turdagi':'navbatdagi'} yakunlanmagan o‘yin saqlangan jadvalda topilmadi. Bu boshqa o‘yin yo‘qligini kafolatlamaydi.`);
      continue;
    }
    fixtureIds.push(next.id);
    const f=games.find(g=>g.id===next.id)!;
    const atHome=f.homeClubId===club.id;
    const opponentId=atHome?f.awayClubId:f.homeClubId;
    const opponent=ownership.data.find(c=>c.id===opponentId);
    const opponentName=opponent?.name || (atHome?f.away:f.home);
    if(!opponentId || !opponentName || opponentName==='Raqib aniqlanmagan'){
      blocks.push(`${club.name}: navbatdagi uchrashuv bor, ammo raqib hali aniqlanmagan. ${f.competition || 'Turnir'} · ${f.roundName || f.matchday+'-tur'}.`);
      continue;
    }
    const username=opponent?.ownerUsername?.replace(/^@/,'') || '';
    const owner=/^[A-Za-z0-9_]{5,32}$/.test(username) && opponent?.ownerUserId ? `\nRaqib egasi: @${username}.` : '';
    const state:Record<string,string>={SCHEDULED:'rejalashtirilgan',POSTPONED:'qoldirilgan',AWAITING_RESULT:'natija kutilmoqda',PENDING_CONFIRMATION:'natija tasdiqlanishi kutilmoqda',DISPUTED:'natija ko‘rib chiqilmoqda'};
    blocks.push(`Sizning klubingiz: ${club.name}.\nRaqibingiz: ${opponentName}.${owner}\n${f.competition || 'Turnir'} · ${f.roundName || f.matchday+'-tur'} · ${atHome?'uyda':'safarda'}.\nHolat: ${state[f.status] || f.status}.`);
  }
  return {text:blocks.join('\n\n')+(stale?'\n\nOxirgi saqlangan ma’lumot; joriy holat qayta tekshirilmagan.':''),clubIds:owned.map(c=>c.id),fixtureIds:[...new Set(fixtureIds)]};
}
