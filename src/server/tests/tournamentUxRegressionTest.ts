import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TournamentOverview} from '../../components/customTournaments/TournamentOverview';
import {writeTournamentDesignReview} from './tournamentDesignReview';
import type {CustomTournament,CustomTournamentParticipant,CustomTournamentFixture} from '../../types/customTournament';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const t={id:'ct_ux',name:'UX test',organizerUserId:'owner',organizerUsername:'host',status:'REGISTRATION_OPEN',format:'LEAGUE',visibility:'PUBLIC_OPEN',spectatorAccess:'PUBLIC_LINK',maxParticipants:8,rules:{roundsCount:1,playoffLegMode:'SINGLE_LEG',matchDurationHours:36},assistantAdminIds:[],createdAt:'2026-10-14',updatedAt:'2026-10-14'} as CustomTournament;
const p={id:'p',userId:'player',clubName:'Arsenal',status:'REGISTERED'} as CustomTournamentParticipant;
const f={id:'f_l1',homeUserId:'player',awayUserId:'other',homeClubId:'club-arsenal',awayClubId:'club-ipswich',homeClubName:'Arsenal',awayClubName:'Ipswich',roundOrMatchday:1,leg:1,status:'PENDING_CONFIRMATION',submittedByUserId:'player'} as CustomTournamentFixture;
function view(options:{userId?:string;participants?:CustomTournamentParticipant[];fixtures?:CustomTournamentFixture[];status?:CustomTournament['status'];manage?:boolean;join?:boolean}={}){return renderToStaticMarkup(React.createElement(TournamentOverview,{tournament:{...t,status:options.status||t.status},participants:options.participants||[],fixtures:options.fixtures||[],userId:options.userId,canManage:options.manage||false,canJoin:options.join||false,onBack:()=>{},onManage:()=>{},onJoin:()=>{},onMatch:()=>{},onRefresh:()=>{}}));}
assert.ok(view({manage:true,userId:'owner',participants:[{...p,status:'PENDING_APPROVAL'}]}).includes('1 ariza tasdiq kutmoqda'));
assert.ok(view({join:true,userId:'new'}).includes('Klub tanlash'));
assert.ok(view({userId:'player',participants:[{...p,status:'PENDING_APPROVAL'}]}).includes('Arizangiz yuborilgan'));
assert.ok(view({status:'IN_PROGRESS',userId:'player',participants:[p],fixtures:[f]}).includes('Raqib tasdiqlashini kuting'));
assert.equal(view({status:'IN_PROGRESS',userId:'viewer',fixtures:[f]}).includes('Sizning navbatdagi o‘yiningiz'),false);
assert.equal(view({status:'IN_PROGRESS',fixtures:[{...f,homeUserId:undefined,awayUserId:undefined}]}).includes('Sizning navbatdagi o‘yiningiz'),false);
assert.equal(view({status:'IN_PROGRESS',userId:'player',participants:[p],fixtures:[{...f,id:'f_l2',leg:2,status:'SCHEDULED'}]}).includes('Hisob kiritish'),false,'Second leg waits for first-leg confirmation');
assert.equal(view({status:'CANCELLED',userId:'player',participants:[p],fixtures:[f],join:true}).includes('Hisob kiritish'),false);
assert.ok(view({status:'COMPLETED'}).includes('Yakuniy jadval'));
const previous=process.cwd(),dir=mkdtempSync(path.join(tmpdir(),'efl-ux-review-'));
const vars={VERCEL:process.env.VERCEL,VERCEL_ENV:process.env.VERCEL_ENV,EFL_RENDER_DESIGN_REVIEW:process.env.EFL_RENDER_DESIGN_REVIEW,NODE_ENV:process.env.NODE_ENV};
try{process.chdir(dir);mkdirSync('dist/assets',{recursive:true});writeFileSync('dist/assets/test.css','');process.env.VERCEL='1';process.env.VERCEL_ENV='production';process.env.EFL_RENDER_DESIGN_REVIEW='true';writeFileSync('dist/tournament-design-review.html','stale');writeTournamentDesignReview();assert.equal(existsSync('dist/tournament-design-review.html'),false,'Production never ships review fixtures even if local flag is set');process.env.VERCEL_ENV='preview';writeTournamentDesignReview();assert.ok(existsSync('dist/tournament-design-review.html'));}finally{process.chdir(previous);for(const [key,value] of Object.entries(vars)){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(dir,{recursive:true,force:true});}
console.log('PASS contextual tournament UX: owner/pending/join/wait/result/closed states, viewer and second-leg boundaries, and production exclusion of static review fixtures.');
