/**
 * Custom Tournament Core Service
 *
 * Manages tournament lifecycle, atomic club claiming, match results,
 * dispute resolution, private/public isolation, and assistant admins.
 */

import crypto from 'node:crypto';
import { getFirestoreDb } from '../firebase/admin';
import {
  CustomTournament,
  CustomTournamentParticipant,
  CustomTournamentFixture,
  CustomTournamentStandingsRow,
  CustomTournamentAuditLog,
} from '../../types/customTournament';
import { ensureFreeTournamentTicket, spendTicketForTournament, spendTicketInTransaction } from './customTournamentTicketService';
import {
  generateRoundRobinFixtures,
  generatePlayoffBracketFixtures,
  calculateCustomStandings,
  resolvePlayoffWinner,
} from './customTournamentEngine';
import {tournamentError,assertScore,validateActualParticipants,initialSchedule,reconcilePlayoff,reconcileLeague} from './customTournamentLifecycle';
import { SEED_CLUBS } from '../db/seed';

// In-memory fallback stores for test suite
const memoryTournaments = new Map<string, CustomTournament>();
const memoryParticipants = new Map<string, CustomTournamentParticipant[]>();
const memoryFixtures = new Map<string, CustomTournamentFixture[]>();
const memoryAuditLogs = new Map<string, CustomTournamentAuditLog[]>();
const memoryClubClaims = new Map<string, string>(); // `${tournamentId}_${clubId}` -> userId

export function clearMemoryCustomTournamentStore(): void {
  memoryTournaments.clear();
  memoryParticipants.clear();
  memoryFixtures.clear();
  memoryAuditLogs.clear();
  memoryClubClaims.clear();
}

function generateSecureToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Creates a tournament in DRAFT status (0 tickets deducted).
 */
