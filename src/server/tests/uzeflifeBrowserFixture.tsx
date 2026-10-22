// Local Vite-only visual test entry. Production builds do not include this file.
import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../index.css';
import '../../admin-preview.css';
import '../../components/competition-content.css';
import '../../components/customTournaments/tournaments.css';
import '../../components/uzeflife/uzeflife.css';
import {UzeflifeChampionship} from '../../components/uzeflife/UzeflifeChampionship';
import {uzeflifeDemo} from '../../lib/uzeflifeDemo';
import {UZEFLIFE_PERMISSIONS} from '../../types/uzeflife';
const params=new URLSearchParams(location.search);
const dark=params.get('theme')==='dark';
const participants=uzeflifeDemo.participants.map((p,i)=>({...p,name:i%2?'Abdurahmonov Muhammadazizbek':'Azamatjon Arslonov'}));
const state={...uzeflifeDemo,participants,isOwner:true,isSuper:true,permissions:[...UZEFLIFE_PERMISSIONS]};
const tab=params.get('tab');
createRoot(document.getElementById('root')!).render(<div className={`efl-preview ${dark?'theme-dark':'theme-light'}`}><main data-preview-page="leagues" style={{padding:12,maxWidth:1100,margin:'auto'}}><UzeflifeChampionship state={state} userId={participants[0].id} busy={false} error="" notice="" missing={[]} act={async()=>true} onRefresh={()=>{}} initialTab={['overview','fixtures','bracket','participants','results','standings'].includes(tab||'')?tab as any:'overview'}/></main></div>);
