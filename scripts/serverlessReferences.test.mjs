import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSnapshotReferences} from './validateServerlessReferences.mjs';
test('accepts complete core references and TBD bracket fixtures',()=>{
  const data={
    users:[{id:'u'}],seasons:[{id:'s'}],leagues:[{id:'l',season_id:'s'}],
    clubs:[{id:'c',league_id:'l'}],competitions:[{id:'comp',season_id:'s',league_id:'l'}],
    clubOccupancies:[{id:'o',user_id:'u',season_id:'s',league_id:'l',club_id:'c',status:'ACTIVE'}],
    fixtures:[{id:'f',season_id:'s',competition_id:'comp',league_id:'l',home_club_id:'c',away_club_id:null}],
    resultSubmissions:[],participants:[],notifications:[],disputes:[],auditLogs:[],
    matchAccess:[{match_id:'f'}],matchMessages:[{id:1,match_id:'f'}]
  };
  assert.equal(validateSnapshotReferences(data).ok,true);
  data.notifications.push({id:'n',user_id:'missing'});
  assert.equal(validateSnapshotReferences(data).errors[0].code,'MISSING_REFERENCE');
});
test('rejects double ownership for same club in same season',()=>{
 const snapshot={clubOccupancies:[
   {id:'one',season_id:'s',club_id:'c',status:'ACTIVE'},
   {id:'two',season_id:'s',club_id:'c',status:'ACTIVE'},
 ]};
 assert.equal(validateSnapshotReferences(snapshot).errors.some(x=>x.code==='DOUBLE_OWNER'),true);
});
