import React from 'react';
import { usePremiumClubIds } from '../context/AuthContext';

export const PremiumClubBadge: React.FC<{ clubId?: string | null }> = ({ clubId }) => {
  const premiumClubIds = usePremiumClubIds();
  if (!clubId || !premiumClubIds.includes(clubId)) return null;
  return <span title="Premium club" className="inline-flex shrink-0 items-center rounded-full bg-gradient-to-r from-fuchsia-500 via-amber-300 to-sky-400 px-1.5 py-0.5 text-[8px] font-black uppercase leading-none text-slate-950">★ Premium</span>;
};
