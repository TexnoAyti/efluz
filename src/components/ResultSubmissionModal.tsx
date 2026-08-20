import React, { useState } from 'react';
import { Fixture } from '../types';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import confetti from 'canvas-confetti';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Link,
  Shield,
  Loader2,
  Clock,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

interface ResultSubmissionModalProps {
  fixture: Fixture;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedFixture: Fixture) => void;
}

export const ResultSubmissionModal: React.FC<ResultSubmissionModalProps> = ({
  fixture,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { user, showToast } = useAuth();

  // Determine whether current user is Home or Away
  const isHomeOwner = fixture.homeOwnerId === user?.id;
  const isAwayOwner = fixture.awayOwnerId === user?.id;

  const [homeScore, setHomeScore] = useState<number>(
    fixture.userSubmission ? fixture.userSubmission.homeScore : 0
  );
  const [awayScore, setAwayScore] = useState<number>(
    fixture.userSubmission ? fixture.userSubmission.awayScore : 0
  );
  const [proofUrl, setProofUrl] = useState<string>(
    fixture.userSubmission?.proofUrl || ''
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await api.submitFixtureResult(fixture.id, homeScore, awayScore, proofUrl.trim() || undefined);

      if (res.fixture.status === 'CONFIRMED') {
        // Trigger celebratory confetti
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
        });
        showToast('Match Result Confirmed! Standings have been updated.', 'success');
      } else if (res.fixture.status === 'DISPUTED') {
        showToast('Score mismatch! Match sent to Admin Dispute Center.', 'error');
      } else {
        showToast('Score submitted! Waiting for opponent confirmation.', 'info');
      }

      onSuccess(res.fixture);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit score.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleScoreAdjust = (team: 'home' | 'away', delta: number) => {
    if (team === 'home') {
      setHomeScore((prev) => Math.max(0, prev + delta));
    } else {
      setAwayScore((prev) => Math.max(0, prev + delta));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-white flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-800/40">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-100">Submit Match Result</h3>
              <p className="text-[11px] text-slate-400">
                {fixture.competitionName} • {fixture.roundName || `Matchday ${fixture.matchday}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-5">
          {/* Match Teams Banner */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
            <div className="grid grid-cols-5 items-center gap-2 text-center">
              {/* Home Team */}
              <div className="col-span-2 flex flex-col items-center">
                <div className="w-14 h-14 rounded-full bg-slate-800/80 p-2 border border-slate-700 flex items-center justify-center mb-2 shadow-inner">
                  <img
                    src={fixture.homeClub?.logoUrl}
                    alt={fixture.homeClub?.name}
                    className="w-10 h-10 object-contain"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
                <div className="font-black text-sm text-slate-100">{fixture.homeClub?.name}</div>
                <span className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                  {isHomeOwner ? '(You)' : fixture.homeOwnerId ? 'Claimed' : 'Unclaimed'}
                </span>
              </div>

              {/* VS Divider */}
              <div className="col-span-1 flex flex-col items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-slate-800/90 text-slate-400 font-black text-xs flex items-center justify-center border border-slate-700">
                  VS
                </div>
              </div>

              {/* Away Team */}
              <div className="col-span-2 flex flex-col items-center">
                <div className="w-14 h-14 rounded-full bg-slate-800/80 p-2 border border-slate-700 flex items-center justify-center mb-2 shadow-inner">
                  <img
                    src={fixture.awayClub?.logoUrl}
                    alt={fixture.awayClub?.name}
                    className="w-10 h-10 object-contain"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
                <div className="font-black text-sm text-slate-100">{fixture.awayClub?.name}</div>
                <span className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                  {isAwayOwner ? '(You)' : fixture.awayOwnerId ? 'Claimed' : 'Unclaimed'}
                </span>
              </div>
            </div>
          </div>

          {/* Opponent Submission Status Notification */}
          {fixture.opponentSubmission && (
            <div className="p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-xl text-xs flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
              <div>
                <div className="font-bold text-indigo-300">Opponent Submitted Result:</div>
                <div className="text-slate-300 mt-0.5">
                  Your opponent submitted{' '}
                  <strong className="text-white">
                    {fixture.opponentSubmission.homeScore} - {fixture.opponentSubmission.awayScore}
                  </strong>
                  . If you submit the same score, the match will be <strong>instant-confirmed</strong>!
                </div>
              </div>
            </div>
          )}

          {/* Interactive Score Stepper Controls */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 text-center">
              Official Match Score
            </label>
            <div className="grid grid-cols-2 gap-4 bg-slate-950/40 p-4 rounded-xl border border-slate-800/80">
              {/* Home Score Stepper */}
              <div className="flex flex-col items-center">
                <span className="text-xs font-semibold text-slate-300 mb-2 truncate max-w-full">
                  {fixture.homeClub?.shortName || 'HOME'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleScoreAdjust('home', -1)}
                    className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 font-bold text-lg text-slate-200 border border-slate-700 flex items-center justify-center select-none"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={homeScore}
                    onChange={(e) => setHomeScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-16 h-12 bg-slate-900 border border-slate-700 rounded-xl text-center text-2xl font-black text-white focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleScoreAdjust('home', 1)}
                    className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 font-bold text-lg text-slate-200 border border-slate-700 flex items-center justify-center select-none"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Away Score Stepper */}
              <div className="flex flex-col items-center">
                <span className="text-xs font-semibold text-slate-300 mb-2 truncate max-w-full">
                  {fixture.awayClub?.shortName || 'AWAY'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleScoreAdjust('away', -1)}
                    className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 font-bold text-lg text-slate-200 border border-slate-700 flex items-center justify-center select-none"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={awayScore}
                    onChange={(e) => setAwayScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-16 h-12 bg-slate-900 border border-slate-700 rounded-xl text-center text-2xl font-black text-white focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleScoreAdjust('away', 1)}
                    className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 font-bold text-lg text-slate-200 border border-slate-700 flex items-center justify-center select-none"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Screenshot / Proof URL */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1.5">
              <Link className="w-3.5 h-3.5 text-slate-400" />
              <span>Match Proof / Screenshot URL (Optional)</span>
            </label>
            <input
              type="url"
              placeholder="e.g. https://imgur.com/screenshot.png or cloud drive link"
              value={proofUrl}
              onChange={(e) => setProofUrl(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Providing end-game screenshot proof ensures faster resolution if your opponent inputs a wrong score.
            </p>
          </div>

          {/* Consensus Explainer Box */}
          <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-3 text-[11px] text-slate-400 space-y-1.5">
            <div className="font-semibold text-slate-300 flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>Two-Party Consensus Verification</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-slate-400">
              <li>Both players independently submit match scores.</li>
              <li>When scores match, the result is <strong>instantly confirmed</strong> and updates the league table.</li>
              <li>If scores differ, the match is flagged as <strong>DISPUTED</strong> for Admin Review.</li>
            </ul>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              id="btn-confirm-score-submit"
              className="flex-1 py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 text-slate-950 font-black rounded-xl text-xs shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-1.5 transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Submit Score ({homeScore} - {awayScore})</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
