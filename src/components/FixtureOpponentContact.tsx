import React from 'react';
import {Send} from 'lucide-react';
import type {Fixture} from '../types';
import {useI18n} from '../i18n';
import {fixtureOpponent} from '../lib/fixtureOpponent';
import {openMatchChat} from '../lib/matchChat';
import {MatchChatUnreadBadge} from './MatchChatUnreadBadge';

export function FixtureOpponentContact({fixture, clubId}: {fixture: Fixture; clubId?: string | null}) {
  const {language} = useI18n();
  const opponent = fixtureOpponent(fixture, clubId);
  if (!opponent) return null;
  const text = {
    uz: {chat:'Raqibga yozish', profile:'Raqib profili', missing:'Raqib kontakti topilmadi. Adminga murojaat qiling.'},
    ru: {chat:'Написать сопернику', profile:'Профиль соперника', missing:'Контакт соперника не найден. Обратитесь к администратору.'},
    en: {chat:'Chat with opponent', profile:'Opponent profile', missing:'Opponent contact is unavailable. Please contact an admin.'},
  }[language];
  const {owner} = opponent;
  if (!owner.userId) return <p className="text-xs text-[var(--efl-text-2)]">{text.missing}</p>;
  const label = text.chat;
  return <button type="button" data-guide="opponent-chat" data-fixture-contact={fixture.id}
    aria-label={`${label} · ${opponent.clubName} · ${fixture.roundName || fixture.matchday}`}
    onClick={event => {event.stopPropagation();openMatchChat({kind:'fixture',matchId:fixture.id,title:opponent.clubName,opponentName:owner.displayText});}}
    className="efl-chat-trigger w-full min-w-0 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold">
    <Send size={16} className="shrink-0"/>
    <span className="min-w-0 text-center"><span className="block">{label}</span>{opponent.clubName && <small className="block font-medium break-words">{opponent.clubName}</small>}</span>
    <MatchChatUnreadBadge kind="fixture" matchId={fixture.id}/>
  </button>;
}
