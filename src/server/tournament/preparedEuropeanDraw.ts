import type { RoundMatchup } from './fixtureEngine';

export type EuropeanCode='UCL'|'UEL'|'UECL';
export interface DrawClub { id:string; association:string; pot:number; }
type Edge={a:number;b:number;home:number};
const fail=(message:string):never=>{throw new Error(message);};
function random(seed:string){
  let state=2166136261;
  for(const char of seed)state=Math.imul(state^char.charCodeAt(0),16777619);
  return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
}
function shuffle<T>(values:T[],rng:()=>number){
  const out=[...values];for(let i=out.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;
}
/** Validated EFL simulation of UEFA Article 16 constraints. Never relax constraints to finish a draw. */
export function generatePreparedEuropeanDraw(code:EuropeanCode,clubs:DrawClub[],seed:string):RoundMatchup[]{
  if(!['UCL','UEL','UECL'].includes(code)||!seed||seed.length>120)fail('INVALID_DRAW_INPUT');
  const pots=code==='UECL'?6:4,size=36/pots,rounds=code==='UECL'?6:8;
  if(clubs.length!==36||new Set(clubs.map(c=>c.id)).size!==36||clubs.some(c=>!c.id||!c.association||!Number.isInteger(c.pot)||c.pot<1||c.pot>pots))fail('INVALID_DRAW_CLUBS');
  const groups=Array.from({length:pots},(_,p)=>clubs.flatMap((c,i)=>c.pot===p+1?[i]:[]));
  if(groups.some(g=>g.length!==size))fail('INVALID_POT_COUNTS');
  if(clubs.some(c=>clubs.filter(other=>other.association===c.association).length>36-rounds))fail('DRAW_CONSTRAINTS_UNSATISFIABLE');
  const rng=random(seed),deadline=Date.now()+4000;
  // Each attempt is bounded; an impossible roster returns an explicit error, never an invalid fallback.
  for(let attempt=0;attempt<24;attempt++){
    if(Date.now()>deadline)break;
    const edges:Edge[]=[],used=new Set<string>(),associationCounts=clubs.map(()=>new Map<string,number>());
    const key=(a:number,b:number)=>a<b?a+':'+b:b+':'+a;
    const allowed=(a:number,b:number)=>a!==b&&clubs[a].association!==clubs[b].association&&!used.has(key(a,b))&&(associationCounts[a].get(clubs[b].association)||0)<2&&(associationCounts[b].get(clubs[a].association)||0)<2;
    function put(a:number,b:number){
      used.add(key(a,b));edges.push({a,b,home:a});
      associationCounts[a].set(clubs[b].association,(associationCounts[a].get(clubs[b].association)||0)+1);
      associationCounts[b].set(clubs[a].association,(associationCounts[b].get(clubs[a].association)||0)+1);
    }
    function undo(){
      const e=edges.pop()!;used.delete(key(e.a,e.b));
      for(const [a,b] of [[e.a,e.b],[e.b,e.a]])associationCounts[a].set(clubs[b].association,associationCounts[a].get(clubs[b].association)!-1);
    }
    let nodes=0;
    function matching(left:number[],right:number[],self=false):boolean{
      if(++nodes>10000||(nodes%128===0&&Date.now()>deadline))return false;
      if(!left.length)return true;
      let selected=left[0],options:number[]=[],minimum=Infinity;
      for(const a of left){
        const candidates=right.filter(b=>allowed(a,b));
        if(candidates.length<minimum){selected=a;options=candidates;minimum=candidates.length;}
      }
      if(!options.length)return false;
      for(const b of shuffle(options,rng)){
        put(selected,b);
        const nextLeft=left.filter(x=>x!==selected&&(!self||x!==b));
        const nextRight=right.filter(x=>x!==b&&(!self||x!==selected));
        if(matching(nextLeft,nextRight,self))return true;
        undo();
      }
      return false;
    }
    let valid=true;
    if(code==='UECL'){
      const tasks:Array<[number,number]>=[];
      for(let p=0;p<pots;p++)for(let q=p;q<pots;q++)tasks.push([p,q]);
      for(const [p,q] of shuffle(tasks,rng))if(!matching(groups[p],groups[q],p===q)){valid=false;break;}
      if(valid){
        // For each paired-pot group each club has degree two: orient every cycle for one home/one away.
        const categories=new Map<string,Edge[]>();
        for(const e of edges){
          const a=Math.floor((clubs[e.a].pot-1)/2),b=Math.floor((clubs[e.b].pot-1)/2);
          const k=Math.min(a,b)+':'+Math.max(a,b);
          categories.set(k,[...(categories.get(k)||[]),e]);
        }
        for(const rows of categories.values()){
          const remaining=new Set(rows);
          while(remaining.size){
            let current=remaining.values().next().value!.a;
            while(true){
              const e=[...remaining].find(item=>item.a===current||item.b===current);
              if(!e)break;
              e.home=current;current=e.a===current?e.b:e.a;remaining.delete(e);
            }
          }
        }
      }
    }else{
      const tasks:Array<[number,number]>=[];
      for(let p=0;p<pots;p++)for(let q=0;q<pots;q++)tasks.push([p,q]);
      // Directed matchings give exactly one home and one away opponent from every pot.
      for(const [p,q] of shuffle(tasks,rng))if(!matching(groups[p],groups[q])){valid=false;break;}
    }
    if(!valid)continue;
    // Edge coloring into full matchdays. Each color is a perfect matching of all 36 clubs.
    const colors=edges.map(()=>-1),masks=clubs.map(()=>0),full=(1<<rounds)-1;
    const incident=clubs.map((_,a)=>edges.flatMap((e,i)=>e.a===a||e.b===a?[i]:[]));
    let searchNodes=0;
    function color(remaining:number):boolean{
      if(!remaining)return true;
      if(++searchNodes>40000||(searchNodes%128===0&&Date.now()>deadline))return false;
      let chosen=-1,available=0,minimum=Infinity;
      for(let i=0;i<edges.length;i++)if(colors[i]<0){
        const e=edges[i],bits=full&~(masks[e.a]|masks[e.b]);
        let count=0;for(let x=bits;x;x&=x-1)count++;
        if(!count)return false;
        if(count<minimum){chosen=i;available=bits;minimum=count;if(count===1)break;}
      }
      const e=edges[chosen];
      for(let day=0;day<rounds;day++)if(available&(1<<day)){
        colors[chosen]=day;masks[e.a]|=1<<day;masks[e.b]|=1<<day;
        if(color(remaining-1))return true;
        masks[e.a]&=~(1<<day);masks[e.b]&=~(1<<day);colors[chosen]=-1;
      }
      return false;
    }
    // Fix color symmetry at one club, preserving every possible coloring up to a color permutation.
    for(let day=0;day<incident[0].length;day++){
      const i=incident[0][day],e=edges[i];colors[i]=day;masks[e.a]|=1<<day;masks[e.b]|=1<<day;
    }
    if(!color(edges.length-incident[0].length))continue;
    const fixtures=edges.map((e,i)=>({matchday:colors[i]+1,homeClubId:clubs[e.home].id,awayClubId:clubs[e.home===e.a?e.b:e.a].id}));
    validatePreparedEuropeanDraw(code,clubs,fixtures);
    return fixtures.sort((a,b)=>a.matchday-b.matchday||a.homeClubId.localeCompare(b.homeClubId));
  }
  return fail('DRAW_SEARCH_EXHAUSTED: change seed or review association/pot distribution');
}
export function validatePreparedEuropeanDraw(code:EuropeanCode,clubs:DrawClub[],fixtures:RoundMatchup[]){
  const rounds=code==='UECL'?6:8,pots=code==='UECL'?6:4,byId=new Map(clubs.map(c=>[c.id,c]));
  if(fixtures.length!==36*rounds/2)fail('INVALID_DRAW_TOTAL');
  const pairs=new Set<string>();
  for(const f of fixtures){
    const h=byId.get(f.homeClubId),a=byId.get(f.awayClubId);
    const pair=[f.homeClubId,f.awayClubId].sort().join('|');
    if(!h||!a||h.id===a.id||h.association===a.association||pairs.has(pair)||!Number.isInteger(f.matchday)||f.matchday<1||f.matchday>rounds)fail('INVALID_DRAW_PAIR');
    pairs.add(pair);
  }
  for(const c of clubs){
    const games=fixtures.filter(f=>f.homeClubId===c.id||f.awayClubId===c.id);
    if(games.length!==rounds||new Set(games.map(f=>f.matchday)).size!==rounds||games.filter(f=>f.homeClubId===c.id).length!==rounds/2)fail('INVALID_DRAW_BALANCE');
    const counts=new Map<string,number>();
    for(const f of games){const other=byId.get(f.homeClubId===c.id?f.awayClubId:f.homeClubId)!;counts.set(other.association,(counts.get(other.association)||0)+1);}
    if([...counts.values()].some(n=>n>2))fail('INVALID_ASSOCIATION_CAP');
    for(let pot=1;pot<=pots;pot++){
      const rows=games.filter(f=>byId.get(f.homeClubId===c.id?f.awayClubId:f.homeClubId)!.pot===pot);
      if(rows.length!==(code==='UECL'?1:2))fail('INVALID_POT_QUOTA');
      if(code!=='UECL'&&rows.filter(f=>f.homeClubId===c.id).length!==1)fail('INVALID_POT_HOME_AWAY');
    }
    if(code==='UECL')for(let pot=1;pot<=5;pot+=2){
      const pair=games.filter(f=>[pot,pot+1].includes(byId.get(f.homeClubId===c.id?f.awayClubId:f.homeClubId)!.pot));
      if(pair.filter(f=>f.homeClubId===c.id).length!==1)fail('INVALID_PAIRED_POT_BALANCE');
    }
  }
}
