// Offline UZEFLIFE knockout planner. It does not alter live matches or publish posts.
// Admin must review a plan before any persisted bracket is created.
const validId = v => typeof v === 'string' && /^[A-Za-z0-9_:-]{1,160}$/.test(v);
function capacityFor(n) {
  let capacity=2;
  while(capacity<n)capacity*=2;
  return capacity;
}
function seedSlots(capacity) {
  let slots=[1,2];
  while(slots.length<capacity) {
    const size=slots.length*2+1;
    slots=slots.flatMap(seed=>[seed,size-seed]);
  }
  return slots;
}
export function planUzeflifePlayoff(input={}) {
  const {participantIds,round=1,competitionId='uzeflife'}=input;
  if(!Array.isArray(participantIds)||participantIds.length<2||
    participantIds.length>4096||!Number.isSafeInteger(round)||round<1||round>256||
    !validId(competitionId))throw Error('INVALID_UZEFLIFE_PLAYOFF_CONFIG');
  if(participantIds.some(id=>!validId(id))||
     new Set(participantIds).size!==participantIds.length)
    throw Error('INVALID_UZEFLIFE_PLAYOFF_PARTICIPANTS');
  const capacity=capacityFor(participantIds.length);
  const slots=seedSlots(capacity).map(seed=>participantIds[seed-1]??null);
  const matches=[];
  for(let i=0;i<slots.length;i+=2) {
    const home=slots[i],away=slots[i+1];
    if(!home&&!away)throw Error('UZEFLIFE_EMPTY_PAIRING');
    matches.push({
      id:`${competitionId}:r${round}:m${i/2+1}`,
      round,bracket:i/2+1,home,away,
      winner:home&&!away?home:away&&!home?away:null,
      status:home&&away?'PENDING':'BYE',
      homeScore:null,awayScore:null,penaltyHome:null,penaltyAway:null
    });
  }
  return {
    competitionId,round,participantCount:participantIds.length,
    bracketSize:capacity,totalRounds:Math.log2(capacity),
    byes:capacity-participantIds.length,matches,
    readOnlyPlan:true,requiresAdminApproval:true
  };
}
export function planNextUzeflifeRound(input={}) {
  const {matches,competitionId='uzeflife'}=input;
  if(!Array.isArray(matches)||matches.length<2||
    !validId(competitionId)||!Number.isSafeInteger(Math.log2(matches.length))||
    !matches.every(m=>m&&Number.isSafeInteger(m.round)&&m.round>=1&&
      validId(m.id)&&validId(m.winner)&&
      (m.winner===m.home||m.winner===m.away)))
    throw Error('UZEFLIFE_ROUND_INCOMPLETE');
  const ordered=[...matches].sort((a,b)=>a.bracket-b.bracket);
  const round=ordered[0].round;
  if(ordered.some((m,i)=>m.round!==round||m.bracket!==i+1||
    m.id!==`${competitionId}:r${round}:m${i+1}`))
    throw Error('UZEFLIFE_ROUND_SEQUENCE_MISMATCH');
  const winners=ordered.map(m=>m.winner);
  if(new Set(winners).size!==winners.length)
    throw Error('UZEFLIFE_DUPLICATE_WINNER');
  const next=round+1;
  return {
    competitionId,round:next,participantCount:winners.length,
    matches:Array.from({length:winners.length/2},(_,i)=>({
      id:`${competitionId}:r${next}:m${i+1}`,round:next,bracket:i+1,
      home:winners[2*i],away:winners[2*i+1],winner:null,status:'PENDING',
      homeScore:null,awayScore:null,penaltyHome:null,penaltyAway:null
    })),
    readOnlyPlan:true,requiresAdminApproval:true
  };
}
