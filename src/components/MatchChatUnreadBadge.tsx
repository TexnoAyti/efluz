import React from 'react';
import {useAuth} from '../context/AuthContext';
import type {MatchChatKind} from '../types/matchChat';

export function MatchChatUnreadBadge({kind,matchId}:{kind:MatchChatKind;matchId:string}){const {notifications}=useAuth();const unread=notifications.some(notification=>!notification.isRead&&notification.type==='MATCH_CHAT'&&notification.data?.kind===kind&&notification.data?.matchId===matchId);return unread?<span className="match-chat-unread" aria-label="Yangi xabar">1</span>:null;}
