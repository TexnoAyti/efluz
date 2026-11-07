// Fail-closed guard for explicit, non-production Telegram Serverless deployment.
// The secret is never printed. Inputs come only from GitHub's staging environment.
export function verifyStagingGate(env){
  const token=env.TGCLOUD_TOKEN;
  const staging=env.TGCLOUD_STAGING_APP_ID;
  const production=env.TGCLOUD_PRODUCTION_APP_ID;
  const confirm=env.CONFIRM_TGCLOUD_STAGING_DEPLOY;
  if(confirm!=='DEPLOY_STAGING_ONLY')throw Error('STAGING_CONFIRMATION_REQUIRED');
  if(typeof staging!=='string'||!/^[1-9][0-9]{0,19}$/.test(staging)||
     typeof production!=='string'||!/^[1-9][0-9]{0,19}$/.test(production))
    throw Error('APP_IDS_NOT_CONFIGURED');
  if(staging===production)throw Error('STAGING_EQUALS_PRODUCTION');
  if(typeof token!=='string'||!/^app[1-9][0-9]*:[^\s]{10,}$/.test(token))
    throw Error('STAGING_TOKEN_UNAVAILABLE');
  const appId=token.slice(3,token.indexOf(':'));
  if(appId!==staging)throw Error('STAGING_TOKEN_APP_MISMATCH');
  return {ok:true,stagingIsolated:true};
}
if(import.meta.url===`file://${process.argv[1]}`){
  try{
    verifyStagingGate(process.env);
    console.log('STAGING_GATE_OK: verified isolated staging app ID');
  }catch(error){
    // Deliberately do not log environment values or raw credentials.
    console.error(String(error?.message||'STAGING_GATE_FAILED'));
    process.exitCode=1;
  }
}
