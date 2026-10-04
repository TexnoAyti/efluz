import assert from 'node:assert/strict';
import { SEED_CLUBS } from '../db/seed';
import { buildAiGroundingContext,setTestGroundingOverride } from '../services/telegramAiGroundingService';
import { detectAiCupStage } from '../services/telegramAiCupStage';
const season='season-2026-27',cup='comp-fa-cup-2026';
const competition={id:cup,name:'FA Cup',type:'KNOCKOUT',seasonId:season,leagueId:'league-premier-league',formatConfig:{}} as any;
const fixtures=Array.from({length:16},(_,i)=>({id:'completed-'+i,seasonId:season,competitionId:cup,matchday:i<4?1:i<12?2:3,
  roundName:i<4?'Preliminary Round':i<12?'Round of 16':'Quarter-Finals',homeClubId:'club-arsenal',awayClubId:'club-chelsea',status:'CONFIRMED',homeScore:2,awayScore:1}));
fixtures.push(...[
  {id:'semi-1',seasonId:season,competitionId:cup,matchday:4,roundName:'Semi-Finals',homeClubId:'club-arsenal',awayClubId:'club-aston-villa',status:'SCHEDULED',homeScore:null,awayScore:null},
  {id:'semi-2',seasonId:season,competitionId:cup,matchday:4,roundName:'Semi-Finals',homeClubId:'club-newcastle',awayClubId:'club-fulham',status:'SCHEDULED',homeScore:null,awayScore:null},
  {id:'final',seasonId:season,competitionId:cup,matchday:5,roundName:'Final',homeClubId:null,awayClubId:null,status:'SCHEDULED',homeScore:null,awayScore:null},
] as any[]);
try {
  setTestGroundingOverride({competitions:[competition],clubs:SEED_CLUBS as any,fixtures:{[cup]:fixtures as any},standings:{}});
  for(const query of ['Angliya Kubogi yarim final','FA Cup semi-finals','FA Cup 1/2 final','FA Cup полуфинал']){
    const result=await buildAiGroundingContext(query);
    assert.ok(result.factualAnswer?.includes('Arsenal — Aston Villa') && result.factualAnswer?.includes('Newcastle United — Fulham'));
    assert.ok(result.factualAnswer?.includes('rejalashtirilgan, hali yakunlanmagan'));
    assert.ok(!result.factualAnswer?.includes('rasmiy ma’lumot') && !result.factualAnswer?.includes('jadval tasdiqlanmagan'));
    assert.ok(result.factsSummary.includes('SO‘RALGAN BOSQICH'));
  }
  const withOldTeam=await buildAiGroundingContext('Angliya Kubogi yarim final',undefined,{selectedClubIds:['club-ipswich']});
  assert.ok(withOldTeam.factualAnswer?.includes('Arsenal — Aston Villa') && withOldTeam.factualAnswer?.includes('Newcastle United — Fulham'), 'Old selected team cannot hide the whole requested stage');
  const followup=await buildAiGroundingContext('yarim final',undefined,{previousUserQueries:['Angliya Kubogi']});
  assert.ok(followup.factualAnswer?.includes('Arsenal — Aston Villa'));
  assert.equal(detectAiCupStage('nimchorak final'),'round16');
  assert.equal(detectAiCupStage('chorak final'),'quarter');
  assert.equal(detectAiCupStage('yarim final'),'semi');
  assert.equal(detectAiCupStage('final'),'final');
  assert.ok((await buildAiGroundingContext('Angliya Kubogi final')).factualAnswer?.includes('Raqib aniqlanmagan — Raqib aniqlanmagan'));
  console.log('PASS user-reported FA Cup question: exact two scheduled semifinal pairs bypass Gemini; multilingual stages, final separation, old-team and cup follow-up context');

  // Eighteen-team cup uses a different matchday number for the same named stage.
  const german='comp-dfb-pokal-2026';
  setTestGroundingOverride({competitions:[{...competition,id:german,name:'DFB-Pokal',leagueId:'league-bundesliga'}],clubs:SEED_CLUBS as any,standings:{},fixtures:{[german]:[{...fixtures[16],id:'german-semi',competitionId:german,matchday:3} as any]}});
  assert.ok((await buildAiGroundingContext('Germaniya kubogi yarim final')).factualAnswer?.includes('Arsenal — Aston Villa'), 'Stage selection uses stored stage names rather than fixed round numbers');
  setTestGroundingOverride({competitions:[competition],clubs:SEED_CLUBS as any,standings:{},fixtures:{[cup]:fixtures.slice(0,16) as any}});
  const absent=await buildAiGroundingContext('Angliya kubogi yarim final');
  assert.ok(absent.factualAnswer?.includes('snapshotda topilmadi'));
  assert.ok(!absent.factualAnswer?.includes('Arsenal — Aston Villa'));
  const unscoped=await buildAiGroundingContext('yarim final');
  assert.ok(unscoped.factualAnswer?.includes('Qaysi kubok'));
  console.log('PASS variable cup formats and truthful missing-stage/unknown-cup handling');
}finally{setTestGroundingOverride(null);}
