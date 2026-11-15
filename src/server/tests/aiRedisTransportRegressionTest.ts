import assert from 'node:assert/strict';
import {getAiRedisClient,getTopicResultStateClient} from '../services/telegramAiDeadline';
import {PostgresAiStore} from '../services/postgresAiStore';

const old={...process.env};
try{
 process.env.DATABASE_PROVIDER='supabase';
 process.env.EFL_AI_STATE_BACKEND='redis';
 process.env.UPSTASH_REDIS_REST_URL='https://unit-test.upstash.io';
 process.env.UPSTASH_REDIS_REST_TOKEN='unit-test-token';
 delete process.env.EFL_AI_STATE_NAMESPACE;
 assert.equal(getAiRedisClient(),null,'No AI Redis namespace must fail closed');
 process.env.EFL_AI_STATE_NAMESPACE='staging-8533963416';
 const cache=getAiRedisClient();
 assert.ok(cache && !(cache instanceof PostgresAiStore),'Opted-in AI uses Redis');
 assert.ok(getTopicResultStateClient() instanceof PostgresAiStore,'Score confirmations preserve PostgreSQL transport');
 delete process.env.EFL_AI_STATE_BACKEND;
 assert.ok(getAiRedisClient() instanceof PostgresAiStore,'Default production transport remains unchanged');
 console.log('PASS serverless AI Redis opt-in requires namespace and preserves score confirmation transport');
}finally{
 process.env=old;
}
