import {claimNotificationForWorker,finishNotificationForWorker} from './notificationDeliveryWorker.js';

const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(value);
const nowMs=()=>Date.now();

// Create only deterministic, current-round notices. INSERT ... ON CONFLICT
// keeps reruns idempotent and prevents old notifications from being replayed.
export async function enqueueCurrentFixtureNotices(db,now=nowMs()){
  const fixtures=await db.all(`SELECT f.id,f.round,f.home_telegram_id AS homeTelegramId,
      f.away_telegram_id AS awayTelegramId,f.home_club_id AS homeClubId,
      f.away_club_id AS awayClubId,f.scheduled_at AS scheduledAt,
      hc.name AS homeName,ac.name AS awayName,
      COALESCE(l.current_round,c.current_matchday,f.round) AS currentRound
    FROM efl_fixtures f
    LEFT JOIN efl_clubs hc ON hc.id=f.home_club_id
    LEFT JOIN efl_clubs ac ON ac.id=f.away_club_id
    LEFT JOIN efl_leagues l ON l.id=f.league_id
    LEFT JOIN efl_competitions c ON c.id=f.competition_id
    WHERE f.status NOT IN ('CONFIRMED','COMPLETED','FINISHED')
      AND f.confirmation_status NOT IN ('CONFIRMED','ACCEPTED')
      AND f.scheduled_at IS NOT NULL AND f.scheduled_at<=:now
      AND f.round=COALESCE(l.current_round,c.current_matchday,f.round)
      AND f.home_telegram_id IS NOT NULL AND f.away_telegram_id IS NOT NULL
    ORDER BY f.scheduled_at ASC,f.id ASC LIMIT 500`,{':now':now});
  let queued=0;
  for(const f of fixtures){
    const sides=[['home',f.homeTelegramId,f.homeName,f.awayName],['away',f.awayTelegramId,f.awayName,f.homeName]];
    for(const [side,telegramId,own,opponent] of sides){
      if(!/^\d{1,20}$/.test(String(telegramId??'')))continue;
      const user=await db.get('SELECT id FROM efl_users WHERE telegram_id=:telegram AND is_banned=0',{':telegram':String(telegramId)});
      if(!user)continue;
      const id=`fixture_unplayed:${f.id}:${side}`;
      if(!validId(id))continue;
      const result=await db.run(`INSERT INTO efl_notifications
        (id,user_id,type,title,message,data,is_read,created_at)
        VALUES (:id,:user,'UNPLAYED_FIXTURE','O‘ynalmagan uchrashuv',:message,NULL,0,:now)
        ON CONFLICT DO NOTHING`,{':id':id,':user':user.id,':message':`${own||'Klubingiz'} — ${opponent||'raqib'} uchrashuvi hali o‘ynalmagan.`,':now':now});
      await db.run(`INSERT INTO efl_notification_deliveries
        (id,notification_id,user_id,status,attempts,created_at)
        SELECT n.id,n.id,n.user_id,'PENDING',0,:now FROM efl_notifications n
        WHERE n.id=:id AND n.user_id=:user
        ON CONFLICT DO NOTHING`,{':id':id,':user':user.id,':now':now});
      if(result?.changes===1||result?.rowsAffected===1)queued++;
    }
  }
  return {fixtures:fixtures.length,queued};
}

export async function drainNotificationQueue(db,api,limit=25,now=nowMs()){
  const rows=await db.all(`SELECT d.notification_id AS notificationId
    FROM efl_notification_deliveries d JOIN efl_notifications n
      ON n.id=d.notification_id AND n.user_id=d.user_id
    JOIN efl_users u ON u.id=n.user_id AND u.is_banned=0
    WHERE d.status='PENDING' AND d.retry_after<=:now
    ORDER BY d.created_at ASC,d.notification_id ASC LIMIT :limit`,{':now':now,':limit':limit});
  let sent=0,review=0,failed=0;
  for(let i=0;i<rows.length;i++){
    const token=`sweep_${now}_${i}`;
    try{
      const notice=await claimNotificationForWorker(db,{notificationId:String(rows[i].notificationId),leaseToken:token,now,leaseMs:120000});
      let response;
      try{response=await api.sendMessage({chat_id:notice.telegramId,text:`${notice.title}\n\n${notice.message}`.slice(0,4096)});}
      catch{response={ok:false,ambiguous:true};}
      if(response?.ok===true){await finishNotificationForWorker(db,{notificationId:notice.notificationId,leaseToken:token,now:nowMs(),success:true});sent++;}
      else if(response?.ambiguous){await finishNotificationForWorker(db,{notificationId:notice.notificationId,leaseToken:token,now:nowMs(),success:false,errorCode:'NETWORK_UNCERTAIN'});review++;}
      else{await finishNotificationForWorker(db,{notificationId:notice.notificationId,leaseToken:token,now:nowMs(),success:false,errorCode:'TELEGRAM_ERROR'});failed++;}
    }catch(error){if(String(error?.message||'').includes('DELIVERY_ACK_CONFLICT'))review++;}
  }
  return {reviewed:review,sent,failed,considered:rows.length};
}
