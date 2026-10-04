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
  rows: Array<{ id: string; name: string; position?: number; stats?: number[]; awayId?: string; awayName?: string; score?: string; status?: string }>;
  createdAt: string; cached?: boolean;
}
export function standingsImageModel(title: string, seasonId: string, standings: StandingsRow[], language: ExportLanguage): TournamentImageModel {
  return { kind: 'standings', title, seasonId, language, createdAt: new Date().toISOString(), rows: [...standings].sort((a,b) => a.position-b.position || a.clubId.localeCompare(b.clubId)).map(row => ({ id: row.clubId, name: row.clubName, position: row.position, stats: [row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst, row.goalDifference, row.points] })) };
}
export function matchdayImageModel(title: string, seasonId: string, fixtures: Fixture[], matchday: number, language: ExportLanguage): TournamentImageModel {
  const copy = exportCopy[language];
  const selected = fixtures.filter(fixture => fixture.matchday === matchday && fixture.seasonId === seasonId).sort((a,b) => a.id.localeCompare(b.id));
  const roundNames = [...new Set(selected.map(fixture => fixture.roundName).filter(Boolean))];
  return { kind: 'matchday', title, seasonId, language, round: roundNames.length === 1 ? roundNames[0] : `${copy.round} ${matchday}`, createdAt: new Date().toISOString(), rows: selected.map(fixture => {
    const official = fixture.status === 'CONFIRMED' && fixture.homeScore != null && fixture.awayScore != null;
    return { id: fixture.homeClubId || '', name: fixture.homeClub?.name || fixture.homeClubId || 'TBD', awayId: fixture.awayClubId || '', awayName: fixture.awayClub?.name || fixture.awayClubId || 'TBD', score: official ? `${fixture.homeScore} : ${fixture.awayScore}` : 'VS', status: official ? '' : ['DISPUTED', 'PENDING_CONFIRMATION'].includes(fixture.status) ? copy.pending : fixture.status === 'POSTPONED' ? copy.postponed : copy.scheduled };
  }) };
}
export function imageFilename(competitionId: string, kind: 'standings' | 'matchday', matchday?: number) {
  return `efluz-${competitionId.replace(/[^a-zA-Z0-9_-]/g, '')}-${kind}${matchday ? `-${matchday}` : ''}.png`;
}
export function paintTournamentImage(ctx: CanvasRenderingContext2D, model: TournamentImageModel, crests = new Map<string, CanvasImageSource>()) {
  const width = 1080, rowHeight = model.kind === 'standings' ? 64 : 108;
  const top = model.kind === 'standings' ? 306 : 260;
  const height = top + model.rows.length * rowHeight + 106;
  ctx.canvas.width = width; ctx.canvas.height = height;
  ctx.fillStyle = '#0a1220'; ctx.fillRect(0,0,width,height);
  ctx.fillStyle = '#34d399'; ctx.fillRect(0,0,width,10);
  const text = (value: string | number, x: number, y: number, size = 25, color = '#e7edf7', align: CanvasTextAlign = 'left', maxWidth?: number) => {
    ctx.font = `700 ${size}px Arial, sans-serif`; ctx.fillStyle = color; ctx.textAlign = align;
    let content = String(value);
    if (maxWidth) while (content.length > 1 && ctx.measureText(content).width > maxWidth) content = content.slice(0,-2) + '…';
    ctx.fillText(content, x, y);
  };
  const crest = (id: string, name: string, x: number, y: number) => {
    const image = crests.get(id);
    if (image) { ctx.drawImage(image,x,y,36,36); return; }
    ctx.fillStyle = '#253348'; ctx.fillRect(x,y,36,36); text(name.replace(/^club-/,'').slice(0,2).toUpperCase(),x+18,y+25,16,'#c9d5e8','center');
  };
  const copy = exportCopy[model.language];
  text('EFL UZ',48,75,35,'#34d399'); text(copy[model.kind],1032,72,18,'#93a4bf','right');
  text(model.title,48,145,44,'#ffffff','left',980);
  text(`${model.seasonId.replace('season-','').replace('-','/')}  ${model.round ? `•  ${model.round}` : ''}`,48,194,24,'#93a4bf','left',980);
  if (model.kind === 'standings') {
    ctx.fillStyle='#152236'; ctx.fillRect(40,232,1000,58);
    text('#',70,269,18); text(copy.club,143,269,20);
    copy.stats.forEach((label,index)=>text(label,515+index*70,269,18,index===7?'#34d399':'#a4b4cd','center'));
  }
  model.rows.forEach((row,index)=>{
    const y=top+index*rowHeight;
    ctx.fillStyle=index%2?'#101d2e':'#142237';ctx.fillRect(40,y,1000,rowHeight-4);
    if(model.kind==='standings'){
      text(row.position!,70,y+39,22,'#9bb0cc','center'); crest(row.id,row.name,99,y+12); text(row.name,148,y+39,22,'#ffffff','left',320);
      row.stats!.forEach((value,i)=>text(i===6&&value>0?`+${value}`:value,515+i*70,y+39,23,i===7?'#34d399':'#e7edf7','center'));
    }else{
      crest(row.id,row.name,60,y+22);text(row.name,108,y+48,23,'#ffffff','left',302);
      text(row.score!,540,y+49,30,row.score==='VS'?'#93a4bf':'#34d399','center');
      text(row.awayName!,972,y+48,23,'#ffffff','right',302);crest(row.awayId!,row.awayName!,984,y+22);
      if(row.status)text(row.status,540,y+82,17,'#93a4bf','center');
    }
  });
  const footer=height-43; text('t.me/efluzbot',48,footer,20,'#34d399');
  const locale={uz:'uz-UZ',ru:'ru-RU',en:'en-GB'}[model.language];
  text(`${model.cached ? copy.cached+' • ' : ''}${copy.created}: ${new Date(model.createdAt).toLocaleString(locale,{timeZone:'Asia/Tashkent',dateStyle:'short',timeStyle:'short'})}`,1032,footer,16,'#93a4bf','right');
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
