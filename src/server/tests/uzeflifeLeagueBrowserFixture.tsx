// Synthetic browser fixture only; never part of a production entry point.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../index.css';import '../../admin-preview.css';import '../../components/competition-content.css';import '../../components/uzeflife/uzeflife.css';
import {UzeflifeLeagueChampionship} from '../../components/uzeflife/UzeflifeLeagueChampionship';
import {createULeagueMatches} from '../../lib/uzeflifeLeague';
import {UZEFLIFE_PERMISSIONS} from '../../types/uzeflife';
import type {UViewState} from '../../lib/uzeflifeApi';
const admin=new URLSearchParams(location.search).get('admin')==='1';
const participants=Array.from({length:16},(_,i)=>({id:'visual-'+i,name:'@synthetic_player_'+i,status:'approved' as const}));
const matches=createULeagueMatches(participants.map(p=>p.id));matches[0].proposal={by:matches[0].home!,home:2,away:1,penaltyHome:null,penaltyAway:null};matches[0].deadlineAt=new Date(Date.now()+12*3600000).toISOString();
function Fixture(){const [s,set]=useState<UViewState>({format:'LEAGUE',name:'UZEFLIFE',description:'Sun’iy sinov ma’lumotlari',status:'playing',round:1,superAdmin:null,assistants:{},roster:participants.map((p,i)=>({group:1,slot:i+1,userId:p.id,username:p.name.slice(1),originalUsername:p.name.slice(1)})),channels:[],subscriptionsEnabled:false,participants,matches,announcements:[],revision:0,customNavigationEnabled:false,permissions:admin?[...UZEFLIFE_PERMISSIONS]:[],isSuper:admin,isOwner:admin});return <div className="efl-preview theme-dark"><main style={{padding:12,maxWidth:1100,margin:'auto'}}><UzeflifeLeagueChampionship state={s} userId={participants[0].id} initialAdmin={admin} seasonId="season-2026-27" busy={false} error="" notice="" missing={[]} onRefresh={()=>{}} act={async(action,body:any)=>{document.documentElement.dataset.lastAction=JSON.stringify({action,body});if(action==='confirmResult')set({...s,revision:s.revision+1,matches:s.matches.map(m=>m.id===body.matchId?{...m,homeScore:2,awayScore:1,proposal:null}:m)});return true;}}/></main></div>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
