import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {CompetitionFixtureCard,CompetitionStandings,CompetitionRounds,type StandingsView} from '../../components/CompetitionContent';

// Preserve names, profile actions, zero results, qualifiers and form in all league views.
const h=React.createElement;
const rows=[{id:'arsenal',position:1,identity:h(React.Fragment,null,h('span',null,'Arsenal'),h('button',{type:'button'},'@captain')),played:3,won:1,drawn:1,lost:1,goalsFor:4,goalsAgainst:4,goalDifference:0,points:4,form:['W','D','L'],highlighted:true,positionMarker:h('span',{title:'Pley-off o‘rni'})}];
const before=JSON.stringify(rows);
for(const view of ['short','full','form'] as StandingsView[]){
 const html=render(h(CompetitionStandings,{rows,title:'Test league',view,onViewChange:()=>{}}));
 assert.ok(html.includes(`efl-standings--${view}`));
 for(const label of ['Arsenal','@captain','Pley-off o‘rni','Test league','Qisqa','To‘liq','Forma'])assert.ok(html.includes(label));
 assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
 assert.ok(html.includes('active-club-highlight'));
 for(const result of ['w','d','l'])assert.ok(html.includes(`efl-form-result--${result}`));
 assert.match(html,/competition-points[^>]*>4<\/td>/);
}
assert.equal(JSON.stringify(rows),before,'Rendering never mutates standings or rankings');
const empty=render(h(CompetitionStandings,{rows:[],title:'Draft',view:'short',onViewChange:()=>{}}));
assert.ok(empty.includes('Jadval hali shakllanmagan.'));
assert.equal(empty.includes('NaN'),false);
const card=render(h(CompetitionFixtureCard,{caption:'Cup · 2-tur',status:'Yakunlangan',home:h('b',null,'Home Club'),away:h('b',null,'Away Club'),score:h(React.Fragment,null,'0 : 0',h('small',null,'pen: 4-3'))},h('button',{type:'button'},'Hisobni tuzatish')));
for(const label of ['Home Club','Away Club','0 : 0','pen: 4-3','Hisobni tuzatish','Cup · 2-tur'])assert.ok(card.includes(label));
assert.equal(card.includes('aria-label="Uchrashuvni ochish"'),false,'A completed read-only card creates no implicit scoring action');
const actionable=render(h(CompetitionFixtureCard,{caption:'Team cup',status:'Tarkib kutilmoqda',home:'Home',away:'Away',score:'vs',onClick:()=>{}}));
assert.ok(actionable.includes('type="button" class="competition-fixture-teams"'));
const rounds=render(h(CompetitionRounds<string>,{items:[{id:'LEAGUE:1',label:'Liga · Tur 1'},{id:'PLAYOFF_SF:1',label:'Yarim final · Tur 1'}],value:'PLAYOFF_SF:1',onChange:()=>{}}));
assert.equal((rounds.match(/aria-pressed="true"/g)||[]).length,1,'Stage and round remain distinct even when round numbers coincide');
assert.ok(rounds.includes('Yarim final · Tur 1'));
console.log('PASS shared competition content: names, profile actions, rankings, qualifiers, all table views, form, empty state, zero scores, penalties and stage-aware rounds.');
