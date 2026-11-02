import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {operationTiming} from '../middleware/operationTiming';
const errors:unknown[][]=[],warnings:unknown[][]=[];
const originalError=console.error,originalWarn=console.warn;
console.error=(...args)=>{errors.push(args);};console.warn=(...args)=>{warnings.push(args);};
try{
  for(const [path,status] of [['/api/auth/telegram',503],['/api/fixtures/private-player-id/result',500],['/api/auth/telegram',200],['/api/admin/users',500]] as const){
    const res=new EventEmitter() as any;res.statusCode=status;let continued=false;
    operationTiming({method:'POST',path,body:{secret:'must-never-log'},headers:{authorization:'must-never-log'}} as any,res,()=>{continued=true;});assert.equal(continued,true);res.emit('finish');
  }
  assert.equal(errors.length,2);assert.equal(warnings.length,0);
  const logs=JSON.stringify(errors);assert.ok(!logs.includes('private-player-id'));assert.ok(!logs.includes('must-never-log'));
  assert.match(logs,/telegram-login/);assert.match(logs,/fixture-result/);
}finally{console.error=originalError;console.warn=originalWarn;}
console.log('PASS critical operation failure timing without bodies, paths, IDs, tokens or extra database writes');
