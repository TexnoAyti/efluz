import assert from 'node:assert/strict';
import {mapEflReadRequest,normalizeEflReadResponse} from '../../lib/serverlessRequestGateway';

// No network, no production database, no Telegram credentials.
assert.deepEqual(mapEflReadRequest('/api/competitions?seasonId=season-2026-27'),{
 operation:'competitions',input:{seasonId:'season-2026-27',limit:100},shape:'competitions'
});
assert.deepEqual(mapEflReadRequest('/api/me/matches?seasonId=season-2026-27'),{
 operation:'myFixtures',input:{seasonId:'season-2026-27',limit:100},shape:'fixtures'
});
assert.deepEqual((normalizeEflReadResponse(mapEflReadRequest('/api/competitions'),{ok:true,competitions:[]}) as {competitions:unknown[]}).competitions,[]);
assert.deepEqual(mapEflReadRequest('/api/seasons'),{
 operation:'seasons',input:{},shape:'seasons'
});
const validSeasons=normalizeEflReadResponse(mapEflReadRequest('/api/seasons'),{
 ok:true,seasons:[{id:'season-2026-27',name:'2026/27',status:'active',startDate:'',createdAt:''}]
}) as {seasons:Array<{id:string}>};
assert.equal(validSeasons.seasons[0].id,'season-2026-27');
assert.throws(()=>normalizeEflReadResponse(mapEflReadRequest('/api/seasons'),{
 ok:true,seasons:[{id:'invalid',name:'Other',status:'active'}]
}),/SERVERLESS_SEASON_CONTRACT_MISMATCH/);
assert.deepEqual(mapEflReadRequest('/api/leagues?seasonId=season-2026-27'),{
 operation:'leagues',input:{seasonId:'season-2026-27'},shape:'leagues'
});
const leagues=normalizeEflReadResponse(mapEflReadRequest('/api/leagues'),{
 ok:true,leagues:[{id:'league-a',name:'La Liga',country:'Spain',logoUrl:'',capacity:20}]
}) as {leagues:Array<{totalClubs:number;tier:number}>};
assert.equal(leagues.leagues[0].totalClubs,20);
assert.equal(leagues.leagues[0].tier,1);

const leagueClubsRequest=mapEflReadRequest('/api/leagues/league-la-liga/clubs?seasonId=season-2026-27');
assert.deepEqual(leagueClubsRequest,{operation:'leagueClubs',input:{
 seasonId:'season-2026-27',leagueId:'league-la-liga'
},shape:'leagueClubs'});
const leagueClubs=normalizeEflReadResponse(leagueClubsRequest,{
 ok:true,clubs:[{id:'club-a',name:'Example',leagueId:'league-la-liga',
 country:'Spain',shortName:'EX',isTaken:true,isCurrentUserClub:false}]
}) as {clubs:Array<{isTaken:boolean;isCurrentUserClub:boolean}>};
assert.equal(leagueClubs.clubs[0].isTaken,true);
assert.equal(leagueClubs.clubs[0].isCurrentUserClub,false);
assert.throws(()=>mapEflReadRequest('/api/leagues/league-la-liga/clubs'),
 /SERVERLESS_ROUTE_NOT_MIGRATED/);
assert.throws(()=>normalizeEflReadResponse(leagueClubsRequest,{
 ok:true,clubs:[{id:'club-a',name:'Example',leagueId:'league-la-liga'}]
}),/SERVERLESS_CLUB_CONTRACT_MISMATCH/);

const clubDetailRequest=mapEflReadRequest('/api/clubs/club-a?seasonId=season-2026-27');
assert.deepEqual(clubDetailRequest,{operation:'clubDetail',
 input:{clubId:'club-a',seasonId:'season-2026-27'},shape:'clubDetail'});
const clubDetails=normalizeEflReadResponse(clubDetailRequest,{ok:true,
 club:{id:'club-a',name:'Club A',shortName:'A',country:'Spain',leagueId:'league-a',isTaken:1}
}) as {club:{id:string;isTaken:boolean}};
assert.equal(clubDetails.club.id,'club-a');
assert.equal(clubDetails.club.isTaken,false);
const clubFixturesRequest=mapEflReadRequest('/api/clubs/club-a/fixtures?seasonId=season-2026-27');
assert.deepEqual(clubFixturesRequest,{operation:'clubFixtures',
 input:{clubId:'club-a',seasonId:'season-2026-27'},shape:'clubFixtures'});
const readFixture={id:'fixture-one',seasonId:'season-2026-27',
 competitionId:'cup-1',status:'SCHEDULED',round:2};
const clubFixtures=normalizeEflReadResponse(clubFixturesRequest,
 {ok:true,fixtures:[readFixture]}) as {fixtures:Array<{matchday:number}>};
assert.equal(clubFixtures.fixtures[0].matchday,2);
const dated=normalizeEflReadResponse(clubFixturesRequest,{ok:true,fixtures:[{
 ...readFixture,scheduledAt:1790000000,homeScore:2,awayScore:1
}]}) as {fixtures:Array<{scheduledAt:string;homeScore:number;awayScore:number}>};
assert.equal(dated.fixtures[0].scheduledAt,new Date(1790000000*1000).toISOString());
assert.equal(dated.fixtures[0].homeScore,2);
assert.equal(dated.fixtures[0].awayScore,1);
assert.throws(()=>normalizeEflReadResponse(clubFixturesRequest,{ok:true,fixtures:[{
 ...readFixture,homeScore:-1
}]}),/SERVERLESS_SCORE_CONTRACT_MISMATCH/);
const fixtureDetailsRequest=mapEflReadRequest('/api/fixtures/fixture-one');
assert.deepEqual(fixtureDetailsRequest,{operation:'fixtureDetail',
 input:{fixtureId:'fixture-one'},shape:'fixtureDetail'});
