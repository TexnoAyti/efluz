import {SEASON_2026_27_ALLOCATION,withSeasonQualificationPolicy} from '../../lib/seasonQualificationPolicy';
import {tournamentImageBranding} from '../../lib/tournamentImageBranding';
import assert from 'node:assert/strict';
import { canExportTournamentImage, imageFilename, matchdayImageModel, standingsImageModel, paintTournamentImage } from '../../lib/tournamentImage';
import type { Club, Fixture, StandingsRow } from '../../types';
assert.equal(canExportTournamentImage(null),false);
assert.equal(canExportTournamentImage({isAdmin:false,isSuspended:false}),false);
assert.equal(canExportTournamentImage({isAdmin:true,isSuspended:true}),false);
assert.equal(canExportTournamentImage({isAdmin:true,isSuspended:false}),true);
const standings: StandingsRow[] = Array.from({length:20},(_,index)=>({position:20-index,clubId:'club-'+index,clubName:'Team '+index,shortName:'T',played:index,won:1,drawn:2,lost:3,goalsFor:5,goalsAgainst:6,goalDifference:-1,points:index}));
const table=standingsImageModel('La Liga','season-2026-27',standings,'uz');
assert.equal(table.rows.length,20);assert.equal(table.rows[0].position,1);assert.equal(standings[0].position,20);
assert.deepEqual(table.rows[0].stats,[19,1,2,3,5,6,-1,19]);
const fixture=(id:string,status:string,matchday=10,seasonId='season-2026-27'):Fixture=>({id,competitionId:'comp-serie-a-2026',seasonId,matchday,status:status as any,homeClubId:'club-inter',awayClubId:'club-milan',homeScore:0,awayScore:0,scheduledAt:'',createdAt:'',updatedAt:''});
const matches=matchdayImageModel('Serie A','season-2026-27',[fixture('id-md1','CONFIRMED'),fixture('pending','PENDING_CONFIRMATION'),fixture('disputed','DISPUTED'),fixture('old','CONFIRMED',10,'season-2025-26'),fixture('wrong-round','CONFIRMED',1)],10,'uz');
assert.equal(matches.rows.length,3);assert.equal(matches.rows.find(row=>row.score==='0 : 0')?.id,'club-inter');
assert.equal(matches.rows.filter(row=>row.score==='VS'&&row.status==='Tekshiruvda').length,2);
assert.equal(matches.round,'10-tur');assert.equal(imageFilename('../comp:x','matchday',10),'efluz-compx-matchday-10.png');
assert.equal(matchdayImageModel('Serie A','season-2026-27',[{...fixture('round','CONFIRMED'),roundName:'Matchday 10'}],10,'uz').round,'10-tur');
assert.equal(matchdayImageModel('Cup','season-2026-27',[{...fixture('cup','CONFIRMED'),roundName:'Final'}],10,'uz').round,'Final');
assert.equal(matchdayImageModel('League','season-2026-27',[{...fixture('win','CONFIRMED'),homeScore:3,awayScore:1}],10,'uz').rows[0].winner,'home');
assert.equal(matchdayImageModel('League','season-2026-27',[{...fixture('pending-win','PENDING_CONFIRMATION'),homeScore:3,awayScore:1}],10,'uz').rows[0].winner,undefined);
const drawn:string[]=[];
const ctx:any={canvas:{width:0,height:0},fillRect(){},beginPath(){},roundRect(){},fill(){},measureText(text:string){return{width:text.length*10}},fillText(text:string){drawn.push(text)},drawImage(){}};
paintTournamentImage(ctx,table);
assert.equal(ctx.canvas.width,1080);assert.ok(ctx.canvas.height>1500);
for(const row of standings)assert.ok(drawn.includes(row.clubName),'All table rows included, without viewport clipping');
assert.ok(drawn.includes('t.me/efluzbot'));
drawn.length=0;paintTournamentImage(ctx,matches);assert.ok(drawn.includes('0 : 0'));assert.ok(drawn.includes('Tekshiruvda'));
assert.equal(matchdayImageModel('Cup','season-2026-27',[{...fixture('tbd','SCHEDULED'),homeClubId:null,awayClubId:null}],10,'en').rows[0].name,'TBD');
console.log('PASS full-table PNG layout, stable standings statistics, canonical matchday selection, season isolation, zero-score draws, exclusion of unconfirmed scores and safe filenames');

