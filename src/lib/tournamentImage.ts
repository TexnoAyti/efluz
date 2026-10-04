import type { Fixture, StandingsRow, User } from '../types';
export function canExportTournamentImage(user?: Pick<User, 'isAdmin' | 'isSuspended'> | null): boolean {
  return Boolean(user?.isAdmin && !user.isSuspended);
}
export type ExportLanguage = 'uz' | 'ru' | 'en';
export const exportCopy = {
  uz: { tableDownload: 'Jadval rasmini yuklab olish', roundDownload: 'Tur rasmini yuklab olish', download: 'Rasmni yuklab olish', busy: 'Rasm tayyorlanmoqda…', save: 'PNG yuklab olish', share: 'Ulashish', close: 'Yopish', standings: 'TURNIR JADVALI', matchday: 'TUR UCHRASHUVLARI', round: 'Tur', pending: 'Tekshiruvda', scheduled: 'Rejada', postponed: 'Qoldirilgan', created: 'Yaratilgan', cached: 'Saqlangan ma’lumotlar', empty: 'Rasm uchun ma’lumot mavjud emas.', failed: 'Rasmni tayyorlab bo‘lmadi.', club: 'Klub', stats: ['O‘', 'G‘', 'D', 'M', 'GF', 'GA', 'TF', 'Och'] },
  ru: { tableDownload: 'Скачать таблицу', roundDownload: 'Скачать матчи тура', download: 'Скачать изображение', busy: 'Подготовка…', save: 'Скачать PNG', share: 'Поделиться', close: 'Закрыть', standings: 'ТУРНИРНАЯ ТАБЛИЦА', matchday: 'МАТЧИ ТУРА', round: 'Тур', pending: 'На проверке', scheduled: 'Запланирован', postponed: 'Перенесён', created: 'Создано', cached: 'Сохранённые данные', empty: 'Нет данных для изображения.', failed: 'Не удалось создать изображение.', club: 'Клуб', stats: ['И', 'В', 'Н', 'П', 'ЗМ', 'ПМ', 'РМ', 'Оч'] },
  en: { tableDownload: 'Download standings image', roundDownload: 'Download matchday image', download: 'Download image', busy: 'Preparing image…', save: 'Download PNG', share: 'Share', close: 'Close', standings: 'LEAGUE STANDINGS', matchday: 'MATCHDAY FIXTURES', round: 'Matchday', pending: 'Under review', scheduled: 'Scheduled', postponed: 'Postponed', created: 'Created', cached: 'Cached data', empty: 'No data available to export.', failed: 'Could not create the image.', club: 'Club', stats: ['P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'PTS'] },
};
export interface TournamentImageModel {
  kind: 'standings' | 'matchday'; title: string; seasonId: string; language: ExportLanguage; round?: string;
  rows: Array<{ id: string; name: string; position?: number; stats?: number[]; awayId?: string; awayName?: string; score?: string; status?: string; winner?: 'home' | 'away' }>;
  createdAt: string; cached?: boolean;
}
export function standingsImageModel(title: string, seasonId: string, standings: StandingsRow[], language: ExportLanguage): TournamentImageModel {
  return { kind: 'standings', title, seasonId, language, createdAt: new Date().toISOString(), rows: [...standings].sort((a,b) => a.position-b.position || a.clubId.localeCompare(b.clubId)).map(row => ({ id: row.clubId, name: row.clubName, position: row.position, stats: [row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst, row.goalDifference, row.points] })) };
}
export function matchdayImageModel(title: string, seasonId: string, fixtures: Fixture[], matchday: number, language: ExportLanguage): TournamentImageModel {
  const copy = exportCopy[language];
  const selected = fixtures.filter(fixture => fixture.matchday === matchday && fixture.seasonId === seasonId).sort((a,b) => a.id.localeCompare(b.id));
  const roundNames = [...new Set(selected.map(fixture => fixture.roundName).filter(Boolean))];
  return { kind: 'matchday', title, seasonId, language, round: roundNames.length === 1 && !/^(matchday|tur|тур)\s*\d+$/i.test(roundNames[0]!) ? roundNames[0] : language === 'uz' ? `${matchday}-tur` : `${copy.round} ${matchday}`, createdAt: new Date().toISOString(), rows: selected.map(fixture => {
    const official = fixture.status === 'CONFIRMED' && fixture.homeScore != null && fixture.awayScore != null;
    return { id: fixture.homeClubId || '', name: fixture.homeClub?.name || fixture.homeClubId || 'TBD', awayId: fixture.awayClubId || '', awayName: fixture.awayClub?.name || fixture.awayClubId || 'TBD', score: official ? `${fixture.homeScore} : ${fixture.awayScore}` : 'VS', winner: official && fixture.homeScore !== fixture.awayScore ? (fixture.homeScore! > fixture.awayScore! ? 'home' : 'away') : undefined, status: official ? '' : ['DISPUTED', 'PENDING_CONFIRMATION'].includes(fixture.status) ? copy.pending : fixture.status === 'POSTPONED' ? copy.postponed : copy.scheduled };
  }) };
}
export function imageFilename(competitionId: string, kind: 'standings' | 'matchday', matchday?: number) {
  return `efluz-${competitionId.replace(/[^a-zA-Z0-9_-]/g, '')}-${kind}${matchday ? `-${matchday}` : ''}.png`;
}
export function paintTournamentImage(ctx: CanvasRenderingContext2D, model: TournamentImageModel, crests = new Map<string, CanvasImageSource>()) {
  const width = 1080, table = model.kind === 'standings';
  const rowHeight = table ? 60 : 92, top = table ? 270 : 234;
  const height = top + model.rows.length * rowHeight + 88;
  ctx.canvas.width = width; ctx.canvas.height = height;
  ctx.fillStyle = '#091321'; ctx.fillRect(0,0,width,height);
  const box = (x:number,y:number,w:number,h:number,color:string,r=12) => {
    ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();
  };
  const text = (value:string|number,x:number,y:number,size=24,color='#e8eef7',align:CanvasTextAlign='left',maxWidth?:number,weight=700) => {
    ctx.font=`${weight} ${size}px Arial, sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='middle';
    let content=String(value);
    if(maxWidth && ctx.measureText(content).width>maxWidth){
      while(content.length>1 && ctx.measureText(content+'…').width>maxWidth)content=content.slice(0,-1);
      content+='…';
    }
    ctx.fillText(content,x,y);
  };
  const crest = (id:string,name:string,x:number,y:number,size=38) => {
    const image=crests.get(id);
    if(image){
      const source=image as {naturalWidth?:number;naturalHeight?:number;width?:number;height?:number};
      const w=source.naturalWidth||source.width||size,h=source.naturalHeight||source.height||size;
      const scale=Math.min(size/w,size/h);ctx.drawImage(image,x+(size-w*scale)/2,y+(size-h*scale)/2,w*scale,h*scale);return;
    }
    box(x,y,size,size,'#23354b',8);text(name.replace(/^club-/,'').slice(0,2).toUpperCase(),x+size/2,y+size/2,16,'#adc0d7','center');
  };
  const copy=exportCopy[model.language];
  ctx.fillStyle='#34d399';ctx.fillRect(0,0,width,6);
  text('EFL UZ',44,54,30,'#55e1b1');
  text(copy[model.kind],1036,54,16,'#91a6bd','right');
  text(model.title,44,119,43,'#ffffff','left',980);
  const season=model.seasonId.replace('season-','').replace('-','/');
  box(44,158,126,36,'#192b40',9);text(season,107,176,19,'#becde0','center');
  if(model.round){ctx.font='700 19px Arial, sans-serif';box(182,158,Math.min(800,ctx.measureText(model.round).width+44),36,'#143e36',9);text(model.round,200,176,19,'#65e6bb','left',780);}
  ctx.fillStyle='#25364b';ctx.fillRect(44,212,992,1);
  if(table){
    text('#',75,242,16,'#8da3be','center');text(copy.club,151,242,17,'#8da3be');
    copy.stats.forEach((label,index)=>text(label,517+index*69,242,16,index===7?'#65e6bb':'#8da3be','center'));
  }
  model.rows.forEach((row,index)=>{
    const y=top+index*rowHeight;
    box(40,y,1000,rowHeight-6,index%2?'#101f31':'#14263a',10);
    if(table){
      const leading=row.position!<=3, trailing=model.rows.length>=18&&row.position!>model.rows.length-3;
      const accent=leading?'#55dfb0':trailing?'#dd8992':'#8da3be';
      if(leading||trailing){ctx.fillStyle=accent;ctx.fillRect(40,y+12,3,rowHeight-30);}
      text(row.position!,76,y+27,21,accent,'center');crest(row.id,row.name,103,y+8,38);
      text(row.name,151,y+27,21,'#f0f5fc','left',317);
      box(970,y+7,65,40,leading?'#174c3e':'#1b3a38',9);
      row.stats!.forEach((value,i)=>text(i===6&&value>0?`+${value}`:value,517+i*69,y+27,i===7?25:21,i===7?'#6becbe':i===6?(value>0?'#93ddc6':value<0?'#e0a2ab':'#b8c8dc'):'#d5e0ef','center'));
    }else{
      const center=y+(rowHeight-6)/2;
      crest(row.id,row.name,60,center-23,46);crest(row.awayId!,row.awayName!,974,center-23,46);
      text(row.name,119,center,21,row.winner==='home'?'#6becbe':'#edf3fb','left',320);
      text(row.awayName!,961,center,21,row.winner==='away'?'#6becbe':'#edf3fb','right',320);
      const official=row.score!=='VS';
      box(465,center-29,150,58,official?'#18483d':'#203249',12);
      text(row.score!,540,center-(row.status?8:0),official?31:24,official?'#7af1c6':'#b6c8de','center');
      if(row.status)text(row.status,540,center+16,13,'#a8bdd3','center',138,500);
    }
  });
  const footer=height-31;
  ctx.fillStyle='#25364b';ctx.fillRect(44,height-61,992,1);
  text('t.me/efluzbot',44,footer,18,'#55dfb0');
  const locale={uz:'uz-UZ',ru:'ru-RU',en:'en-GB'}[model.language];
  text(`${model.cached?copy.cached+' • ':''}${copy.created}: ${new Date(model.createdAt).toLocaleString(locale,{timeZone:'Asia/Tashkent',dateStyle:'short',timeStyle:'short'})}`,1036,footer,14,'#8da3be','right',750,500);
}
export async function tournamentImageBlob(model: TournamentImageModel): Promise<Blob> {
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
  if (!ctx || !model.rows.length) throw new Error(exportCopy[model.language].empty);
  const ids = [...new Set(model.rows.flatMap(row => [row.id,row.awayId]).filter(Boolean) as string[])];
  const crests = new Map<string, CanvasImageSource>();
  await Promise.all(ids.map(id => new Promise<void>(resolve => {
    const img = new Image(); const finish=()=>{clearTimeout(timeout);resolve();};
    const timeout=setTimeout(finish,4000);img.onload=()=>{crests.set(id,img);finish();};img.onerror=finish;
    img.src=`/api/clubs/${encodeURIComponent(id)}/crest`;
  })));
  paintTournamentImage(ctx,model,crests);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error(exportCopy[model.language].failed)),'image/png'));
}
