import test from 'node:test';
import assert from 'node:assert/strict';
import {planUzeflifePlayoff,planNextUzeflifeRound} from '../tgcloud/lib/uzeflifePlayoffPlanner.js';
const entrants=n=>Array.from({length:n},(_,i)=>'p'+(i+1));
test('242 entrants produce a real 256-slot knockout with 14 byes',()=>{
 const plan=planUzeflifePlayoff({participantIds:entrants(242)});
 assert.equal(plan.bracketSize,256);
 assert.equal(plan.totalRounds,8);
 assert.equal(plan.byes,14);
 assert.equal(plan.matches.length,128);
 assert.equal(plan.matches.filter(m=>m.status==='BYE').length,14);
 assert.equal(plan.matches.filter(m=>m.status==='PENDING').length,114);
 const visible=plan.matches.flatMap(m=>[m.home,m.away]).filter(Boolean);
 assert.equal(new Set(visible).size,242);
 assert.equal(plan.requiresAdminApproval,true);
});
test('next round requires every match to have a valid winner',()=>{
 const plan=planUzeflifePlayoff({participantIds:entrants(8)});
 assert.throws(()=>planNextUzeflifeRound({matches:plan.matches}),/ROUND_INCOMPLETE/);
 const complete=plan.matches.map(m=>({...m,winner:m.home}));
 const next=planNextUzeflifeRound({matches:complete});
 assert.equal(next.round,2);
 assert.equal(next.matches.length,2);
 assert.equal(next.matches[0].home,complete[0].winner);
 assert.equal(next.matches[0].away,complete[1].winner);
 assert.equal(next.requiresAdminApproval,true);
 assert.equal(planNextUzeflifeRound({matches:[...complete].reverse()}).matches.length,2);
});
test('reject duplicates, incomplete scores, conflicting bracket indices',()=>{
 assert.throws(()=>planUzeflifePlayoff({participantIds:['p1','p1']}),/PARTICIPANTS/);
 const matches=planUzeflifePlayoff({participantIds:entrants(4)}).matches.map(m=>({...m,winner:m.home}));
 matches[1].bracket=1;
 assert.throws(()=>planNextUzeflifeRound({matches}),/SEQUENCE_MISMATCH/);
});
