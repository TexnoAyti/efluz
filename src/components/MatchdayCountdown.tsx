import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface MatchdayCountdownProps {
  targetIso?: string | null;
  onExpire?: () => void;
  className?: string;
  showIcon?: boolean;
}

export const MatchdayCountdown: React.FC<MatchdayCountdownProps> = ({
  targetIso,
  onExpire,
  className = '',
  showIcon = true,
}) => {
  const [timeLeft, setTimeLeft] = useState<{
    formatted: string;
    isExpired: boolean;
  }>({
    formatted: '--:--:--',
    isExpired: false,
  });

  useEffect(() => {
    if (!targetIso) {
      setTimeLeft({ formatted: 'Qulflangan', isExpired: false });
      return;
    }

    const calculateTime = () => {
      const targetTime = new Date(targetIso).getTime();
      const now = Date.now();
      const diffMs = targetTime - now;

      if (isNaN(targetTime) || diffMs <= 0) {
        setTimeLeft({ formatted: '00:00:00', isExpired: true });
        if (diffMs <= 0 && onExpire) {
          onExpire();
        }
        return;
      }

      const totalSeconds = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const formatted = `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

      setTimeLeft({ formatted, isExpired: false });
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [targetIso, onExpire]);

  return (
    <span className={`inline-flex items-center gap-1 font-mono font-bold ${className}`}>
      {showIcon && <Clock className="w-3 h-3 shrink-0 text-amber-400 animate-pulse" />}
      <span>{timeLeft.formatted}</span>
    </span>
  );
};
