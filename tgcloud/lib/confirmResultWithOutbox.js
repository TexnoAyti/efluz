// Transactional result-confirmation side effects for isolated Serverless staging.
// THIS IS NOT A PUBLIC ENDPOINT: the host must prove atomic multi-table
// transaction support before wiring this into the Telegram SDK.
// Confirmation, audit log, both inbox entries and both delivery queue records
// must succeed or ALL be rolled back by the injected transaction provider.
import {confirmFixtureResult,validateConfirmation} from './confirmResult.js';

export async function confirmFixtureResultWithOutbox(db,userId,input,withTransaction){
  if(typeof withTransaction!=='function')throw Error('RESULT_OUTBOX_TRANSACTION_REQUIRED');
  const {submissionId}=validateConfirmation(input);
  if(typeof userId!=='string'||!/^[A-Za-z0-9_:-]{1,120}$/.test(userId))
    throw Error('AUTH_REQUIRED');
  return await withTransaction(async tx=>{
    if(!tx||typeof tx.get!=='function'||typeof tx.run!=='function'||
       typeof tx.all!=='function')throw Error('RESULT_OUTBOX_TRANSACTION_REQUIRED');
    const source=await tx.get(`SELECT p.fixture_id AS fixtureId,
      p.submitted_by_user_id AS submitterId,p.club_id AS submittedClub,
      f.season_id AS seasonId,f.home_club_id AS homeClub,
      f.away_club_id AS awayClub
      FROM efl_result_submissions p JOIN efl_fixtures f ON f.id=p.fixture_id
      WHERE p.id=:submission`,{':submission':submissionId});
    if(!source||typeof source.fixtureId!=='string'||
       !/^[A-Za-z0-9_:-]{1,120}$/.test(source.fixtureId))
      throw Error('RESULT_OUTBOX_SOURCE_INVALID');
    if(!source.homeClub||!source.awayClub||source.homeClub===source.awayClub||
       ![source.homeClub,source.awayClub].includes(source.submittedClub))
      throw Error('RESULT_OUTBOX_FIXTURE_INCOMPLETE');

    // Both users must STILL own the respective clubs. Revalidate inside
    // the transaction before confirming a stored proposal from an old owner.
    const owners=await tx.all(`SELECT o.user_id AS userId,o.club_id AS clubId
      FROM efl_club_occupancies o JOIN efl_users u
       ON u.id=o.user_id AND u.telegram_id=o.telegram_id
      WHERE o.season_id=:season AND o.status='ACTIVE'
       AND o.club_id IN (:home,:away) AND u.is_banned=0`,
      {':season':source.seasonId,':home':source.homeClub,':away':source.awayClub});
    if(owners.length!==2||
       new Set(owners.map(o=>o.clubId)).size!==2||
       !owners.some(o=>o.userId===source.submitterId&&o.clubId===source.submittedClub)||
       !owners.some(o=>o.userId===userId&&o.clubId!==source.submittedClub))
      throw Error('RESULT_OUTBOX_OWNERSHIP_CONFLICT');

    const result=await confirmFixtureResult(tx,userId,{submissionId});
    const fixtureId=result.fixtureId,now=Date.now();
    const auditId='result_confirmed:'+fixtureId;
    const auditValue=JSON.stringify({
      fixtureId,submissionId,homeScore:result.homeScore,awayScore:result.awayScore
    });
    await tx.run(`INSERT INTO efl_audit_logs
      (id,actor_user_id,actor_username,action,entity_type,entity_id,
       old_value,new_value,created_at)
      VALUES (:id,:actor,'','RESULT_CONFIRMED','FIXTURE',:fixture,
       NULL,:value,:now)
      ON CONFLICT DO NOTHING`,{
      ':id':auditId,':actor':userId,':fixture':fixtureId,
      ':value':auditValue,':now':now
    });
    const audit=await tx.get(`SELECT actor_user_id AS actorUserId,
      action,entity_type AS entityType,entity_id AS entityId,
      new_value AS newValue FROM efl_audit_logs WHERE id=:id`,
      {':id':auditId});
    if(!audit||audit.actorUserId!==userId||
       audit.action!=='RESULT_CONFIRMED'||audit.entityType!=='FIXTURE'||
       audit.entityId!==fixtureId||audit.newValue!==auditValue)
      throw Error('RESULT_OUTBOX_AUDIT_CONFLICT');

    for(const owner of owners){
      const notificationId='fixture_confirmed:'+fixtureId+
        (owner.clubId===source.homeClub?':home':':away');
      const expectedBody='Hisob: '+result.homeScore+':'+result.awayScore;
      const params={':id':notificationId,':user':owner.userId,
       ':now':now,':body':expectedBody};
      // Each inbox record has a deterministic ID; safe on replay.
      await tx.run(`INSERT INTO efl_notifications
       (id,user_id,type,title,message,data,is_read,created_at)
       SELECT :id,:user,'RESULT_CONFIRMED','Uchrashuv tasdiqlandi',
        :body,
        NULL,0,:now
       WHERE EXISTS(SELECT 1 FROM efl_users u WHERE u.id=:user AND u.is_banned=0)
       ON CONFLICT DO NOTHING`,params);
      const saved=await tx.get(`SELECT user_id AS userId,type,title,message
       FROM efl_notifications WHERE id=:id`,{':id':notificationId});
      if(saved?.userId!==owner.userId||saved?.type!=='RESULT_CONFIRMED')
        throw Error('RESULT_OUTBOX_NOTIFICATION_CONFLICT');
      if(saved.title!=='Uchrashuv tasdiqlandi')
        throw Error('RESULT_OUTBOX_NOTIFICATION_TITLE_CONFLICT');
      if(saved.message!==expectedBody)
        throw Error('RESULT_OUTBOX_NOTIFICATION_BODY_CONFLICT');
      await tx.run(`INSERT INTO efl_notification_deliveries
       (id,notification_id,user_id,status,attempts,created_at)
       SELECT n.id,n.id,n.user_id,'PENDING',0,:now
       FROM efl_notifications n JOIN efl_users u ON u.id=n.user_id
       WHERE n.id=:id AND n.user_id=:user AND u.is_banned=0
         AND u.telegram_id IS NOT NULL AND u.telegram_id<>''
       ON CONFLICT DO NOTHING`,{
       ':id':notificationId,':user':owner.userId,':now':now
      });
      const queued=await tx.get(`SELECT user_id AS userId FROM
        efl_notification_deliveries WHERE notification_id=:id`,
        {':id':notificationId});
      if(queued?.userId!==owner.userId)
        throw Error('RESULT_OUTBOX_DELIVERY_CONFLICT');
    }
    return {...result,notificationCount:owners.length,
      notificationsQueued:true,auditId,source:'telegram-serverless'};
  });
}
