import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          compact
            ? 'inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-teal-700/20 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-900 hover:bg-teal-100 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700'
            : 'inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700'
        }
      >
        {isInstallable ? <Download className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
        <span>{compact ? 'Instalar app' : 'Instalar no celular'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E4E4DF] bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h3 id="pwa-install-title" className="text-xl font-bold text-[#14211E]">
                Instalar Caderneta Digital no celular
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
                aria-label="Fechar instruções"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {isIOS ? (
              <ol className="mt-4 space-y-3 text-base text-slate-700 list-decimal pl-5">
                <li>
                  Toque no botão <strong>Compartilhar</strong> (quadrado com seta para cima) na barra do Safari.
                </li>
                <li>
                  Role para baixo e toque em <strong>Adicionar à Tela de Início</strong>.
                </li>
                <li>
                  Toque em <strong>Adicionar</strong> para usar a Caderneta como aplicativo.
                </li>
              </ol>
            ) : (
              <ol className="mt-4 space-y-3 text-base text-slate-700 list-decimal pl-5">
                <li>
                  Abra o menu do navegador (três pontinhos no canto superior direito no Chrome/Edge).
                </li>
                <li>
                  Toque em <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.
                </li>
                <li>
                  Confirme para ter o ícone da Caderneta Digital direto na tela do celular.
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-6 min-h-[48px] w-full rounded-xl bg-[#14211E] px-5 py-3 text-base font-semibold text-white hover:bg-slate-800"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
};
