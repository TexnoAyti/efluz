import assert from 'node:assert/strict';
import {isAiAdminActor,assertAiAdminActionAllowed} from '../services/telegramAiAdminAccess';

const delegates=[8574301555,6259134738,8713569435];
for(const assistant of delegates){
  assert.equal(isAiAdminActor(assistant),true,'Verified full admin is a delegated AI actor');
  for(const action of ['result_approve','result_reject','club_release','club_assign',
    'matchday_advance','results_bulk_apply','result_edit','result_clear','cup_reconcile']){
    assert.doesNotThrow(()=>assertAiAdminActionAllowed(assistant,{action,targetId:'test',body:{}} as any));
  }
  for(const action of ['user_role','fixture_delete','broadcast','user_suspend']){
    assert.throws(()=>assertAiAdminActionAllowed(assistant,{action,targetId:'test',body:{}} as any),
      'Owner-only AI operation remains restricted: '+action);
  }
}
assert.equal(isAiAdminActor(123456789),false,'Unlisted Telegram ID is not an AI admin');
console.log('PASS verified AI delegates manage league actions without owner-only privileges');
