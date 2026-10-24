import {planNaturalAdminRequest} from '../services/telegramAiNaturalAdminPlanner';
import assert from 'node:assert/strict';
import { AI_ADMIN_ACTIONS, adminPlanPath } from '../services/telegramAiAdminCatalog';
import { aiAdminRequestUrl, isPlatformAdminRequest } from '../services/telegramAiPlatformCatalog';
import { getAiAdminMountedRoutes } from '../services/telegramAiAdminGateway';
import { assertAiAdminActionAllowed } from '../services/telegramAiAdminAccess';

assert.equal(isPlatformAdminRequest('My favourite football team is Barcelona'),false);
assert.equal(isPlatformAdminRequest('Team ligasini yarat'),true);
const noReads:any={read:async()=>{throw Error('UNRELATED_READ');},users:async()=>[]};
assert.equal((await planNaturalAdminRequest('Klub teglarini sinxronla',noReads))?.action,'club_member_tags_sync');
assert.equal((await planNaturalAdminRequest('Klub teglari holatini ko‘rsat',noReads))?.action,'club_member_tags');
await assert.rejects(planNaturalAdminRequest('Klub teglarini sinxronlama',noReads),/CLARIFY/);
const routes=await getAiAdminMountedRoutes();
function matches(pattern:string,path:string){const a=pattern.replace(/\/$/,'').split('/'),b=path.replace(/\/$/,'').split('/');return a.length===b.length&&a.every((part,i)=>part.startsWith(':')||part===b[i]);}
for(const [name,spec] of Object.entries(AI_ADMIN_ACTIONS)) {
 const path=aiAdminRequestUrl(adminPlanPath({action:name,targetId:'audit-record',secondaryId:'audit-secondary',body:{}}));
 assert.ok(routes.some(route=>route.method===spec.method&&matches(route.path,path)),`${name}: ${spec.method} ${path} has no actual mounted route`);
 assert.doesNotThrow(()=>assertAiAdminActionAllowed(5209126900,{action:name,body:{}}));
}
// Complete core EFL controls: only non-JSON diagnostics and media download/rendering
// are intentionally outside the text action gateway. Tournament participant self-service
// (join/leave/register/dispute) is not an administrator mutation.
const core=routes.filter(r=>r.path.startsWith('/api/admin/')&&!r.path.includes('/custom-tournaments/tickets/'));
const uncovered=core.filter(r=>!Object.values(AI_ADMIN_ACTIONS).some(spec=>spec.method===r.method&&matches(r.path,aiAdminRequestUrl(spec.path))));
assert.deepEqual(uncovered,[],'An EFL core admin route is missing from capabilities');
for(const action of ['discipline_issue','discipline_revoke','ticket_grant','custom_start','uzeflife_generate','team_save'])assert.throws(()=>assertAiAdminActionAllowed(7573478198,{action,body:{}}),/faqat asosiy admin/);
console.log(`PASS ${Object.keys(AI_ADMIN_ACTIONS).length} catalog actions matched actual mounted routes, complete core EFL admin route coverage, fixed path prefixes and unchanged delegated permissions; no routes executed`);
