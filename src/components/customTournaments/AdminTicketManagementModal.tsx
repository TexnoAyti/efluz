import React, { useState } from 'react';
import { X, Ticket, PlusCircle, RotateCcw, AlertTriangle, CheckCircle2, History } from 'lucide-react';
import { customTournamentApi } from '../../lib/customTournamentApi';
import { TicketTransaction } from '../../types/customTournament';

interface AdminTicketManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminTicketManagementModal: React.FC<AdminTicketManagementModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'grant' | 'refund' | 'history'>('grant');
  const [targetUserId, setTargetUserId] = useState('');
  const [targetTelegramId, setTargetTelegramId] = useState('');
  const [amount, setAmount] = useState<number>(1);
  const [tournamentId, setTournamentId] = useState('');
  const [note, setNote] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [transactions, setTransactions] = useState<TicketTransaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);

  if (!isOpen) return null;

  const handleGrant = async () => {
    if (!targetUserId.trim()) {
      setStatusMsg({ type: 'error', text: 'targetUserId kiritilishi shart.' });
      return;
    }
    try {
      setIsLoading(true);
      setStatusMsg(null);
      await customTournamentApi.grantTickets({
        targetUserId: targetUserId.trim(),
        targetTelegramId: targetTelegramId.trim() || undefined,
        amount: Number(amount),
        note: note.trim() || 'Admin tomonidan berilgan chipta (15 000 so‘m)',
      });
      setStatusMsg({ type: 'success', text: `Muvaffaqiyatli ${amount} ta chipta berildi!` });
      setTargetUserId('');
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Chipta berishda xatolik.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefund = async () => {
    if (!targetUserId.trim() || !tournamentId.trim()) {
      setStatusMsg({ type: 'error', text: 'targetUserId va tournamentId kiritilishi shart.' });
      return;
    }
    try {
      setIsLoading(true);
      setStatusMsg(null);
      await customTournamentApi.refundTicket({
        targetUserId: targetUserId.trim(),
        tournamentId: tournamentId.trim(),
        note: note.trim() || 'Admin tomonidan chipta qaytarildi',
      });
      setStatusMsg({ type: 'success', text: 'Chipta muvaffaqiyatli qaytarildi!' });
      setTournamentId('');
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Chiptani qaytarishda xatolik.' });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      setLoadingTx(true);
      const list = await customTournamentApi.getTicketTransactions(targetUserId.trim() || undefined);
      setTransactions(list);
    } catch {
      setTransactions([]);
    } finally {
      setLoadingTx(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Ticket className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-100 text-base leading-tight">Chiptalar Boshqaruvi</h3>
              <p className="text-[11px] text-slate-400">Faqat Asosiy Admin (5209126900)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {statusMsg && (
          <div
            className={`p-3 text-xs font-semibold rounded-xl flex items-center gap-2 ${
              statusMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
            }`}
          >
            {statusMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{statusMsg.text}</span>
          </div>
        )}

        {/* Tab switchers */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 p-1 rounded-xl gap-1">
          <button
            onClick={() => setActiveTab('grant')}
            className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1 ${
              activeTab === 'grant' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" /> Chipta Berish
          </button>
          <button
            onClick={() => setActiveTab('refund')}
            className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1 ${
              activeTab === 'refund' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" /> Qaytarish
          </button>
          <button
            onClick={() => {
              setActiveTab('history');
              fetchHistory();
            }}
            className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1 ${
              activeTab === 'history' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" /> Tarix
          </button>
        </div>

        {/* GRANT TAB */}
        {activeTab === 'grant' && (
          <div className="space-y-3">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Foydalanuvchi IDsi (userId)</label>
              <input
                type="text"
                placeholder="Masalan: user_12345"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Telegram ID (ixtiyoriy)</label>
              <input
                type="text"
                placeholder="Masalan: 12345678"
                value={targetTelegramId}
                onChange={(e) => setTargetTelegramId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Chiptalar soni</label>
              <input
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-bold"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Izoh</label>
              <input
                type="text"
                placeholder="To‘lov tasdig‘i: 15 000 so‘m qabul qilindi"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              />
            </div>

            <button
              onClick={handleGrant}
              disabled={isLoading || !targetUserId.trim()}
              className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs transition-colors"
            >
              {isLoading ? 'Berilmoqda...' : 'Chiptani Akkauntga Qo‘shish'}
            </button>
          </div>
        )}

        {/* REFUND TAB */}
        {activeTab === 'refund' && (
          <div className="space-y-3">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Foydalanuvchi IDsi</label>
              <input
                type="text"
                placeholder="user_12345"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Turnir IDsi</label>
              <input
                type="text"
                placeholder="ct_12345678_abcd"
                value={tournamentId}
                onChange={(e) => setTournamentId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Qaytarish sababi</label>
              <input
                type="text"
                placeholder="Turnir bekor qilindi / qatnashuvchilar yig‘ilmadi"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              />
            </div>

            <button
              onClick={handleRefund}
              disabled={isLoading || !targetUserId.trim() || !tournamentId.trim()}
              className="w-full py-2.5 px-4 rounded-xl bg-rose-500 hover:bg-rose-400 disabled:opacity-50 text-white font-black text-xs transition-colors"
            >
              {isLoading ? 'Qaytarilmoqda...' : 'Chiptani Qaytarish (1 marta)'}
            </button>
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {loadingTx ? (
              <p className="text-xs text-slate-400 text-center py-6">Yuklanmoqda...</p>
            ) : transactions.length === 0 ? (
              <p className="text-xs text-slate-500 italic text-center py-6">Tranzaksiyalar topilmadi.</p>
            ) : (
              transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-bold ${
                        tx.type === 'GRANT' ? 'text-emerald-400' : tx.type === 'REFUND' ? 'text-sky-400' : 'text-amber-400'
                      }`}
                    >
                      {tx.type} ({tx.amount})
                    </span>
                    <span className="text-[10px] text-slate-500">{new Date(tx.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 truncate">{tx.note || tx.idempotencyKey}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
