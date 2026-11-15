import assert from 'node:assert/strict';
import {isAiAdminActor,assertAiAdminActionAllowed} from '../services/telegramAiAdminAccess';

const assistant=8574301555;
assert.equal(isAiAdminActor(assistant),true,'Verified user is a delegated AI actor');
assert.doesNotThrow(()=>assertAiAdminActionAllowed(assistant,{action:'result_approve',targetId:'result-test',body:{homeScore:1,awayScore:0}} as any));
assert.doesNotThrow(()=>assertAiAdminActionAllowed(assistant,{action:'result_reject',targetId:'result-test',body:{}} as any));
for(const action of ['club_release','matchday_advance','results_bulk_apply','user_role','fixture_delete','result_edit','result_clear']){
 assert.throws(()=>assertAiAdminActionAllowed(assistant,{action,targetId:'test',body:{}} as any),'Delegation cannot grant '+action);
}
assert.equal(isAiAdminActor(123456789),false,'Unlisted Telegram ID is not an AI admin');
console.log('PASS verified assistant may use AI and confirm/reject results only');
