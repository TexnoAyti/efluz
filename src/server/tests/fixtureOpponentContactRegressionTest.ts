import assert from 'node:assert/strict';
import {fixtureOpponent} from '../../lib/fixtureOpponent';
import type {Fixture} from '../../types';

const league = {id:'old-league', competitionId:'comp-la-liga-2026', matchday:3, activeMatchday:19,
 homeClubId:'mine', awayClubId:'away', homeOwnerId:'me', awayOwnerId:'owner-away',
 awayClub:{id:'away',name:'Old round opponent',claimedByUsername:'stale_owner'},
 awayOwner:{userId:'owner-away',username:'away_player',displayName:'Away'}} as Fixture;
const cup = {id:'old-cup',competitionId:'comp-copa-del-rey-2026',matchday:1,activeMatchday:4,isPlayable:false,
 homeClubId:'home',awayClubId:'mine',homeOwnerId:'owner-home',awayOwnerId:'me',
 homeClub:{id:'home',name:'Cup opponent'},homeOwner:{userId:'owner-home',username:'@cup_player',displayName:'Cup'}} as Fixture;
assert.equal(fixtureOpponent(league,'mine')?.owner.username,'away_player');
assert.equal(fixtureOpponent(cup,'mine')?.owner.username,'cup_player','An older locked cup round still exposes its own opponent contact');
assert.equal(fixtureOpponent(league,'unrelated'),null,'A foreign club cannot accidentally select the wrong side');
assert.equal(fixtureOpponent(cup,null),null);
assert.equal(fixtureOpponent({...league,awayOwner:{userId:'new-owner',username:null,displayName:'New owner'}},'mine')?.owner.userId,'new-owner');
assert.equal(fixtureOpponent({...league,awayOwner:{userId:'new-owner',username:null,displayName:'New owner'}},'mine')?.owner.username,null,'Missing current username never falls back to a previous club owner');
assert.equal(fixtureOpponent({...league,awayOwner:{userId:'owner-away',username:'https://bad.example',displayName:'Away'}},'mine')?.owner.username,null);
assert.equal(fixtureOpponent({...league,awayOwner:{userId:'owner-away',username:'tg_123456',displayName:'Away'}},'mine')?.owner.username,null);
assert.equal(fixtureOpponent({...league,awayOwner:null,awayUser:{id:'hydrated-away',username:'hydrated_player',displayName:'Hydrated'}},'mine')?.owner.username,'hydrated_player');
console.log('PASS selected-fixture contacts: historical league/cup, both sides, closed rounds, unrelated clubs, current-owner profile fallback and unsafe/synthetic usernames');
