/** Approved current-season identity corrections. Legacy IDs retain every fixture and owner. */
export const CURRENT_CLUB_CORRECTIONS:Record<string,{canonicalId:string;name:string;shortName:string;logoUrl:string}>= {
  'club-girona':{canonicalId:'club-elche',name:'Elche CF',shortName:'ELC',logoUrl:'https://crests.football-data.org/285.png'},
  'club-las-palmas':{canonicalId:'club-espanyol',name:'RCD Espanyol',shortName:'ESP',logoUrl:'https://crests.football-data.org/80.png'},
  'club-mallorca':{canonicalId:'club-levante',name:'Levante UD',shortName:'LEV',logoUrl:'https://crests.football-data.org/88.png'},
  'club-empoli':{canonicalId:'club-como',name:'Como 1907',shortName:'COM',logoUrl:''},
  'club-verona':{canonicalId:'club-sassuolo',name:'US Sassuolo',shortName:'SAS',logoUrl:'https://crests.football-data.org/471.png'},
  'club-bochum':{canonicalId:'club-elversberg',name:'SV Elversberg',shortName:'ELV',logoUrl:''},
  'club-heidenheim':{canonicalId:'club-koln',name:'1. FC Köln',shortName:'KOE',logoUrl:'https://crests.football-data.org/1.png'},
  'club-holstein-kiel':{canonicalId:'club-paderborn',name:'SC Paderborn 07',shortName:'SCP',logoUrl:'https://crests.football-data.org/29.png'},
  'club-st-pauli':{canonicalId:'club-schalke',name:'FC Schalke 04',shortName:'S04',logoUrl:'https://crests.football-data.org/6.png'},
  'club-wolfsburg':{canonicalId:'club-hamburger-sv',name:'Hamburger SV',shortName:'HSV',logoUrl:'https://crests.football-data.org/7.png'},
  'club-montpellier':{canonicalId:'club-angers',name:'Angers SCO',shortName:'ANG',logoUrl:'https://crests.football-data.org/532.png'},
  'club-nantes':{canonicalId:'club-le-havre',name:'Le Havre AC',shortName:'HAC',logoUrl:''},
  'club-reims':{canonicalId:'club-lorient',name:'FC Lorient',shortName:'LOR',logoUrl:'https://crests.football-data.org/525.png'},
};
export function correctCurrentClub<T extends {id?:string;clubId?:string}>(club:T,seasonId='season-2026-27'):T{
  const correction=seasonId==='season-2026-27'?CURRENT_CLUB_CORRECTIONS[club.clubId||club.id||'']:undefined;
  if(!correction)return club;
  const {canonicalId,...metadata}=correction;
  return {...club,...metadata,...(club.clubId?{clubName:correction.name}:{})};
}
/** Shared HTTP normalization also corrects old durable/client response snapshots without rewriting scores. */
export function correctCurrentPayload(value:any,seasonId='season-2026-27',depth=0):any{
  if(!value||typeof value!=='object'||depth>20)return value;
  if(Array.isArray(value)){
    const rows=value.map(row=>correctCurrentPayload(row,seasonId,depth+1));
    return rows.some((row,i)=>row!==value[i])?rows:value;
  }
  const scope=typeof value.seasonId==='string'?value.seasonId:seasonId;
  let result:any=correctCurrentClub(value,scope);
  for(const [key,child] of Object.entries(value)){
    const normalized=correctCurrentPayload(child,scope,depth+1);
    if(normalized!==child){if(result===value)result={...value};result[key]=normalized;}
  }
  return result;
}