const fixtureDetails=normalizeEflReadResponse(fixtureDetailsRequest,
 {ok:true,fixture:readFixture}) as {fixture:{matchday:number}};
assert.equal(fixtureDetails.fixture.matchday,2);
assert.throws(()=>mapEflReadRequest('/api/clubs/club-a'),/SERVERLESS_ROUTE_NOT_MIGRATED/);
assert.throws(()=>normalizeEflReadResponse(fixtureDetailsRequest,
 {ok:true,fixture:{id:'fixture-one',status:'SCHEDULED',round:1}}),
 /SERVERLESS_FIXTURE_CONTRACT_MISMATCH/);

const adminScope=mapEflReadRequest('/api/admin/scoped/overview?seasonId=season-2026-27');
assert.deepEqual(adminScope,{operation:'adminScopedOverview',
 input:{seasonId:'season-2026-27',cursor:0,limit:100},shape:'adminScopedOverview'});
const adminRaw={ok:true,seasonId:'season-2026-27',
 leagues:[{id:'league-a',seasonId:'season-2026-27',name:'La Liga'}],
 competitions:[{id:'competition-a',seasonId:'season-2026-27',status:'ACTIVE'}],
 clubs:[{id:'club-a',leagueId:'league-a',name:'Example'}],
 fixtures:[{id:'fixture-a',seasonId:'season-2026-27',competitionId:'competition-a',
   status:'SCHEDULED',round:1}],nextCursor:null};
const adminResult=normalizeEflReadResponse(adminScope,adminRaw) as
 {fixtures:Array<{matchday:number}>;competitions:Array<{status:string}>};
assert.equal(adminResult.fixtures[0].matchday,1);
assert.equal(adminResult.competitions[0].status,'active');
assert.throws(()=>normalizeEflReadResponse(adminScope,{...adminRaw,
 seasonId:'season-2027-28'}),/SERVERLESS_ADMIN_OVERVIEW_CONTRACT_MISMATCH/);
assert.throws(()=>normalizeEflReadResponse(adminScope,{...adminRaw,
 competitions:[{id:'competition-a',seasonId:'season-2027-28',status:'ACTIVE'}]}),
 /SERVERLESS_ADMIN_CROSS_SEASON_DATA/);
assert.throws(()=>normalizeEflReadResponse(adminScope,{...adminRaw,
 nextCursor:-1}),/SERVERLESS_ADMIN_CURSOR_INVALID/);

const bracket=mapEflReadRequest('/api/competitions/comp-fa-cup-2026/fixtures?seasonId=season-2026-27');
assert.deepEqual(bracket,{operation:'competitionDetail',input:{
  competitionId:'comp-fa-cup-2026',seasonId:'season-2026-27',limit:100
},shape:'competitionFixtures'});
const fixtureResult=normalizeEflReadResponse(bracket,{
  ok:true,competition:{id:'comp-fa-cup-2026'},
  fixtures:[{id:'fixture-one',round:1,status:'SCHEDULED',homeClubId:'a',awayClubId:'b'}]
}) as {fixtures:Array<{matchday:number}>};
assert.equal(fixtureResult.fixtures[0].matchday,1);
assert.throws(()=>normalizeEflReadResponse(bracket,{ok:true,competition:{},fixtures:[{id:'x',status:'SCHEDULED',round:'bad'}]}),/SERVERLESS_FIXTURE_ROUND_INVALID/);

for(const [endpoint,method,code] of [
 ['/api/admin/fixtures/x/result','POST','SERVERLESS_WRITE_NOT_MIGRATED'],
 ['/api/auth/telegram','POST','SERVERLESS_WRITE_NOT_MIGRATED'],
 ['/api/admin/overview','GET','SERVERLESS_ROUTE_NOT_MIGRATED'],
 ['/api/competitions/cup/fixtures?matchday=1','GET','SERVERLESS_ROUTE_NOT_MIGRATED'],
 ['/api/me/matches?status=CONFIRMED','GET','SERVERLESS_ROUTE_NOT_MIGRATED'],
 ['https://efluz.vercel.app/api/me','GET','SERVERLESS_RELATIVE_API_ONLY'],
 ['/api/competitions?seasonId=invalid','GET','SERVERLESS_INVALID_SEASON'],
] as const)assert.throws(()=>mapEflReadRequest(endpoint,method),new RegExp(code));
assert.throws(()=>normalizeEflReadResponse(mapEflReadRequest('/api/competitions'),{ok:false,error:'FAILED'}),/SERVERLESS_RESPONSE_UNVERIFIED/);
assert.throws(()=>normalizeEflReadResponse(mapEflReadRequest('/api/competitions'),{ok:true,competitions:{}}),/SERVERLESS_RESPONSE_CONTRACT_MISMATCH/);
assert.throws(()=>normalizeEflReadResponse(mapEflReadRequest('/api/health'),{ok:true,service:'untrusted'}),/SERVERLESS_WRONG_SERVICE/);
console.log('PASS_SERVERLESS_GATEWAY: supported reads, guarded contracts, writes/legacy routes denied');
