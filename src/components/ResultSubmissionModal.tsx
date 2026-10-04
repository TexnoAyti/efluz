import { EFL_2_DESIGN_ENABLED } from '../releaseDesign';
import React, { useState } from 'react';
import { Fixture } from '../types';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import confetti from 'canvas-confetti';
import { ClubCrest } from './ClubCrest';
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
  const { language } = useI18n();
  const previewCopy = {
    uz: { title: 'Natijani kiritish', matchday: 'tur', you: 'Siz', claimed: 'Tanlangan', unclaimed: 'Egasi yo‘q', opponent: 'Raqib kiritgan natija', opponentHint: 'Hisoblar bir xil bo‘lsa natija tasdiqlanadi. Farq qilsa nizo ko‘rib chiqiladi.', score: 'eFootball o‘yinidagi yakuniy hisob', proof: 'O‘yin skrinshoti havolasi (ixtiyoriy)', proofHint: 'Skrinshot kelishmovchilik bo‘lsa natijani tekshirishga yordam beradi.', cancel: 'Bekor qilish', sending: 'Yuborilmoqda...', submit: 'Hisobni yuborish', confirmed: 'Natija tasdiqlandi va jadval yangilandi.', disputed: 'Hisoblar farq qildi. Nizo adminga yuborildi.', pending: 'Natija yuborildi. Raqib tasdig‘i kutilmoqda.', failed: 'Natijani yuborib bo‘lmadi.' },
    ru: { title: 'Ввести результат', matchday: 'тур', you: 'Вы', claimed: 'Занят', unclaimed: 'Свободен', opponent: 'Результат соперника', opponentHint: 'Если счета совпадут, результат подтвердится. Разные счета отправятся на рассмотрение.', score: 'Итоговый счёт в eFootball', proof: 'Ссылка на скриншот (необязательно)', proofHint: 'Скриншот поможет проверить результат при споре.', cancel: 'Отмена', sending: 'Отправка...', submit: 'Отправить счёт', confirmed: 'Результат подтверждён, таблица обновлена.', disputed: 'Счета не совпали. Спор отправлен администратору.', pending: 'Результат отправлен. Ожидаем подтверждения соперника.', failed: 'Не удалось отправить результат.' },
    en: { title: 'Submit match result', matchday: 'Matchday', you: 'You', claimed: 'Claimed', unclaimed: 'Unclaimed', opponent: 'Opponent submitted', opponentHint: 'Matching scores confirm the result. Different scores go to dispute review.', score: 'Final score from eFootball', proof: 'Screenshot link (optional)', proofHint: 'A screenshot helps resolve a score dispute.', cancel: 'Cancel', sending: 'Submitting...', submit: 'Submit score', confirmed: 'Result confirmed and standings updated.', disputed: 'Scores differ. Dispute sent to admin.', pending: 'Score submitted. Awaiting opponent confirmation.', failed: 'Failed to submit score.' },
  }[language];
  const c = EFL_2_DESIGN_ENABLED ? previewCopy : null;

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
        showToast(c?.confirmed || 'Match Result Confirmed! Standings have been updated.', 'success');
      } else if (res.fixture.status === 'DISPUTED') {
        showToast(c?.disputed || 'Score mismatch! Match sent to Admin Dispute Center.', 'error');
      } else {
        showToast(c?.pending || 'Score submitted! Waiting for opponent confirmation.', 'info');
      }

      onSuccess(res.fixture);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || c?.failed || 'Failed to submit score.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={`w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
          EFL_2_DESIGN_ENABLED
            ? 'preview-surface rounded-3xl border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-900 efl-theme-text dark:text-white shadow-2xl'
            : 'glass-modal text-white efl-theme-text'
        }`}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between ${
            EFL_2_DESIGN_ENABLED
              ? 'border-slate-200/80 efl-theme-border dark:border-white/10 bg-slate-50/75 efl-theme-surface-2 dark:bg-white/[0.02]'
              : 'border-white/[0.08] efl-theme-border bg-white/[0.02] efl-theme-surface-2'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center text-blue-600 efl-theme-blue dark:text-blue-400">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className={`font-bold text-sm sm:text-base ${EFL_2_DESIGN_ENABLED ? 'text-slate-900 efl-theme-text dark:text-white' : 'text-slate-100 efl-theme-text'}`}>
                {c?.title || 'Submit Match Result'}
              </h3>
              <p className="text-[11px] text-slate-500 efl-theme-text-2 dark:text-slate-400">
                {fixture.competitionName} • {fixture.roundName || `${c?.matchday || 'Matchday'} ${fixture.matchday}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            aria-label={c?.cancel || 'Close'}
            className={`p-1.5 rounded-xl transition-colors ${
              EFL_2_DESIGN_ENABLED
                ? 'text-slate-400 efl-theme-text-2 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white hover:bg-slate-100 efl-theme-hover-surface dark:hover:bg-white/10'
                : 'text-slate-400 efl-theme-text-2 hover:text-white efl-theme-hover-text glass-button'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {/* Match Teams Banner */}
          <div
            className={`p-4 rounded-2xl border ${
              EFL_2_DESIGN_ENABLED
                ? 'bg-slate-50 efl-theme-surface-2 dark:bg-white/5 border-slate-200/80 efl-theme-border dark:border-white/10 shadow-xs'
                : 'glass-card'
            }`}
          >
            <div className="grid grid-cols-5 items-center gap-2 text-center">
              {/* Home Team */}
              <div className="col-span-2 flex flex-col items-center">
                <div
                  className={`w-14 h-14 rounded-2xl p-2 border flex items-center justify-center mb-2 ${
                    EFL_2_DESIGN_ENABLED
                      ? 'bg-white efl-theme-surface dark:bg-[#171e2c] border-slate-200/80 efl-theme-border dark:border-white/10 shadow-xs'
                      : 'bg-slate-950/80 efl-theme-surface-2 border-white/[0.08] efl-theme-border shadow-inner'
                  }`}
                >
                  <ClubCrest
                    clubId={fixture.homeClub?.id}
                    logoUrl={fixture.homeClub?.logoUrl}
                    name={fixture.homeClub?.name}
                    shortName={fixture.homeClub?.shortName}
                    size="lg"
                    className="w-10 h-10"
                  />
                </div>
                <div
                  className={`font-black text-xs sm:text-sm truncate max-w-full ${
                    EFL_2_DESIGN_ENABLED ? 'text-slate-900 efl-theme-text dark:text-white' : 'text-slate-100 efl-theme-text'
                  }`}
                >
                  {fixture.homeClub?.name}
                </div>
                <span className="text-[10px] text-blue-600 efl-theme-blue dark:text-blue-400 font-bold mt-0.5">
                  {isHomeOwner ? `(${c?.you || 'You'})` : fixture.homeOwnerId ? c?.claimed || 'Claimed' : c?.unclaimed || 'Unclaimed'}
                </span>
              </div>

              {/* VS Divider */}
              <div className="col-span-1 flex flex-col items-center justify-center">
                <div
                  className={`w-8 h-8 rounded-full font-black text-xs flex items-center justify-center ${
                    EFL_2_DESIGN_ENABLED
                      ? 'bg-slate-200/80 efl-theme-surface-2 dark:bg-white/10 text-slate-600 efl-theme-text-2 dark:text-slate-300'
                      : 'glass-card text-slate-400 efl-theme-text-2'
                  }`}
                >
                  VS
                </div>
              </div>

              {/* Away Team */}
              <div className="col-span-2 flex flex-col items-center">
                <div
                  className={`w-14 h-14 rounded-2xl p-2 border flex items-center justify-center mb-2 ${
                    EFL_2_DESIGN_ENABLED
                      ? 'bg-white efl-theme-surface dark:bg-[#171e2c] border-slate-200/80 efl-theme-border dark:border-white/10 shadow-xs'
                      : 'bg-slate-950/80 efl-theme-surface-2 border-white/[0.08] efl-theme-border shadow-inner'
                  }`}
                >
                  <ClubCrest
                    clubId={fixture.awayClub?.id}
                    logoUrl={fixture.awayClub?.logoUrl}
                    name={fixture.awayClub?.name}
                    shortName={fixture.awayClub?.shortName}
                    size="lg"
                    className="w-10 h-10"
                  />
                </div>
                <div
                  className={`font-black text-xs sm:text-sm truncate max-w-full ${
                    EFL_2_DESIGN_ENABLED ? 'text-slate-900 efl-theme-text dark:text-white' : 'text-slate-100 efl-theme-text'
                  }`}
                >
                  {fixture.awayClub?.name}
                </div>
                <span className="text-[10px] text-blue-600 efl-theme-blue dark:text-blue-400 font-bold mt-0.5">
                  {isAwayOwner ? `(${c?.you || 'You'})` : fixture.awayOwnerId ? c?.claimed || 'Claimed' : c?.unclaimed || 'Unclaimed'}
                </span>
              </div>
            </div>
          </div>

          {/* Opponent Submission Status Notification */}
          {fixture.opponentSubmission && (
            <div
              className={`p-3.5 rounded-2xl border text-xs space-y-1.5 ${
                EFL_2_DESIGN_ENABLED
                  ? 'bg-blue-50 efl-theme-blue-soft dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/25'
                  : 'glass-card bg-indigo-950/25 border-indigo-500/30'
              }`}
            >
              <div
                className={`flex items-center gap-2 font-bold ${
                  EFL_2_DESIGN_ENABLED ? 'text-blue-700 efl-theme-blue dark:text-blue-300' : 'text-indigo-300 efl-theme-indigo'
                }`}
              >
                <Clock className="w-4 h-4 text-blue-500 efl-theme-blue dark:text-blue-400 shrink-0" />
                <span>
                  {c?.opponent || 'Opponent Submitted'}: {fixture.opponentSubmission.homeScore} - {fixture.opponentSubmission.awayScore}
                </span>
              </div>
              <p
                className={`text-[11px] leading-relaxed ${
                  EFL_2_DESIGN_ENABLED ? 'text-slate-600 efl-theme-text-2 dark:text-slate-300' : 'text-slate-300 efl-theme-text-2'
                }`}
              >
                {c?.opponentHint || 'If you submit this exact score, the match will be verified and league standings updated immediately.'}
              </p>
            </div>
          )}

          {/* Interactive Score Stepper Controls */}
          <div>
            <label
              className={`block text-[11px] font-bold uppercase tracking-wider mb-2 text-center ${
                EFL_2_DESIGN_ENABLED ? 'text-slate-600 efl-theme-text-2 dark:text-slate-400' : 'text-slate-300 efl-theme-text-2'
              }`}
            >
              {c?.score || 'Official Match Score'}
            </label>
            <div
              className={`grid grid-cols-2 gap-3 p-4 rounded-2xl border ${
                EFL_2_DESIGN_ENABLED
                  ? 'bg-slate-50 efl-theme-surface-2 dark:bg-white/5 border-slate-200/80 efl-theme-border dark:border-white/10 shadow-xs'
                  : 'glass-panel'
              }`}
            >
              {/* Home Score Stepper */}
              <div className="flex flex-col items-center">
                <span
                  className={`text-xs font-bold mb-2 truncate max-w-full ${
                    EFL_2_DESIGN_ENABLED ? 'text-slate-700 efl-theme-text-2 dark:text-slate-300' : 'text-slate-300 efl-theme-text-2'
                  }`}
                >
                  {fixture.homeClub?.shortName || 'HOME'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleScoreAdjust('home', -1)}
                    className={`w-10 h-10 font-bold text-lg flex items-center justify-center select-none rounded-xl transition-all ${
                      EFL_2_DESIGN_ENABLED
                        ? 'bg-white efl-theme-surface dark:bg-[#171e2c] border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-700 efl-theme-text-2 dark:text-slate-200 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white shadow-xs'
                        : 'glass-button text-slate-200 efl-theme-text'
                    }`}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={homeScore}
                    onChange={(e) => setHomeScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    aria-label={fixture.homeClub?.name || 'Home score'}
                    className={`w-16 h-12 rounded-xl text-center text-2xl font-black tabular-nums focus:outline-none ${
                      EFL_2_DESIGN_ENABLED
                        ? 'bg-white efl-theme-surface dark:bg-[#111722] border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-900 efl-theme-text dark:text-white shadow-xs focus:border-blue-500'
                        : 'glass-input text-white efl-theme-text'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => handleScoreAdjust('home', 1)}
                    className={`w-10 h-10 font-bold text-lg flex items-center justify-center select-none rounded-xl transition-all ${
                      EFL_2_DESIGN_ENABLED
                        ? 'bg-white efl-theme-surface dark:bg-[#171e2c] border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-700 efl-theme-text-2 dark:text-slate-200 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white shadow-xs'
                        : 'glass-button text-slate-200 efl-theme-text'
                    }`}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Away Score Stepper */}
              <div className="flex flex-col items-center">
                <span
                  className={`text-xs font-bold mb-2 truncate max-w-full ${
                    EFL_2_DESIGN_ENABLED ? 'text-slate-700 efl-theme-text-2 dark:text-slate-300' : 'text-slate-300 efl-theme-text-2'
                  }`}
                >
                  {fixture.awayClub?.shortName || 'AWAY'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleScoreAdjust('away', -1)}
                    className={`w-10 h-10 font-bold text-lg flex items-center justify-center select-none rounded-xl transition-all ${
                      EFL_2_DESIGN_ENABLED
                        ? 'bg-white efl-theme-surface dark:bg-[#171e2c] border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-700 efl-theme-text-2 dark:text-slate-200 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white shadow-xs'
                        : 'glass-button text-slate-200 efl-theme-text'
                    }`}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={awayScore}
                    onChange={(e) => setAwayScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    aria-label={fixture.awayClub?.name || 'Away score'}
                    className={`w-16 h-12 rounded-xl text-center text-2xl font-black tabular-nums focus:outline-none ${
                      EFL_2_DESIGN_ENABLED
                        ? 'bg-white efl-theme-surface dark:bg-[#111722] border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-900 efl-theme-text dark:text-white shadow-xs focus:border-blue-500'
                        : 'glass-input text-white efl-theme-text'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => handleScoreAdjust('away', 1)}
                    className={`w-10 h-10 font-bold text-lg flex items-center justify-center select-none rounded-xl transition-all ${
                      EFL_2_DESIGN_ENABLED
                        ? 'bg-white efl-theme-surface dark:bg-[#171e2c] border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-700 efl-theme-text-2 dark:text-slate-200 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white shadow-xs'
                        : 'glass-button text-slate-200 efl-theme-text'
                    }`}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Screenshot / Proof URL */}
          <div>
            <label
              className={`block text-xs font-semibold mb-1 flex items-center gap-1.5 ${
                EFL_2_DESIGN_ENABLED ? 'text-slate-700 efl-theme-text-2 dark:text-slate-300' : 'text-slate-300 efl-theme-text-2'
              }`}
            >
              <Link className="w-3.5 h-3.5 text-slate-400 efl-theme-text-2" />
              <span>{c?.proof || 'Match Proof / Screenshot URL (Optional)'}</span>
            </label>
            <input
              type="url"
              placeholder="e.g. https://imgur.com/screenshot.png or cloud drive link"
              value={proofUrl}
              onChange={(e) => setProofUrl(e.target.value)}
              className={`w-full px-3 py-2 rounded-xl text-xs focus:outline-none ${
                EFL_2_DESIGN_ENABLED
                  ? 'bg-white efl-theme-surface dark:bg-[#171e2c] border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-900 efl-theme-text dark:text-white placeholder-slate-400 efl-theme-placeholder focus:border-blue-500 shadow-xs'
                  : 'glass-input text-slate-200 efl-theme-text placeholder-slate-500 efl-theme-placeholder'
              }`}
            />
            <p className="text-[11px] text-slate-500 efl-theme-text-2 dark:text-slate-400 mt-1">
              {c?.proofHint || 'Providing end-game screenshot proof ensures faster resolution if your opponent inputs a wrong score.'}
            </p>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-600 efl-theme-rose dark:text-rose-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs transition-colors ${
                EFL_2_DESIGN_ENABLED
                  ? 'bg-slate-100 efl-theme-surface-2 dark:bg-white/5 border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-700 efl-theme-text-2 dark:text-slate-300 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white'
                  : 'glass-button text-slate-300 efl-theme-text-2 font-semibold'
              }`}
            >
              {c?.cancel || 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              id="btn-confirm-score-submit"
              className={`flex-1 py-2.5 px-4 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs ${
                EFL_2_DESIGN_ENABLED
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'btn-glass-primary'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{c?.sending || 'Submitting...'}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{c?.submit || 'Submit Score'} ({homeScore} - {awayScore})</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

