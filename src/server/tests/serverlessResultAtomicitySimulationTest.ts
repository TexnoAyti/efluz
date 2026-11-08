import assert from 'node:assert/strict';
import {confirmFixtureResultWithOutbox} from '../../../tgcloud/lib/confirmResultWithOutbox.js';

// A deterministic in-memory *transaction simulator*, not Telegram SDK evidence.
// Its snapshot rollback lets us test the intended atomicity contract offline.
type State={
 fixture:{id:string;status:string;confirmationStatus:string;homeScore:number|null;awayScore:number|null};
 audit:Record<string,any>;
 notifications:Record<string,any>;
 deliveries:Record<string,any>;
};
const initial=():State=>({
 fixture:{id:'fixture-one',status:'SCHEDULED',confirmationStatus:'NONE',
   homeScore:null,awayScore:null},
 audit:{},notifications:{},deliveries:{}
});
const proposal={id:'submission-one',fixtureId:'fixture-one',submitterId:'user-away',
  submitterClubId:'club-away',homeScore:2,awayScore:1,
  seasonId:'season-2026-27',homeClubId:'club-home',awayClubId:'club-away',
  submittedClub:'club-away',homeClub:'club-home',awayClub:'club-away',
  status:'SCHEDULED'};
const owners=[
 {userId:'user-home',clubId:'club-home'},
 {userId:'user-away',clubId:'club-away'}
];
const clone=<T>(v:T):T=>structuredClone(v);
function fixtureTransactor(state:State,failAt:string|null=null){
 return async <T>(callback:(tx:any)=>Promise<T>):Promise<T>=>{
   const working=clone(state);
   const tx={
     async get(sql:string,params:any={}){
       if(sql.includes('p.fixture_id AS fixtureId')&&sql.includes('FROM efl_result_submissions'))
         return {...proposal};
       if(sql.startsWith('SELECT id,telegram_id,is_banned FROM efl_users'))
         return {id:'user-home',telegram_id:'456',is_banned:0};
       if(sql.includes('p.id,p.fixture_id AS fixtureId'))
         return {...proposal};
       if(sql.includes('SELECT id FROM efl_club_occupancies'))
         return {id:'ownership-home'};
       if(sql.includes('SELECT o.id FROM efl_club_occupancies'))
         return {id:'ownership-away'};
       if(sql.includes('FROM efl_fixtures WHERE id=:fixture'))
         return {...working.fixture};
       if(sql.includes('FROM efl_audit_logs'))
         return working.audit[params[':id']]||null;
       if(sql.includes('FROM efl_notifications WHERE id=:id'))
         return working.notifications[params[':id']]||null;
       if(sql.includes('FROM')&&sql.includes('efl_notification_deliveries'))
         return working.deliveries[params[':id']]||null;
       throw Error('UNHANDLED_GET_QUERY:'+sql.slice(0,110));
     },
     async all(sql:string){
       if(sql.includes('FROM efl_club_occupancies o JOIN efl_users u'))return clone(owners);
       throw Error('UNHANDLED_ALL_QUERY');
     },
     async run(sql:string,params:any={}){
       if(sql.startsWith('UPDATE efl_fixtures')){
         if(working.fixture.status==='SCHEDULED'){
           working.fixture={...working.fixture,status:'CONFIRMED',confirmationStatus:'CONFIRMED',
             homeScore:params[':homeScore'],awayScore:params[':awayScore']};
         }
         return;
       }
       if(sql.includes('INSERT INTO efl_audit_logs')){
         if(failAt==='audit')throw Error('INJECTED_AUDIT_FAILURE');
         working.audit[params[':id']]??={
           actorUserId:params[':actor'],action:'RESULT_CONFIRMED',entityType:'FIXTURE',
           entityId:params[':fixture'],newValue:params[':value']
         };
         return;
       }
       if(sql.includes('INSERT INTO efl_notifications')){
         const id=params[':id'];
         if(failAt==='second-inbox'&&id.endsWith(':away'))
           throw Error('INJECTED_SECOND_INBOX_FAILURE');
         working.notifications[id]??={userId:params[':user'],type:'RESULT_CONFIRMED',
           title:'Uchrashuv tasdiqlandi',message:params[':body']};
         return;
       }
       if(sql.includes('INSERT INTO efl_notification_deliveries')){
         const id=params[':id'];
         if(failAt==='second-delivery'&&id.endsWith(':away'))
           throw Error('INJECTED_SECOND_DELIVERY_FAILURE');
         working.deliveries[id]??={userId:params[':user']};
         return;
       }
       throw Error('UNHANDLED_RUN_QUERY:'+sql.slice(0,110));
     }
   };
   // Commit only if the entire transaction callback succeeds.
   const result=await callback(tx);
   Object.assign(state,working);
   return result;
 };
}
for(const failure of ['audit','second-inbox','second-delivery']){
 const state=initial();
 await assert.rejects(
   confirmFixtureResultWithOutbox({},'user-home',{submissionId:'submission-one'},
     fixtureTransactor(state,failure)),
   new RegExp('INJECTED_'+failure.toUpperCase().replaceAll('-','_')+'_FAILURE')
 );
 assert.deepEqual(state,initial(),'A failed '+failure+' must roll back score and all side effects');
 // The retry after rollback must create exactly one confirmation and two inbox/outbox rows.
 const retried=await confirmFixtureResultWithOutbox({},'user-home',
   {submissionId:'submission-one'},fixtureTransactor(state));
 assert.equal(retried.ok,true);
 assert.equal(retried.notificationCount,2);
 assert.equal(state.fixture.status,'CONFIRMED');
 assert.equal(state.fixture.homeScore,2);
 assert.equal(state.fixture.awayScore,1);
 assert.equal(Object.keys(state.audit).length,1);
 assert.equal(Object.keys(state.notifications).length,2);
 assert.equal(Object.keys(state.deliveries).length,2);
}
// A second attempt against the same already-confirmed fixture must not
// generate another audit/delivery; its attempted UPDATE cannot re-confirm it.
const state=initial();
await confirmFixtureResultWithOutbox({},'user-home',
  {submissionId:'submission-one'},fixtureTransactor(state));
const afterFirst=clone(state);
await confirmFixtureResultWithOutbox({},'user-home',
  {submissionId:'submission-one'},fixtureTransactor(state));
assert.deepEqual(state,afterFirst);
console.log('PASS_RESULT_ATOMICITY_SIMULATION: rollback on audit/inbox/outbox failure and idempotent retry');
