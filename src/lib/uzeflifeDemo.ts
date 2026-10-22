import {createUzeflifeMatches} from './uzeflifeBracket';
import type {UState} from '../types/uzeflife';
// Bundled synthetic data only; design preview never requests the UZEFLIFE API.
const participants=Array.from({length:256},(_,i)=>({id:`demo-uz-${i+1}`,name:`Namuna ishtirokchi ${i+1}`,status:'approved' as const}));
const matches=createUzeflifeMatches(participants.map(p=>p.id));
export const uzeflifeDemo:UState&{permissions:[];isSuper:false;isOwner:false}={name:'UZEFLIFE',description:'Namoyish: 256 ishtirokchi, 8 ta saralash setkasi va final bosqichi. Barcha ismlar va natijalar sun’iy.',status:'playing',round:1,superAdmin:null,assistants:{},channels:[],subscriptionsEnabled:false,customNavigationEnabled:false,participants,matches,announcements:[],revision:0,permissions:[],isSuper:false,isOwner:false};
