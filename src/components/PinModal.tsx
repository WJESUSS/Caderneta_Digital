import React, { useState } from 'react';
import { Lock, X } from 'lucide-react';
import { formatCentavos, type Comercio } from '../lib/businessRules';
import { verificarPinDono } from '../lib/firestoreService';

interface PinModalProps {
  open: boolean;
  comercio: Comercio;
  clienteNome: string;
  valorCompraCentavos: number;
  novoSaldoCentavos: number;
  limiteCreditoCentavos: number;
  onAuthorized: (donoUid: string) => void;
  onClose: () => void;
}

export const PinModal: React.FC<PinModalProps> = ({
  open,
  comercio,
  clienteNome,
  valorCompraCentavos,
  novoSaldoCentavos,
  limiteCreditoCentavos,
  onAuthorized,
  onClose,
}) => {
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [validando, setValidando] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setValidando(true);
    try {
      const donoUid = await verificarPinDono(comercio, pin);
      setPin('');
      onAuthorized(donoUid);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível validar o PIN.');
    } finally {
      setValidando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#E4E4DF] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-900">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 id="pin-modal-title" className="text-xl font-bold text-[#14211E]">
                Compra acima do limite
              </h2>
              <p className="text-sm text-slate-600">{clienteNome}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 rounded-xl bg-[#F3F4F1] p-4 space-y-1.5 text-base">
          <div className="flex justify-between">
            <span className="text-slate-600">Valor da compra:</span>
            <strong className="font-mono-nums text-[#14211E]">
              {formatCentavos(valorCompraCentavos)}
            </strong>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Novo saldo ficaria:</span>
            <strong className="font-mono-nums text-red-700">
              {formatCentavos(novoSaldoCentavos)}
            </strong>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Limite do cliente:</span>
            <span className="font-mono-nums text-slate-700">
              {formatCentavos(limiteCreditoCentavos)}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="pin-dono-input" className="block text-base font-semibold text-[#14211E]">
              PIN de 4 dígitos do Dono para liberar exceção
            </label>
            <input
              id="pin-dono-input"
              type="password"
              inputMode="numeric"
              maxLength={4}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              className="mt-2 min-h-[52px] w-full rounded-xl border border-[#D4D4CE] bg-white px-4 text-center font-mono-nums text-2xl tracking-[0.6em] text-[#14211E] focus:border-teal-700 focus:outline-none"
            />
          </div>

          {erro && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-red-800" role="alert">
              {erro}
            </p>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] flex-1 rounded-xl border border-[#D4D4CE] bg-white px-4 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={validando || pin.length !== 4}
              className="min-h-[48px] flex-1 rounded-xl bg-amber-700 px-4 py-3 text-base font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              {validando ? 'Verificando...' : 'Autorizar compra'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
