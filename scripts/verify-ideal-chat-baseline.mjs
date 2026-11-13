/** Prevent accidental replacement of the user-approved EFLUZ match chat. 
 * Update expected blob IDs only after intentional chat review and regression tests.
 * Git blob IDs are SHA-1 of "blob <bytes>\0" plus the exact file content.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const approved={
  'src/components/MatchChatHost.tsx':'24682ebebfe362bdac9c6fceb6ed7ee5a1a2daf4',
  'src/server/services/matchChatService.ts':'5624d4b4330b65463fbf7f29f4266604b2815b29',
  'src/server/routes/matchChat.routes.ts':'b2380a5f6a048ee6fc331364a09911a0d4a1700d',
  'src/index.css':'fd0016e93abe19fd3a077923d6cbf38e593144f3',
  'public/games/efl-penalty.html':'854b0a53740c3911f6c7cb28ae2f488790771a69',
};
let failed=false;
for(const [path,expected] of Object.entries(approved)){
  try{
    const bytes=readFileSync(path);
    const actual=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if(actual!==expected){console.error(`IDEAL_CHAT_CHANGED: ${path}; expected ${expected}, got ${actual}. Review intentionally and update baseline only after testing.`);failed=true;}
    else console.log(`IDEAL_CHAT_OK: ${path}`);
  }catch(error){console.error(`IDEAL_CHAT_MISSING: ${path}: ${error.message}`);failed=true;}
}
if(failed)process.exitCode=1;
