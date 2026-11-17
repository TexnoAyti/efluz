import type {Club, Competition, Fixture} from '../types';

/** Screenshot guide data only — never creates server-side identities, ownership,
 * fixture results or Telegram messages. The actual React player components render it.
 * The preview flag is restricted to local dev and Vercel Preview builds. */
export const guidePreviewCompetition:Competition={
 id:'comp-premier-league-2027',seasonId:'season-2027-28',
 leagueId:'league-premier-league',name:'APL (2-mavsum)',type:'LEAGUE',
 scheduleMode:'GENERATED_SCHEDULE',status:'active',
 totalTeams:20,totalMatchdays:19,currentMatchday:1,
 resultEntryThroughMatchday:19,isMatchdayOpen:true,adminOverrideStatus:'AUTO',
 formatConfig:{rounds:19,totalClubs:20,homeAndAway:false},createdAt:'',
};
const club=(id:string,name:string,shortName:string):Club=>({
 id,name,shortName,country:'England',leagueId:'league-premier-league',
 logoUrl:'',active:true,createdAt:'',
});
const arsenal=club('club-arsenal','Arsenal','ARS');
const chelsea=club('club-chelsea','Chelsea','CHE');
const liverpool=club('club-liverpool','Liverpool','LIV');
const manCity=club('club-manchester-city','Manchester City','MCI');
export const guidePreviewFixtures:Fixture[]=[
 {
  id:'guide-fixture-md7',seasonId:'season-2027-28',competitionId:guidePreviewCompetition.id,
  competitionName:guidePreviewCompetition.name,matchday:7,roundName:'7-tur',
  homeClubId:arsenal.id,awayClubId:chelsea.id,homeClub:arsenal,awayClub:chelsea,
  homeOwnerId:'design-preview',awayOwnerId:'guide-opponent',
  homeOwner:{userId:'design-preview',username:'design_preview',displayName:'Sinov o‘yinchi'},
  awayOwner:{userId:'guide-opponent',username:'guide_raqib',displayName:'Sinov raqib'},
  scheduledAt:'2026-11-17T15:00:00.000Z',status:'SCHEDULED',isPlayable:true,
  activeMatchday:1,createdAt:'',updatedAt:'',
 },
 {
  id:'guide-fixture-md7-other',seasonId:'season-2027-28',competitionId:guidePreviewCompetition.id,
  competitionName:guidePreviewCompetition.name,matchday:7,roundName:'7-tur',
  homeClubId:liverpool.id,awayClubId:manCity.id,homeClub:liverpool,awayClub:manCity,
  scheduledAt:'2026-11-17T15:00:00.000Z',status:'SCHEDULED',isPlayable:true,
  activeMatchday:1,createdAt:'',updatedAt:'',
 }
];
