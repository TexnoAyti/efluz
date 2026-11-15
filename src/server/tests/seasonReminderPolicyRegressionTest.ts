import assert from 'node:assert/strict';
import {LEGACY_SEASON_ID,CURRENT_LEAGUE_SEASON_ID,unplayedReminderCompetitionAllowed,unplayedReminderJobAllowed} from '../services/seasonReminderPolicy';
import {backlogCompetitionEnabled,freshLeagueReminder,reminderDay} from '../services/leagueBacklogReminders';
const old=LEGACY_SEASON_ID,newSeason=CURRENT_LEAGUE_SEASON_ID;
for(const competition of ['comp-premier-league-2026','comp-la-liga-2026','comp-serie-a-2026','comp-bundesliga-2026','comp-ligue-1-2026','comp-copa-del-rey-2026','comp-supercopa-espana-2026']){
 assert.equal(unplayedReminderCompetitionAllowed(old,competition),false,'Never notify historical '+competition);
 assert.equal(unplayedReminderJobAllowed({seasonId:old,leagueReminder:{seasonId:old,competitionId:competition}}),false);
}
for(const competition of ['comp-champions-league-2026','comp-europa-league-2026']){
 assert.equal(unplayedReminderCompetitionAllowed(old,competition),true,'Season 1 UEFA remains active');
 assert.equal(unplayedReminderJobAllowed({seasonId:old,competitionId:competition}),true);
}
for(const competition of ['comp-premier-league-2027','comp-la-liga-2027','comp-serie-a-2027','comp-bundesliga-2027','comp-ligue-1-2027']){
 assert.equal(unplayedReminderCompetitionAllowed(newSeason,competition),true,'Season 2 remains active');
}
assert.equal(unplayedReminderJobAllowed({seasonId:old}),false,'Legacy queued reminder without verified competition must be suppressed');
assert.equal(unplayedReminderJobAllowed({seasonId:newSeason}),true,'Modern jobs retain old sender logic');
assert.equal(backlogCompetitionEnabled({id:'comp-premier-league-2026',seasonId:old,name:'Premier League',type:'LEAGUE',status:'active'}),true,'Historic league may still be read for history; only sending blocked');
const inactive=await freshLeagueReminder({seasonId:old,competitionId:'comp-premier-league-2026',day:reminderDay()},'user-test');
assert.equal(inactive,null,'Send-time policy must suppress queued historical League digest without fetching data');
console.log('PASS Season 1 UEFA-only, active Season 2, and queued old-season reminder suppression');
