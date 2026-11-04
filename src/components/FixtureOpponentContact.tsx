import React from 'react';
import {Send, UserRound} from 'lucide-react';
import type {Fixture} from '../types';
import {useI18n} from '../i18n';
import {useUserProfile} from '../context/UserProfileContext';
import {fixtureOpponent} from '../lib/fixtureOpponent';
import {openTelegramChat} from '../lib/telegramUtils';

export function FixtureOpponentContact({fixture, clubId}: {fixture: Fixture; clubId?: string | null}) {
  const {language} = useI18n();
  const {openUserProfile} = useUserProfile();
  const opponent = fixtureOpponent(fixture, clubId);
  if (!opponent) return null;
  const text = {
    uz: {chat:'Raqibga yozish', profile:'Raqib profili', missing:'Raqib kontakti topilmadi. Adminga murojaat qiling.'},
    ru: {chat:'Написать сопернику', profile:'Профиль соперника', missing:'Контакт соперника не найден. Обратитесь к администратору.'},
    en: {chat:'Chat with opponent', profile:'Opponent profile', missing:'Opponent contact is unavailable. Please contact an admin.'},
  }[language];
  const {owner} = opponent;
  if (!owner.username && !owner.userId) return <p className="text-xs text-[var(--efl-text-2)]">{text.missing}</p>;
  const label = owner.username ? text.chat : text.profile;
  return <button type="button" data-guide="opponent-chat" data-fixture-contact={fixture.id}
    aria-label={`${label} · ${opponent.clubName} · ${fixture.roundName || fixture.matchday}`}
    onClick={event => {event.stopPropagation();if(owner.username)openTelegramChat(owner.username);else if(owner.userId)openUserProfile(owner.userId);}}
    className="w-full min-w-0 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-700 efl-theme-sky dark:text-sky-400 hover:bg-sky-500/20">
    {owner.username ? <Send size={16} className="shrink-0"/> : <UserRound size={16} className="shrink-0"/>}
    <span className="min-w-0 text-center"><span className="block">{label}</span>{opponent.clubName && <small className="block font-medium break-words">{opponent.clubName}</small>}</span>
  </button>;
}
