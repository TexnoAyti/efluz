import React, { useState } from 'react';
import { Shield } from 'lucide-react';

export interface ClubCrestProps {
  clubId?: string;
  logoUrl?: string | null;
  name?: string;
  shortName?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'custom';
  className?: string;
  imgClassName?: string;
  alt?: string;
  priorityProxy?: boolean;
}

const SIZE_CONTAINER_CLASSES: Record<string, string> = {
  xs: 'w-4 h-4',
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
  xl: 'w-16 h-16',
  '2xl': 'w-20 h-20',
  custom: '',
};

const SIZE_TEXT_CLASSES: Record<string, string> = {
  xs: 'text-[8px] font-black',
  sm: 'text-[9px] font-black',
  md: 'text-[10px] font-black',
  lg: 'text-xs font-black',
  xl: 'text-sm font-black',
  '2xl': 'text-base font-black',
  custom: 'text-xs font-black',
};

// Generate initials from club shortName or name
function getClubInitials(shortName?: string, name?: string): string {
  if (shortName && shortName.trim().length > 0) {
    return shortName.trim().slice(0, 3).toUpperCase();
  }
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 3).toUpperCase();
  }
  return 'FC';
}

// Generate consistent background color based on name/shortName
function getClubColorHash(name?: string): string {
  if (!name) return 'from-slate-800 to-slate-900 text-slate-200 border-slate-700/60';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const gradients = [
    'from-blue-900/90 to-slate-950 text-blue-300 border-blue-500/30',
    'from-emerald-900/90 to-slate-950 text-emerald-300 border-emerald-500/30',
    'from-red-900/90 to-slate-950 text-red-300 border-red-500/30',
    'from-amber-900/90 to-slate-950 text-amber-300 border-amber-500/30',
    'from-indigo-900/90 to-slate-950 text-indigo-300 border-indigo-500/30',
    'from-purple-900/90 to-slate-950 text-purple-300 border-purple-500/30',
    'from-cyan-900/90 to-slate-950 text-cyan-300 border-cyan-500/30',
  ];
  return gradients[Math.abs(hash) % gradients.length];
}

export const ClubCrest: React.FC<ClubCrestProps> = ({
  clubId,
  logoUrl,
  name,
  shortName,
  size = 'md',
  className = '',
  imgClassName = '',
  alt,
  priorityProxy = false,
}) => {
  // Retry state machine: 0 = primary src, 1 = proxy src, 2 = fallback UI
  const [attempt, setAttempt] = useState<number>(0);

  // Compute image URLs
  const directUrl = logoUrl?.trim() || null;
  const proxyUrl = clubId
    ? `/api/clubs/${clubId}/crest`
    : directUrl
    ? `/api/clubs/crest-proxy?url=${encodeURIComponent(directUrl)}`
    : null;

  // Determine initial URL based on priorityProxy or known blocked hostnames
  const isBlockedDomain = directUrl?.includes('football-data.org');
  let currentSrc: string | null = null;

  if (attempt === 0) {
    if (priorityProxy || isBlockedDomain) {
      currentSrc = proxyUrl || directUrl;
    } else {
      currentSrc = directUrl || proxyUrl;
    }
  } else if (attempt === 1) {
    currentSrc = attempt === 1 && currentSrc !== proxyUrl && proxyUrl ? proxyUrl : null;
  } else {
    currentSrc = null;
  }

  const containerSizeClass = SIZE_CONTAINER_CLASSES[size] || SIZE_CONTAINER_CLASSES.md;
  const textSizeClass = SIZE_TEXT_CLASSES[size] || SIZE_TEXT_CLASSES.md;
  const initials = getClubInitials(shortName, name);
  const colorScheme = getClubColorHash(shortName || name);

  const handleError = () => {
    if (attempt === 0 && proxyUrl && currentSrc !== proxyUrl) {
      // Try proxy fallback
      setAttempt(1);
    } else {
      // Fallback to stylized initials badge
      setAttempt(2);
    }
  };

  // If no URL available or all image attempts failed -> render fallback shield
  if (!currentSrc || attempt >= 2) {
    return (
      <div
        className={`relative inline-flex items-center justify-center shrink-0 rounded-lg bg-gradient-to-br ${colorScheme} border shadow-inner select-none overflow-hidden ${containerSizeClass} ${className}`}
        title={name || shortName || 'Club Crest'}
        aria-label={alt || name || shortName || 'Club Crest'}
      >
        <span className={`tracking-wider uppercase ${textSizeClass}`}>
          {initials}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 overflow-hidden ${containerSizeClass} ${className}`}
    >
      <img
        src={currentSrc}
        alt={alt || name || shortName || 'Club Crest'}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onError={handleError}
        className={`w-full h-full object-contain pointer-events-none transition-opacity duration-200 ${imgClassName}`}
      />
    </div>
  );
};
