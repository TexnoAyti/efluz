import type { StandingsRow } from '../../types';

/** Pure projection from authoritative fixtures; never reads SQLite or writes a database. */
export function projectStandings(
  clubs: Array<{ id: string; name: string; shortName: string; logoUrl?: string }>,
  fixtures: Array<{ id: string; homeClubId?: string | null; awayClubId?: string | null; status: string; homeScore?: number | null; awayScore?: number | null; scheduledAt?: string; resultConfirmedAt?: string | null }>,
  config: any = {}
): StandingsRow[] {
  const win=Number(config.pointsForWin ?? 3), draw=Number(config.pointsForDraw ?? 1), loss=Number(config.pointsForLoss ?? 0);
  const rows: StandingsRow[]=clubs.map(c=>({position:0,clubId:c.id,clubName:c.name,shortName:c.shortName,logoUrl:c.logoUrl,played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0,goalDifference:0,points:0,form:[]}));
  const byId=new Map(rows.map(row=>[row.clubId,row]));
  const confirmed=fixtures.filter(f=>f.status==='CONFIRMED').sort((a,b)=>(Date.parse(a.resultConfirmedAt || a.scheduledAt || '') || 0)-(Date.parse(b.resultConfirmedAt || b.scheduledAt || '') || 0)||a.id.localeCompare(b.id));
  for(const f of confirmed) {
    if(!f.homeClubId || !f.awayClubId || f.homeClubId===f.awayClubId || !Number.isInteger(f.homeScore) || !Number.isInteger(f.awayScore) || f.homeScore!<0 || f.awayScore!<0) throw new Error(`INVALID_CONFIRMED_RESULT: ${f.id}`);
    const home=byId.get(f.homeClubId), away=byId.get(f.awayClubId);
    if(!home || !away) throw new Error(`FIXTURE_PARTICIPANT_MISSING: ${f.id}`);
    for(const [row,forGoals,againstGoals] of [[home,f.homeScore!,f.awayScore!],[away,f.awayScore!,f.homeScore!]] as const) {
      row.played++; row.goalsFor+=forGoals; row.goalsAgainst+=againstGoals; row.goalDifference=row.goalsFor-row.goalsAgainst;
      if(forGoals>againstGoals) {row.won++;row.points+=win;row.form.push('W');}
      else if(forGoals===againstGoals) {row.drawn++;row.points+=draw;row.form.push('D');}
      else {row.lost++;row.points+=loss;row.form.push('L');}
      row.form=row.form.slice(-5);
    }
  }
  const rules: string[]=config.tieBreakers || ['points','goalDifference','goalsFor','headToHead'];
  if(rules.some(rule=>!['points','goalDifference','goalsFor','headToHead','wins'].includes(rule))) throw new Error('UNSUPPORTED_TIEBREAKER');
  function rank(group:StandingsRow[],index:number):StandingsRow[] {
    if(group.length<2 || index>=rules.length) return [...group].sort((a,b)=>a.clubId.localeCompare(b.clubId));
    const rule=rules[index];
    const ids=new Set(group.map(r=>r.clubId));
    const metric=(row:StandingsRow):number[]=>{
      if(rule!=='headToHead') return [rule==='wins'?row.won:Number(row[rule as keyof StandingsRow])];
      let points=0,gd=0,gf=0;
      for(const f of confirmed) if(ids.has(f.homeClubId!) && ids.has(f.awayClubId!)) {
        if(f.homeClubId!==row.clubId && f.awayClubId!==row.clubId) continue;
        const own=f.homeClubId===row.clubId?f.homeScore!:f.awayScore!, other=f.homeClubId===row.clubId?f.awayScore!:f.homeScore!;
        points+=own>other?win:own===other?draw:loss;gd+=own-other;gf+=own;
      }
      return [points,gd,gf];
    };
    const metrics=new Map(group.map(r=>[r.clubId,metric(r)]));
    const compare=(a:StandingsRow,b:StandingsRow)=>{
      const av=metrics.get(a.clubId)!, bv=metrics.get(b.clubId)!;
      for(let i=0;i<av.length;i++) if(av[i]!==bv[i]) return bv[i]-av[i];
      return 0;
    };
    const ordered=[...group].sort(compare), output:StandingsRow[]=[];
    for(let start=0;start<ordered.length;) {
      let end=start+1;while(end<ordered.length && compare(ordered[start],ordered[end])===0)end++;
      output.push(...rank(ordered.slice(start,end),index+1));start=end;
    }
    return output;
  }
  return rank(rows,0).map((row,index)=>({...row,position:index+1}));
}