const league:any={seasonId:'season-2026-27',id:'comp-premier-league-2026',leagueId:'league-premier-league',type:'LEAGUE',formatConfig:{qualificationSpots:5}};
const branding=tournamentImageBranding(league,[league],20);
assert.deepEqual(branding.zones.map(z=>[z.label,z.start,z.end]),[['UCL',1,7],['UEL',8,14],['↓',18,20]]);
assert.equal(branding.emblemUrl,'/export-emblems/premier-league.svg');
const overrides:any[]=[league,{id:'comp-champions-league-2026',formatConfig:{qualificationSlots:{[league.id]:7}}},{id:'comp-europa-league-2026',formatConfig:{qualificationSlots:{[league.id]:7}}}];
assert.deepEqual(tournamentImageBranding(league,overrides,20).zones.slice(0,2).map(z=>[z.start,z.end]),[[1,7],[8,14]]);
assert.equal(tournamentImageBranding({...league,type:'KNOCKOUT'},[league],20).zones.length,0);
assert.equal(tournamentImageBranding({...league,seasonId:'season-2027-28',formatConfig:{}},[],20).zones.some(z=>z.label==='UCL'),false);
table.branding=branding;drawn.length=0;paintTournamentImage(ctx,table);assert.ok(drawn.includes('UCL 1–7'));assert.ok(drawn.includes('UEL 8–14'));
console.log('PASS PNG qualification zones follow engine config/overrides, no invented allocation, transparent emblem selection and visible zone legend');

assert.equal(Object.values(SEASON_2026_27_ALLOCATION).reduce((a,b)=>a+b,0),32);
for(const [id,n] of Object.entries(SEASON_2026_27_ALLOCATION)){
 const old:any={id,seasonId:'season-2026-27',leagueId:id.replace('comp-','league-').replace('-2026',''),type:'LEAGUE',formatConfig:{qualificationSpots:5}};
 assert.deepEqual(tournamentImageBranding(old,[old],id.includes('bundesliga')||id.includes('ligue-1')?18:20).zones.slice(0,2).map(z=>[z.start,z.end]),[[1,n],[n+1,2*n]]);
 assert.equal(old.formatConfig.qualificationSpots,5,'Normalization must not mutate cached snapshots');
 assert.equal(withSeasonQualificationPolicy(old,'season-2027-28'),old,'Other seasons are unchanged');
}
console.log('PASS confirmed 7/7/6/6/6 zones, 32+32 totals, old-cache correction and season isolation');

// Ownership is joined by club ID, independently of row sorting and home/away orientation.
const ownedClubs = [
  {id:'club-19',claimedByUsername:'@@table_owner'},
  {id:'club-inter',claimedByUsername:'@inter_owner'},
  {id:'club-milan',occupancy:{status:'owned',username:'milan_owner'}},
] as Club[];
const ownedTable=standingsImageModel('League','season-2026-27',standings,'uz',ownedClubs);
assert.equal(ownedTable.rows[0].ownerUsername,'table_owner');
assert.equal(ownedTable.rows[1].ownerUsername,undefined);
assert.deepEqual(ownedTable.rows.map(r=>r.stats),table.rows.map(r=>r.stats));
const historicFixture={...fixture('owned','CONFIRMED'),homeUser:{id:'old',username:'old_owner'},awayUser:{id:'wrong',username:'wrong_owner'}} as Fixture;
const ownedMatches=matchdayImageModel('League','season-2026-27',[historicFixture],10,'uz',ownedClubs);
assert.equal(ownedMatches.rows[0].ownerUsername,'inter_owner');
assert.equal(ownedMatches.rows[0].awayOwnerUsername,'milan_owner');
assert.equal(matchdayImageModel('League','season-2026-27',[historicFixture],10,'uz').rows[0].ownerUsername,'old_owner','Embedded ownership is used only without a current club snapshot');
const released=matchdayImageModel('League','season-2026-27',[historicFixture],10,'uz',[{id:'club-inter',occupancy:{status:'available'}} as Club]);
assert.equal(released.rows[0].ownerUsername,undefined,'Released clubs must not retain a historical owner');
for(const username of ['tg_123456','user_123456','not a username','<script>']){
  assert.equal(standingsImageModel('League','season-2026-27',standings,'uz',[{id:'club-19',claimedByUsername:username} as Club]).rows[0].ownerUsername,undefined);
}
drawn.length=0;paintTournamentImage(ctx,ownedTable);assert.ok(drawn.includes('@table_owner'));
drawn.length=0;paintTournamentImage(ctx,ownedMatches);
assert.ok(drawn.includes('@inter_owner'));assert.ok(drawn.includes('@milan_owner'));assert.ok(!drawn.includes('@old_owner'));assert.ok(drawn.includes('0 : 0'));
// Long handles stay inside their club cell and never reach statistics or the score column.
const longModel=standingsImageModel('League','season-2026-27',standings,'uz',[{id:'club-19',claimedByUsername:'a'.repeat(32)} as Club]);
drawn.length=0;paintTournamentImage(ctx,longModel);
const handle=drawn.find(value=>value.startsWith('@'))!;
assert.ok(handle.endsWith('…'));assert.ok(ctx.measureText(handle).width<=317);
console.log('PASS current owner usernames by club ID, home/away separation, released and invalid owners omitted, owner text clipping and unchanged statistics/scores');