export async function createTournamentDraft(params: {
  name: string;
  description?: string;
  organizerUserId: string;
  organizerTelegramId: string;
  organizerUsername?: string;
  format: CustomTournament['format'];
  leagueScope: CustomTournament['leagueScope'];
  selectedLeagueId?: string;
  maxParticipants: number;
  rules: CustomTournament['rules'];
  visibility?: CustomTournament['visibility'];
  spectatorAccess?: CustomTournament['spectatorAccess'];
}, persist = true): Promise<CustomTournament> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const tournamentId = `ct_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();

  const tournament: CustomTournament = {
    id: tournamentId,
    name: params.name.trim(),
    description: params.description?.trim(),
    organizerUserId: params.organizerUserId,
    organizerTelegramId: params.organizerTelegramId,
    organizerUsername: params.organizerUsername,
    assistantAdminIds: [],
    status: 'DRAFT',
    visibility: params.visibility || 'PUBLIC_OPEN',
    spectatorAccess: params.spectatorAccess || 'PUBLIC_LINK',
    inviteToken: generateSecureToken('inv'),
    spectatorToken: generateSecureToken('spec'),
    format: params.format,
    leagueScope: params.leagueScope,
    selectedLeagueId: params.selectedLeagueId,
    maxParticipants: Math.max(4, Math.min(32, params.maxParticipants)),
    currentParticipantsCount: 0,
    rules: {
      roundsCount: params.rules.roundsCount || 1,
      playoffLegMode: params.rules.playoffLegMode || 'SINGLE_LEG',
      playoffQualifiersCount: params.rules.playoffQualifiersCount,
      groupStageMode: params.rules.groupStageMode,
      groupsCount: params.rules.groupsCount,
      matchDurationHours: params.rules.matchDurationHours || 36,
    },
    createdAt: now,
    updatedAt: now,
  };

  if (!persist) return tournament;

  if (isFallback) {
    memoryTournaments.set(tournamentId, tournament);
    memoryParticipants.set(tournamentId, []);
    memoryFixtures.set(tournamentId, []);
    return { ...tournament };
  }

  const db = getFirestoreDb();
  await db.collection('custom_tournaments').doc(tournamentId).set(tournament);
  return tournament;
}

/** Create an open tournament and debit its ticket in one transaction. No saved draft. */
export async function createTournament(params: Parameters<typeof createTournamentDraft>[0], idempotencyKey: string): Promise<CustomTournament> {
  if (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(idempotencyKey)) throw Object.assign(new Error('INVALID_IDEMPOTENCY_KEY'), {statusCode: 400});
  if ((params.description!==undefined&&(typeof params.description!=='string'||params.description.length>500)) || typeof params.name !== 'string' || !params.name.trim() || params.name.trim().length > 60 ||
      !['LEAGUE','PLAYOFF','LEAGUE_AND_PLAYOFF'].includes(params.format) ||
      !['TOP5_ALL','SINGLE_LEAGUE'].includes(params.leagueScope) ||
      !Number.isInteger(params.maxParticipants) || params.maxParticipants < 4 || params.maxParticipants > 32 ||
      (params.visibility && !['PRIVATE','PUBLIC_OPEN','PUBLIC_MODERATED'].includes(params.visibility)) ||
      (params.spectatorAccess && !['MEMBERS_ONLY','PUBLIC_LINK'].includes(params.spectatorAccess)) ||
      (params.leagueScope === 'SINGLE_LEAGUE' && (!SEED_CLUBS.some(club => club.leagueId === params.selectedLeagueId)||params.maxParticipants>SEED_CLUBS.filter(club=>club.leagueId===params.selectedLeagueId).length))) {
    throw Object.assign(new Error('Turnir sozlamalari noto‘g‘ri.'), {statusCode: 400});
  }
  const rules = params.rules;
  const qualifiers = rules?.playoffQualifiersCount ?? 4;
  const groups = rules?.groupsCount ?? 2;
  if (!rules || ![1,2].includes(rules.roundsCount) ||
      !['SINGLE_LEG','TWO_LEG'].includes(rules.playoffLegMode) ||
      !Number.isInteger(rules.matchDurationHours) || rules.matchDurationHours < 1 || rules.matchDurationHours > 168 ||
      (params.format === 'LEAGUE_AND_PLAYOFF' &&
        (![2,4,8,16].includes(qualifiers) || qualifiers > params.maxParticipants ||
         (rules.groupStageMode && !['SINGLE_TABLE','GROUPS'].includes(rules.groupStageMode)) ||
         (rules.groupStageMode === 'GROUPS' && (![2,4].includes(groups) || groups*2 > params.maxParticipants || qualifiers%groups !== 0))))) {
    throw Object.assign(new Error('Turnir reglamenti noto‘g‘ri. Qatnashchilar, guruhlar va pley-off sonini tekshiring.'), {statusCode:400});
  }
  const tournament = await createTournamentDraft(params, false);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    name:tournament.name, description:tournament.description, format:tournament.format,
    leagueScope:tournament.leagueScope, selectedLeagueId:tournament.selectedLeagueId,
    maxParticipants:tournament.maxParticipants, visibility:tournament.visibility,
    spectatorAccess:tournament.spectatorAccess, rules:tournament.rules,
  })).digest('hex');
  tournament.id = 'ct_' + crypto.createHash('sha256').update(params.organizerUserId + ':' + idempotencyKey).digest('hex').slice(0,24);
  tournament.status = 'REGISTRATION_OPEN'; tournament.creationFingerprint = fingerprint;
  await ensureFreeTournamentTicket(params.organizerUserId, params.organizerTelegramId);
  const replay = (existing: CustomTournament) => {
    if (existing.creationFingerprint !== fingerprint) throw Object.assign(new Error('IDEMPOTENCY_CONFLICT'), {statusCode:409});
    return existing;
  };
  const spendParams = {userId:params.organizerUserId, tournamentId:tournament.id, idempotencyKey:'create_' + tournament.id};
  if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test') {
    const existing = memoryTournaments.get(tournament.id); if (existing) return replay(existing);
    const spend = await spendTicketForTournament(spendParams);
    tournament.ticketSpentTransactionId = spend.transactionId;
    memoryTournaments.set(tournament.id,tournament); memoryParticipants.set(tournament.id,[]); memoryFixtures.set(tournament.id,[]);
    return {...tournament};
  }
  const db = getFirestoreDb(), ref = db.collection('custom_tournaments').doc(tournament.id);
  return db.runTransaction(async transaction => {
    const existing = (await transaction.get(ref)).data() as CustomTournament | undefined;
    if (existing) return replay(existing);
    const spend = await spendTicketInTransaction(spendParams, transaction);
    const created = {...tournament, ticketSpentTransactionId:spend.transactionId};
    transaction.set(ref, created);
    return created;
  });
}

/**
 * Publishes tournament: spends 1 ticket atomically and opens registration.
 */
export async function publishTournament(params: {
  tournamentId: string;
  userId: string;
  idempotencyKey: string;
}): Promise<CustomTournament> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  if (!isFallback) {
    const db = getFirestoreDb();
    const tournamentRef = db.collection('custom_tournaments').doc(params.tournamentId);
    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(tournamentRef);
      const tournament = snapshot.data() as CustomTournament | undefined;
      if (!tournament) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404, code: 'NOT_FOUND' });
      if (tournament.organizerUserId !== params.userId) {
        throw Object.assign(new Error('Faqat tashkilotchi turnirni e‘lon qila oladi.'), { statusCode: 403, code: 'UNAUTHORIZED' });
      }
      if (tournament.status !== 'DRAFT') return tournament;
      const spend = await spendTicketInTransaction(params, transaction);
      const published: CustomTournament = {
        ...tournament, status: 'REGISTRATION_OPEN', ticketSpentTransactionId: spend.transactionId, updatedAt: new Date().toISOString(),
      };
      transaction.update(tournamentRef, {
        status: published.status, ticketSpentTransactionId: published.ticketSpentTransactionId, updatedAt: published.updatedAt,
      });
      return published;
    });
  }
  const tournament = memoryTournaments.get(params.tournamentId);

  if (!tournament) {
    throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404, code: 'NOT_FOUND' });
  }

  if (tournament.organizerUserId !== params.userId) {
    throw Object.assign(new Error('Faqat tashkilotchi turnirni e‘lon qila oladi.'), {
      statusCode: 403,
      code: 'UNAUTHORIZED',
    });
  }

  if (tournament.status !== 'DRAFT') {
    return tournament; // Already published or started
  }

  // Atomically spend 1 ticket (idempotent)
  const spendResult = await spendTicketForTournament({
    userId: params.userId,
    tournamentId: params.tournamentId,
    idempotencyKey: params.idempotencyKey,
  });

  const now = new Date().toISOString();
  tournament.status = 'REGISTRATION_OPEN';
  tournament.ticketSpentTransactionId = spendResult.transactionId;
  tournament.updatedAt = now;

  memoryTournaments.set(params.tournamentId, tournament);
  return { ...tournament };
}

/**
 * Claims a club in a tournament for a user with atomic concurrency guarantees.
 * Rules:
 * 1. Exactly 1 user per club in this tournament.
 * 2. Exactly 1 club per user in this tournament.
 * 3. Club must belong to allowed league scope.
 */
export async function claimTournamentClub(params: {
  tournamentId: string;
  userId: string;
  telegramId: string;
  username?: string;
  firstName?: string;
  clubId: string;
  inviteToken?: string;
}): Promise<CustomTournamentParticipant> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const now = new Date().toISOString();

  // Validate club existence in seed
  const seedClub = SEED_CLUBS.find((c) => c.id === params.clubId);
  if (!seedClub) {
    throw Object.assign(new Error('Tanlangan klub mavjud emas.'), { statusCode: 400, code: 'INVALID_CLUB' });
  }

  if (isFallback) {
    const tournament = memoryTournaments.get(params.tournamentId);
    if (!tournament) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });
    if (tournament.visibility === 'PRIVATE' && tournament.organizerUserId !== params.userId && !tournament.assistantAdminIds.includes(params.userId) && (!params.inviteToken || params.inviteToken !== tournament.inviteToken)) {
      throw Object.assign(new Error('Klub tanlash uchun qatnashish taklif havolasi kerak.'), { statusCode: 403, code: 'INVITE_REQUIRED' });
    }
    if (tournament.status !== 'REGISTRATION_OPEN') {
      throw Object.assign(new Error('Ushbu turnirda ro‘yxatdan o‘tish yopilgan yoki turnir boshlangan.'), {
        statusCode: 400,
        code: 'REGISTRATION_CLOSED',
      });
    }

    // Check scope
    if (tournament.leagueScope === 'SINGLE_LEAGUE' && tournament.selectedLeagueId && seedClub.leagueId !== tournament.selectedLeagueId) {
      throw Object.assign(new Error('Ushbu klub turnirning tanlangan ligasiga tegishli emas.'), {
        statusCode: 400,
        code: 'CLUB_OUT_OF_SCOPE',
      });
    }

    const participants = memoryParticipants.get(params.tournamentId) || [];
    if (participants.length >= tournament.maxParticipants) {
      throw Object.assign(new Error('Turnirda barcha o‘rinlar band bo‘lgan.'), { statusCode: 400, code: 'TOURNAMENT_FULL' });
    }

    // 1 User 1 Club check
    if (participants.some((p) => p.userId === params.userId)) {
      throw Object.assign(new Error('Siz ushbu turnirda allaqachon klub tanlagansiz.'), {
        statusCode: 409,
        code: 'USER_ALREADY_HAS_CLUB',
      });
    }

    // 1 Club 1 User atomic check
    const claimKey = `${params.tournamentId}_${params.clubId}`;
    if (memoryClubClaims.has(claimKey)) {
      throw Object.assign(new Error('Bu klub boshqa ishtirokchi tomonidan band qilingan.'), {
        statusCode: 409,
        code: 'CLUB_ALREADY_TAKEN',
      });
    }

    memoryClubClaims.set(claimKey, params.userId);

    const participant: CustomTournamentParticipant = {
      id: `${params.tournamentId}_${params.clubId}`,
      tournamentId: params.tournamentId,
      userId: params.userId,
      telegramId: params.telegramId,
      username: params.username,
      firstName: params.firstName,
      clubId: params.clubId,
      clubName: seedClub.name,
      clubShortName: seedClub.shortName,
      clubLogoUrl: seedClub.logoUrl,
      status: tournament.visibility==='PUBLIC_MODERATED'&&tournament.organizerUserId!==params.userId?'PENDING_APPROVAL':'REGISTERED',
      joinedAt: now,
    };

    participants.push(participant);
    memoryParticipants.set(params.tournamentId, participants);
    tournament.currentParticipantsCount = participants.length;
    tournament.updatedAt = now;
    memoryTournaments.set(params.tournamentId, tournament);

    return participant;
  }

  // Firestore Atomic Transaction
  const db = getFirestoreDb();
  const tournRef = db.collection('custom_tournaments').doc(params.tournamentId);
  const userClaimRef = db.collection('custom_tournament_claims').doc(`${params.tournamentId}_user_${params.userId}`);
  const clubClaimRef = db.collection('custom_tournament_claims').doc(`${params.tournamentId}_club_${params.clubId}`);
  const partRef = db.collection('custom_tournament_participants').doc(`${params.tournamentId}_${params.clubId}`);

  return await db.runTransaction(async (transaction) => {
    const tournDoc = await transaction.get(tournRef);
    if (!tournDoc.exists) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });
    const tournament = tournDoc.data() as CustomTournament;

    if (tournament.visibility === 'PRIVATE' && tournament.organizerUserId !== params.userId && !tournament.assistantAdminIds.includes(params.userId) && (!params.inviteToken || params.inviteToken !== tournament.inviteToken)) {
      throw Object.assign(new Error('Klub tanlash uchun qatnashish taklif havolasi kerak.'), { statusCode: 403, code: 'INVITE_REQUIRED' });
    }
    if (tournament.status !== 'REGISTRATION_OPEN') {
      throw Object.assign(new Error('Turnirda ro‘yxatdan o‘tish yopilgan.'), { statusCode: 400, code: 'REGISTRATION_CLOSED' });
    }

    if (tournament.currentParticipantsCount >= tournament.maxParticipants) {
      throw Object.assign(new Error('Turnirda barcha o‘rinlar band bo‘lgan.'), { statusCode: 400, code: 'TOURNAMENT_FULL' });
    }

    if (tournament.leagueScope === 'SINGLE_LEAGUE' && tournament.selectedLeagueId && seedClub.leagueId !== tournament.selectedLeagueId) {
      throw Object.assign(new Error('Klub turnir ligasiga mos kelmaydi.'), { statusCode: 400, code: 'CLUB_OUT_OF_SCOPE' });
    }

    // Check user already has a club
    const userClaimDoc = await transaction.get(userClaimRef);
    if (userClaimDoc.exists) {
      throw Object.assign(new Error('Siz ushbu turnirda allaqachon klub tanlagansiz.'), { statusCode: 409, code: 'USER_ALREADY_HAS_CLUB' });
    }

    // Check club already taken
    const clubClaimDoc = await transaction.get(clubClaimRef);
    if (clubClaimDoc.exists) {
      throw Object.assign(new Error('Bu klub boshqa ishtirokchi tomonidan band qilingan.'), { statusCode: 409, code: 'CLUB_ALREADY_TAKEN' });
    }

    const participant: CustomTournamentParticipant = {
      id: `${params.tournamentId}_${params.clubId}`,
      tournamentId: params.tournamentId,
      userId: params.userId,
      telegramId: params.telegramId,
      username: params.username,
      firstName: params.firstName,
      clubId: params.clubId,
      clubName: seedClub.name,
      clubShortName: seedClub.shortName,
      clubLogoUrl: seedClub.logoUrl,
      status: tournament.visibility==='PUBLIC_MODERATED'&&tournament.organizerUserId!==params.userId?'PENDING_APPROVAL':'REGISTERED',
      joinedAt: now,
    };

    transaction.set(userClaimRef, { clubId: params.clubId, joinedAt: now });
    transaction.set(clubClaimRef, { userId: params.userId, joinedAt: now });
    transaction.set(partRef, participant);
    transaction.update(tournRef, {
      currentParticipantsCount: tournament.currentParticipantsCount + 1,
      updatedAt: now,
    });

    return participant;
  });
}

/** Start freezes registration, persists deterministic chunks, then opens play. Retry resumes safely. */
export async function startTournament(params: {tournamentId:string;userId:string}): Promise<{tournament:CustomTournament;fixturesCount:number}> {
 const fallback=process.env.FIREBASE_FORCE_LOCAL_FALLBACK==='true'||process.env.NODE_ENV==='test';
 const prepare=(t:CustomTournament|undefined,p:CustomTournamentParticipant[])=>{
  if(!t)throw tournamentError('Turnir topilmadi.',404);
  if(t.organizerUserId!==params.userId)throw tournamentError('Faqat tashkilotchi turnirni boshlay oladi.',403);
  if(t.status==='IN_PROGRESS'||t.status==='COMPLETED')return t;
  if(t.status==='STARTING')return t;
  if(t.status!=='REGISTRATION_OPEN')throw tournamentError('Turnir holati boshlashga mos emas.');
  validateActualParticipants(t,p);
  t.status='STARTING';t.startingAt=new Date().toISOString();
  t.startParticipants=p.sort((a,b)=>a.joinedAt.localeCompare(b.joinedAt)||a.id.localeCompare(b.id));return t;
 };
 if(fallback){
  const t=prepare(structuredClone(memoryTournaments.get(params.tournamentId)),structuredClone(memoryParticipants.get(params.tournamentId)||[]));
  if(t.status!=='STARTING')return {tournament:t,fixturesCount:(memoryFixtures.get(t.id)||[]).length};
  const players=t.startParticipants!,fixtures=initialSchedule(t,players,Date.parse(t.startingAt!));
  t.expectedFixturesCount=fixtures.filter(f=>f.status!=='BYE_AUTO_ADVANCED').length;t.confirmedFixturesCount=0;
  t.phase=t.format==='PLAYOFF'?'PLAYOFF':'LEAGUE';reconcilePlayoff(t,fixtures,t.startingAt!);
  t.status='IN_PROGRESS';t.startedAt=t.startingAt;t.updatedAt=t.startingAt;t.maxParticipants=players.length;t.currentParticipantsCount=players.length;delete t.startParticipants;
  memoryTournaments.set(t.id,t);memoryParticipants.set(t.id,players);memoryFixtures.set(t.id,fixtures);
  return {tournament:structuredClone(t),fixturesCount:fixtures.length};
 }
 const db=getFirestoreDb(),ref=db.collection('custom_tournaments').doc(params.tournamentId);
 const starting=await db.runTransaction(async tx=>{
  const t=(await tx.get(ref)).data() as CustomTournament|undefined;
  const p=(await tx.get(db.collection('custom_tournament_participants').where('tournamentId','==',params.tournamentId))).docs.map(d=>d.data() as CustomTournamentParticipant);
  const wasOpen=t?.status==='REGISTRATION_OPEN';const next=prepare(t,p);if(wasOpen)tx.set(ref,next);return next;
 });
 if(starting.status!=='STARTING')return {tournament:starting,fixturesCount:(await db.collection('custom_tournament_fixtures').where('tournamentId','==',params.tournamentId).get()).size};
 const players=structuredClone(starting.startParticipants!);
 const fixtures=initialSchedule(starting,players,Date.parse(starting.startingAt!));reconcilePlayoff(starting,fixtures,starting.startingAt!);
 for(let i=0;i<fixtures.length;i+=200){
  await db.runTransaction(async tx=>{
   const t=(await tx.get(ref)).data() as CustomTournament;
   if(t.status==='IN_PROGRESS'||t.status==='COMPLETED')return;
   if(t.status!=='STARTING'||t.startingAt!==starting.startingAt)throw tournamentError('Turnirni boshlash holati o‘zgargan.',409);
   for(const f of fixtures.slice(i,i+200))tx.set(db.collection('custom_tournament_fixtures').doc(f.id),f);
  });
 }
 return db.runTransaction(async tx=>{
  const t=(await tx.get(ref)).data() as CustomTournament;
  const persisted=await tx.get(db.collection('custom_tournament_fixtures').where('tournamentId','==',t.id));
  if(t.status==='IN_PROGRESS'||t.status==='COMPLETED')return {tournament:t,fixturesCount:persisted.size};
  if(t.status!=='STARTING'||t.startingAt!==starting.startingAt||persisted.size!==fixtures.length)throw tournamentError('Taqvim tayyor emas. Boshlashni qayta urining.',409);
  const next={...t,status:'IN_PROGRESS' as const,startedAt:t.startingAt,updatedAt:new Date().toISOString(),maxParticipants:players.length,currentParticipantsCount:players.length,expectedFixturesCount:fixtures.filter(f=>f.status!=='BYE_AUTO_ADVANCED').length,confirmedFixturesCount:0,phase:t.format==='PLAYOFF'?'PLAYOFF' as const:'LEAGUE' as const};
  delete next.startParticipants;
  for(const part of players)tx.set(db.collection('custom_tournament_participants').doc(part.id),part);
  tx.set(ref,next);
  const log:CustomTournamentAuditLog={id:`start_${t.id}`,tournamentId:t.id,action:'TOURNAMENT_STARTED',performedByUserId:params.userId,createdAt:next.updatedAt,details:{participants:players.length,fixtures:fixtures.length}};
  tx.set(db.collection('custom_tournament_audit_logs').doc(log.id),log);
  return {tournament:next,fixturesCount:fixtures.length};
 });
}

type LifecycleState={tournament:CustomTournament;participants:CustomTournamentParticipant[];fixtures:CustomTournamentFixture[];logs:CustomTournamentAuditLog[]};
async function mutateResult<T>(tournamentId:string,fixtureId:string,apply:(state:LifecycleState)=>T):Promise<T>{
 const fallback=process.env.FIREBASE_FORCE_LOCAL_FALLBACK==='true'||process.env.NODE_ENV==='test';
 if(fallback){
  const t=memoryTournaments.get(tournamentId);if(!t)throw tournamentError('Turnir topilmadi.',404);
  const state:LifecycleState={tournament:structuredClone(t),participants:structuredClone(memoryParticipants.get(tournamentId)||[]),fixtures:structuredClone(memoryFixtures.get(tournamentId)||[]),logs:[]};
  const result=apply(state);memoryTournaments.set(tournamentId,state.tournament);memoryFixtures.set(tournamentId,state.fixtures);
  memoryAuditLogs.set(tournamentId,[...(memoryAuditLogs.get(tournamentId)||[]),...state.logs]);return result;
 }
 const db=getFirestoreDb(),ref=db.collection('custom_tournaments').doc(tournamentId);
 return db.runTransaction(async tx=>{
  const t=(await tx.get(ref)).data() as CustomTournament|undefined;if(!t)throw tournamentError('Turnir topilmadi.',404);
  let fixtures:CustomTournamentFixture[];
  const completeRead=t.expectedFixturesCount===undefined||t.status==='COMPLETED'||(t.confirmedFixturesCount||0)+1>=t.expectedFixturesCount;
  if(completeRead)fixtures=(await tx.get(db.collection('custom_tournament_fixtures').where('tournamentId','==',tournamentId))).docs.map(d=>d.data() as CustomTournamentFixture);
  else if(t.phase==='PLAYOFF'||t.format==='PLAYOFF')fixtures=(await tx.get(db.collection('custom_tournament_fixtures').where('tournamentId','==',tournamentId).where('stage','in',['PLAYOFF_R32','PLAYOFF_R16','PLAYOFF_QF','PLAYOFF_SF','PLAYOFF_FINAL']))).docs.map(d=>d.data() as CustomTournamentFixture);
  else{const f=(await tx.get(db.collection('custom_tournament_fixtures').doc(fixtureId))).data() as CustomTournamentFixture|undefined;fixtures=f?[f]:[];}
  const parts=completeRead?(await tx.get(db.collection('custom_tournament_participants').where('tournamentId','==',tournamentId))).docs.map(d=>d.data() as CustomTournamentParticipant):[];
  if(t.expectedFixturesCount===undefined){t.expectedFixturesCount=fixtures.filter(f=>f.status!=='BYE_AUTO_ADVANCED').length;t.confirmedFixturesCount=fixtures.filter(f=>f.status==='CONFIRMED').length;}
  const previous=new Map(fixtures.map(f=>[f.id,JSON.stringify(f)]));
  const state:LifecycleState={tournament:t,participants:parts,fixtures,logs:[]};const result=apply(state);
  for(const f of state.fixtures)if(previous.get(f.id)!==JSON.stringify(f))tx.set(db.collection('custom_tournament_fixtures').doc(f.id),f);
  tx.set(ref,state.tournament);
  for(const log of state.logs)tx.set(db.collection('custom_tournament_audit_logs').doc(log.id),log);
  return result;
 });
}

/**
 * Submits match result and handles confirmation or dispute.
 */
export async function submitCustomMatchResult(params:{tournamentId:string;fixtureId:string;userId:string;homeScore:number;awayScore:number;penaltyHomeScore?:number;penaltyAwayScore?:number;proofUrl?:string}):Promise<{fixture:CustomTournamentFixture;tournamentCompleted?:boolean}>{
 return mutateResult(params.tournamentId,params.fixtureId,state=>applyScore(state,params,params.userId,false));
}
function applyScore(state:LifecycleState,params:{tournamentId:string;fixtureId:string;homeScore:number;awayScore:number;penaltyHomeScore?:number;penaltyAwayScore?:number;proofUrl?:string;note?:string},actor:string,correction:boolean){
 assertScore(params.homeScore,params.awayScore,params.penaltyHomeScore,params.penaltyAwayScore);
 const t=state.tournament,f=state.fixtures.find(row=>row.id===params.fixtureId);
 if(!f||f.tournamentId!==params.tournamentId)throw tournamentError('Match topilmadi.',404);
 const manager=t.organizerUserId===actor||t.assistantAdminIds.includes(actor);
 if(correction&&!manager)throw tournamentError('Faqat tashkilotchi yoki yordamchi admin natijani tuzata oladi.',403);
 if(!manager&&actor!==f.homeUserId&&actor!==f.awayUserId)throw tournamentError('Siz ushbu o‘yinda ishtirok etmaysiz.',403);
 if(t.status!=='IN_PROGRESS'&&!(correction&&t.status==='COMPLETED'))throw tournamentError('Turnir o‘yinlar uchun ochiq emas.',409);
 if(['TBD','BYE'].includes(f.homeClubId)||['TBD','BYE'].includes(f.awayClubId)||f.status==='BYE_AUTO_ADVANCED')throw tournamentError('Juftlik hali tayyor emas.',409);
 if(correction&&t.phase==='PLAYOFF'&&!f.stage.startsWith('PLAYOFF'))throw tournamentError('Pley-off ochilgan. Saralash natijasini o‘zgartirib bo‘lmaydi.',409);
 if(!correction&&f.status==='CONFIRMED')throw tournamentError('Ushbu natija allaqachon tasdiqlangan.',409);
 if(!manager&&f.status==='DISPUTED')throw tournamentError('Nizoni tashkilotchi yoki yordamchi admin hal qiladi.',409);
 if(f.leg===2&&f.stage.startsWith('PLAYOFF')){
  const first=state.fixtures.find(row=>row.id===f.id.replace(/_l2$/,'_l1'));
  if(!first||first.status!=='CONFIRMED')throw tournamentError('Avval birinchi o‘yin natijasini tasdiqlang.',409);
 }
 const wasConfirmed=f.status==='CONFIRMED',now=new Date().toISOString();
 if(!f.submittedByUserId||f.submittedByUserId===actor||manager){
  f.homeScore=params.homeScore;f.awayScore=params.awayScore;f.penaltyHomeScore=params.penaltyHomeScore??null;f.penaltyAwayScore=params.penaltyAwayScore??null;
  f.proofUrl=params.proofUrl??f.proofUrl??null;f.submittedByUserId=actor;
  f.status=manager?'CONFIRMED':'PENDING_CONFIRMATION';
 }else{
  const matches=f.homeScore===params.homeScore&&f.awayScore===params.awayScore&&(f.penaltyHomeScore??null)===(params.penaltyHomeScore??null)&&(f.penaltyAwayScore??null)===(params.penaltyAwayScore??null);
  f.status=matches?'CONFIRMED':'DISPUTED';
 }
 if(f.status==='CONFIRMED'){
  f.confirmedAt=now;
  if(!wasConfirmed)t.confirmedFixturesCount=(t.confirmedFixturesCount||0)+1;
  reconcilePlayoff(t,state.fixtures,now);
  if((t.confirmedFixturesCount||0)>=(t.expectedFixturesCount||Infinity))reconcileLeague(t,state.participants,state.fixtures,now);
 }
 t.updatedAt=now;
 if(manager)state.logs.push({id:'log_'+crypto.randomUUID(),tournamentId:t.id,action:correction?'DISPUTE_RESOLVED':'RESULT_OVERRIDDEN',performedByUserId:actor,createdAt:now,details:{fixtureId:f.id,homeScore:f.homeScore,awayScore:f.awayScore,penaltyHomeScore:f.penaltyHomeScore,penaltyAwayScore:f.penaltyAwayScore,note:params.note||''}});
 return {fixture:f,tournamentCompleted:t.status==='COMPLETED'};
}

function publicTournament(t:CustomTournament):CustomTournament {
 const result={...t,inviteToken:'',spectatorToken:''};delete result.startParticipants;return result;
}
/**
 * Retrieves public tournaments with pagination (Strictly hides PRIVATE tournaments).
 */
export async function getPublicTournaments(limitCount = 20): Promise<CustomTournament[]> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    return Array.from(memoryTournaments.values())
      .filter((t) => t.status !== 'DRAFT' && (t.visibility === 'PUBLIC_OPEN' || t.visibility === 'PUBLIC_MODERATED'))
      .slice(0, Math.max(1,Math.min(100,limitCount))).map(publicTournament);
  }

  const db = getFirestoreDb();
  const snap = await db
    .collection('custom_tournaments')
    .where('visibility', 'in', ['PUBLIC_OPEN', 'PUBLIC_MODERATED'])
    .where('status', '!=', 'DRAFT')
    .orderBy('createdAt', 'desc')
    .limit(Math.max(1,Math.min(100,limitCount)))
    .get();

  return snap.docs.map((d) => publicTournament(d.data() as CustomTournament));
}

/**
 * Retrieves tournaments relevant to a specific user (organized, assisted, or joined).
 */
export async function getMyTournaments(userId: string): Promise<CustomTournament[]> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    const joinedIds = new Set<string>();
    for (const [tId, pList] of memoryParticipants.entries()) {
      if (pList.some((p) => p.userId === userId)) joinedIds.add(tId);
    }
    return Array.from(memoryTournaments.values()).filter(
      (t) => t.organizerUserId === userId || t.assistantAdminIds.includes(userId) || joinedIds.has(t.id)
    ).map(t => t.organizerUserId === userId || t.assistantAdminIds.includes(userId) ? {...t, startParticipants: undefined} : publicTournament(t));
  }

  const db = getFirestoreDb();
  // Query where organizer
  const orgSnap = await db.collection('custom_tournaments').where('organizerUserId', '==', userId).get();
  const myTourns = new Map<string, CustomTournament>();
  orgSnap.docs.forEach((d) => myTourns.set(d.id, d.data() as CustomTournament));

  const assistantSnap = await db.collection('custom_tournaments').where('assistantAdminIds', 'array-contains', userId).get();
  assistantSnap.docs.forEach(d => myTourns.set(d.id, d.data() as CustomTournament));

  // Query where participant
  const partSnap = await db.collection('custom_tournament_participants').where('userId', '==', userId).get();
  for (const p of partSnap.docs) {
    const tId = p.data().tournamentId;
    if (!myTourns.has(tId)) {
      const tDoc = await db.collection('custom_tournaments').doc(tId).get();
      if (tDoc.exists) myTourns.set(tId, tDoc.data() as CustomTournament);
    }
  }

  return Array.from(myTourns.values()).map(t=>t.organizerUserId===userId||t.assistantAdminIds.includes(userId)?{...t,startParticipants:undefined}:publicTournament(t));
}

/**
 * Retrieves a tournament by ID, validating private token or membership access.
 */
export async function getTournamentByIdWithAccess(
  tournamentId: string,
  requesterUserId?: string,
  token?: string
): Promise<{
  tournament: CustomTournament;
  participants: CustomTournamentParticipant[];
  fixtures: CustomTournamentFixture[];
  standings?: CustomTournamentStandingsRow[];
  canManage: boolean;
  canJoin: boolean;
}> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  let tournament: CustomTournament | undefined;
  let participants: CustomTournamentParticipant[] = [];
  let fixtures: CustomTournamentFixture[] = [];

  if (isFallback) {
    tournament = memoryTournaments.get(tournamentId);
    participants = memoryParticipants.get(tournamentId) || [];
    fixtures = memoryFixtures.get(tournamentId) || [];
  } else {
    const db = getFirestoreDb();
    const tDoc = await db.collection('custom_tournaments').doc(tournamentId).get();
    tournament = tDoc.data() as CustomTournament;
    if (!tournament) throw tournamentError('Turnir topilmadi.', 404);
    const manager = requesterUserId && (tournament.organizerUserId === requesterUserId || tournament.assistantAdminIds.includes(requesterUserId));
    const restricted = tournament.visibility === 'PRIVATE' || tournament.status === 'DRAFT' || (tournament.spectatorAccess === 'MEMBERS_ONLY' && tournament.status !== 'REGISTRATION_OPEN');
    if (!manager && restricted) {
      const member = requesterUserId && (await db.collection('custom_tournament_claims').doc(`${tournamentId}_user_${requesterUserId}`).get()).exists;
      const linkAccess = tournament.spectatorAccess === 'PUBLIC_LINK' && token && (token === tournament.inviteToken || token === tournament.spectatorToken);
      const admission = tournament.status === 'REGISTRATION_OPEN' && token === tournament.inviteToken;
      if (tournament.status === 'DRAFT') throw tournamentError('Qoralamani faqat tashkilotchi va yordamchi ko‘ra oladi.', 403);
      if (!member && !linkAccess && !admission) throw tournamentError('Bu turnirni ko‘rish uchun ruxsat yo‘q.', 403);
    }
    const pSnap = await db.collection('custom_tournament_participants').where('tournamentId', '==', tournamentId).get();
    participants = pSnap.docs.map((d) => d.data() as CustomTournamentParticipant);
    if (tournament.status !== 'STARTING') {
      const fSnap = await db.collection('custom_tournament_fixtures').where('tournamentId', '==', tournamentId).get();
      fixtures = fSnap.docs.map((d) => d.data() as CustomTournamentFixture);
    }
  }

  if (!tournament) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });

  const isOrganizer = requesterUserId ? tournament.organizerUserId === requesterUserId : false;
  const isAssistant = requesterUserId ? tournament.assistantAdminIds.includes(requesterUserId) : false;
  const isParticipant = requesterUserId ? participants.some((p) => p.userId === requesterUserId) : false;
  const isInvite=Boolean(token&&token===tournament.inviteToken);
  const isTokenMatch=isInvite||Boolean(tournament.spectatorAccess==='PUBLIC_LINK'&&token&&token===tournament.spectatorToken);

  if (tournament.status === 'DRAFT' && !isOrganizer && !isAssistant) throw Object.assign(new Error('Qoralamani faqat tashkilotchi va yordamchi ko‘ra oladi.'), { statusCode: 403 });

  // Private tournament security boundary
  if (tournament.visibility === 'PRIVATE' && !isOrganizer && !isAssistant && !isParticipant && !isTokenMatch) {
    throw Object.assign(new Error('Bu yopiq (private) turnir. Ko‘rish uchun taklif havolasi talab qilinadi.'), {
      statusCode: 403,
      code: 'PRIVATE_ACCESS_DENIED',
    });
  }

  if(tournament.spectatorAccess==='MEMBERS_ONLY'&&!isOrganizer&&!isAssistant&&!isParticipant&&!(isInvite&&tournament.status==='REGISTRATION_OPEN')&&!(tournament.visibility!=='PRIVATE'&&tournament.status==='REGISTRATION_OPEN'))throw tournamentError('Bu turnirni faqat a’zolar ko‘ra oladi.',403);

  // Calculate standings if league stage exists
  let standings: CustomTournamentStandingsRow[] | undefined;
  if (tournament.format === 'LEAGUE' || tournament.format === 'LEAGUE_AND_PLAYOFF') {
    standings = tournament.rules.groupStageMode==='GROUPS'?Array.from({length:tournament.rules.groupsCount||2},(_,g)=>calculateCustomStandings(participants.filter(p=>p.status==='REGISTERED'),fixtures,g)).flat():calculateCustomStandings(participants.filter(p=>p.status==='REGISTERED'),fixtures);
  }

  return {
    tournament: isOrganizer || isAssistant ? {...tournament,startParticipants:undefined} : publicTournament(tournament),
    participants,
    fixtures: tournament.status==='STARTING'?[]:fixtures,
    standings,
    canManage: isOrganizer || isAssistant,
    canJoin: Boolean(requesterUserId) && !isParticipant && participants.length<tournament.maxParticipants && tournament.status === 'REGISTRATION_OPEN' && (tournament.visibility !== 'PRIVATE' || isOrganizer || isAssistant || Boolean(token && token === tournament.inviteToken)),
  };
}

/**
 * Leaves tournament before start, freeing up the club claim.
 */
export async function leaveTournamentClub(params: {
  tournamentId: string;
  userId: string;
}): Promise<{ success: boolean; freedClubId: string }> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const now = new Date().toISOString();

  if (isFallback) {
    const tournament = memoryTournaments.get(params.tournamentId);
    if (!tournament) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });
    if (tournament.status !== 'REGISTRATION_OPEN') {
      throw Object.assign(new Error('Turnir boshlangandan keyin chiqib ketish mumkin emas (texnik mag‘lubiyat qo‘llanadi).'), {
        statusCode: 400,
        code: 'CANNOT_LEAVE_STARTED_TOURNAMENT',
      });
    }

    const participants = memoryParticipants.get(params.tournamentId) || [];
    const partIdx = participants.findIndex((p) => p.userId === params.userId);
    if (partIdx === -1) {
      throw Object.assign(new Error('Siz bu turnirda qatnashmaysiz.'), { statusCode: 404 });
    }

    const freedClubId = participants[partIdx].clubId;
    participants.splice(partIdx, 1);
    memoryParticipants.set(params.tournamentId, participants);
    memoryClubClaims.delete(`${params.tournamentId}_${freedClubId}`);

    tournament.currentParticipantsCount = participants.length;
    tournament.updatedAt = now;
    memoryTournaments.set(params.tournamentId, tournament);

    return { success: true, freedClubId };
  }

  const db = getFirestoreDb();
  const tournRef = db.collection('custom_tournaments').doc(params.tournamentId);
  const userClaimRef = db.collection('custom_tournament_claims').doc(`${params.tournamentId}_user_${params.userId}`);

  return await db.runTransaction(async (transaction) => {
    const tournDoc = await transaction.get(tournRef);
    if (!tournDoc.exists) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });
    const tournament = tournDoc.data() as CustomTournament;

    if (tournament.status !== 'REGISTRATION_OPEN') {
      throw Object.assign(new Error('Turnir boshlangandan keyin chiqib ketish mumkin emas.'), {
        statusCode: 400,
        code: 'CANNOT_LEAVE_STARTED_TOURNAMENT',
      });
    }

    const userClaimDoc = await transaction.get(userClaimRef);
    if (!userClaimDoc.exists) {
      throw Object.assign(new Error('Siz bu turnirda qatnashmaysiz.'), { statusCode: 404 });
    }

    const freedClubId = userClaimDoc.data()?.clubId;
    const clubClaimRef = db.collection('custom_tournament_claims').doc(`${params.tournamentId}_club_${freedClubId}`);
    const partRef = db.collection('custom_tournament_participants').doc(`${params.tournamentId}_${freedClubId}`);

    transaction.delete(userClaimRef);
    transaction.delete(clubClaimRef);
    transaction.delete(partRef);
    transaction.update(tournRef, {
      currentParticipantsCount: Math.max(0, tournament.currentParticipantsCount - 1),
      updatedAt: now,
    });

    return { success: true, freedClubId };
  });
}

/**
 * Manages assistant admins for the tournament (Organizer only).
 */
export async function updateAssistantAdmins(params: {
  tournamentId: string; organizerUserId: string; assistantUserId: string; action: 'ADD' | 'REMOVE';
}): Promise<{ assistantAdminIds: string[] }> {
  if (!['ADD', 'REMOVE'].includes(params.action) || typeof params.assistantUserId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(params.assistantUserId)) throw tournamentError('Yordamchining foydalanuvchi IDsi noto‘g‘ri.');
  const apply = (t: CustomTournament | undefined) => {
    if (!t) throw tournamentError('Turnir topilmadi.', 404);
    if (t.organizerUserId !== params.organizerUserId) throw tournamentError('Faqat tashkilotchi yordamchi adminlarni boshqara oladi.', 403);
    if (params.assistantUserId === t.organizerUserId) throw tournamentError('Tashkilotchi allaqachon boshqaruv huquqiga ega.');
    const ids = new Set(t.assistantAdminIds || []);
    if (params.action === 'ADD') ids.add(params.assistantUserId); else ids.delete(params.assistantUserId);
    if (ids.size > 10) throw tournamentError('Ko‘pi bilan 10 ta yordamchi tayinlash mumkin.');
    return {assistantAdminIds: [...ids], updatedAt: new Date().toISOString()};
  };
  if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test') {
    const t = memoryTournaments.get(params.tournamentId), next = apply(t);
    Object.assign(t!, next); return {assistantAdminIds: next.assistantAdminIds};
  }
  const db = getFirestoreDb(), ref = db.collection('custom_tournaments').doc(params.tournamentId);
  return db.runTransaction(async tx => {
    const next = apply((await tx.get(ref)).data() as CustomTournament | undefined);
    if (params.action === 'ADD' && !(await tx.get(db.collection('users').doc(params.assistantUserId))).exists) throw tournamentError('Foydalanuvchi topilmadi.', 404);
    tx.update(ref, next); return {assistantAdminIds: next.assistantAdminIds};
  });
}

/**
 * Administrative dispute resolution or manual score correction with audit trail.
 */
export async function correctCustomMatchScore(params:{tournamentId:string;fixtureId:string;adminUserId:string;homeScore:number;awayScore:number;penaltyHomeScore?:number;penaltyAwayScore?:number;note?:string}):Promise<{fixture:CustomTournamentFixture}>{
 return mutateResult(params.tournamentId,params.fixtureId,state=>applyScore(state,params,params.adminUserId,true));
}

/**
 * Retrieves audit logs for a tournament (Admin / Host only).
 */
export async function getTournamentAuditLogs(tournamentId: string, requesterUserId: string): Promise<CustomTournamentAuditLog[]> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const tournament = isFallback ? memoryTournaments.get(tournamentId) : (await getFirestoreDb().collection('custom_tournaments').doc(tournamentId).get()).data() as CustomTournament | undefined;
  if (!tournament || (tournament.organizerUserId !== requesterUserId && !tournament.assistantAdminIds.includes(requesterUserId))) throw tournamentError('Faqat tashkilotchi yoki yordamchi admin auditni ko‘ra oladi.', 403);
  if (isFallback) return memoryAuditLogs.get(tournamentId) || [];
  const db = getFirestoreDb();
  const snap = await db
    .collection('custom_tournament_audit_logs')
    .where('tournamentId', '==', tournamentId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return snap.docs.map((d) => d.data() as CustomTournamentAuditLog);
}

/** Moderated entry: pending claims reserve a place until an organizer or assistant decides. */
export async function reviewTournamentParticipant(params:{tournamentId:string;targetUserId:string;adminUserId:string;action:'APPROVE'|'REJECT'}){
 if(!['APPROVE','REJECT'].includes(params.action))throw tournamentError('Ariza amali noto‘g‘ri.');
 const now=new Date().toISOString();
 const authorize=(t:CustomTournament|undefined)=>{
  if(!t)throw tournamentError('Turnir topilmadi.',404);
  if(t.organizerUserId!==params.adminUserId&&!t.assistantAdminIds.includes(params.adminUserId))throw tournamentError('Arizani faqat tashkilotchi yoki yordamchi admin boshqaradi.',403);
  if(t.status!=='REGISTRATION_OPEN')throw tournamentError('Ro‘yxatdan o‘tish yopilgan.',409);return t;
 };
 const validate=(p:CustomTournamentParticipant|undefined)=>{if(!p||p.status!=='PENDING_APPROVAL')throw tournamentError('Kutilayotgan ariza topilmadi.',409);return p;};
 const log:CustomTournamentAuditLog={id:'review_'+crypto.randomUUID(),tournamentId:params.tournamentId,action:params.action==='APPROVE'?'PARTICIPANT_APPROVED':'PARTICIPANT_REJECTED',performedByUserId:params.adminUserId,createdAt:now,details:{userId:params.targetUserId}};
 if(process.env.FIREBASE_FORCE_LOCAL_FALLBACK==='true'||process.env.NODE_ENV==='test'){
  const t=authorize(memoryTournaments.get(params.tournamentId)),players=memoryParticipants.get(t.id)||[];
  const p=validate(players.find(row=>row.userId===params.targetUserId));
  if(params.action==='APPROVE')p.status='REGISTERED';else{memoryParticipants.set(t.id,players.filter(row=>row.userId!==p.userId));memoryClubClaims.delete(`${t.id}_${p.clubId}`);t.currentParticipantsCount--;}
  memoryAuditLogs.set(t.id,[...(memoryAuditLogs.get(t.id)||[]),log]);return {success:true};
 }
 const db=getFirestoreDb(),ref=db.collection('custom_tournaments').doc(params.tournamentId),claim=db.collection('custom_tournament_claims').doc(`${params.tournamentId}_user_${params.targetUserId}`);
 return db.runTransaction(async tx=>{
  const t=authorize((await tx.get(ref)).data() as CustomTournament|undefined),clubId=(await tx.get(claim)).data()?.clubId;
  if(!clubId)throw tournamentError('Kutilayotgan ariza topilmadi.',409);
  const partRef=db.collection('custom_tournament_participants').doc(`${t.id}_${clubId}`),p=validate((await tx.get(partRef)).data() as CustomTournamentParticipant|undefined);
  if(params.action==='APPROVE')tx.update(partRef,{status:'REGISTERED'});
  else{tx.delete(partRef);tx.delete(claim);tx.delete(db.collection('custom_tournament_claims').doc(`${t.id}_club_${clubId}`));tx.update(ref,{currentParticipantsCount:Math.max(0,t.currentParticipantsCount-1),updatedAt:now});}
  tx.set(db.collection('custom_tournament_audit_logs').doc(log.id),log);return {success:true};
 });
}
