import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, BookOpen } from 'lucide-react';
import { APP_PUBLIC_URL, checkPublicUrlSafety } from '../lib/qrUrl';
import { QRCodeCard } from '../components/QRCodeCard';
import { useAuth } from '../context/AuthContext';

export const PublicQRPage: React.FC = () => {
  const { usuario } = useAuth();
  const isDono = usuario?.perfil === 'dono';
  const safety = checkPublicUrlSafety(APP_PUBLIC_URL);

  return (
    <div className="min-h-screen bg-[#FAFAF8] px-4 py-6 sm:py-10">
      <div className="no-print mx-auto mb-6 flex max-w-2xl items-center justify-between gap-4">
        <Link
          to={usuario ? '/' : '/login'}
          className="inline-flex min-h-[44px] items-center gap-2 text-base font-semibold text-teal-800 hover:underline"
        >
          <ArrowLeft className="h-5 w-5" />
          <span>{usuario ? 'Voltar ao painel' : 'Ir para o login'}</span>
        </Link>
      </div>

      {/* Aviso vermelho obrigatório para o Dono se localhost ou não-HTTPS */}
      {safety.isUnsafe && (isDono || !usuario) && (
        <div
          role="alert"
          className="no-print mx-auto mb-6 max-w-2xl rounded-2xl border-2 border-red-400 bg-red-50 p-4 text-red-900"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 shrink-0 text-red-700 mt-0.5" />
            <div>
              <h2 className="text-base font-bold text-red-900">
                Atenção: endereço do QR Code não é de produção HTTPS
              </h2>
              <p className="mt-1 text-base text-red-800">{safety.reason}</p>
            </div>
          </div>
        </div>
      )}

      {/* Cartaz imprimível A4 retrato */}
      <div className="print-only-poster mx-auto flex max-w-2xl flex-col items-center rounded-2xl border border-[#E4E4DF] bg-white px-6 py-10 sm:px-10 sm:py-12">
        <div className="flex items-center gap-3 text-teal-800">
          <BookOpen className="h-8 w-8" />
          <h1 className="text-3xl font-extrabold tracking-tight text-[#14211E]">
            Caderneta Digital
          </h1>
        </div>

        <p className="mt-2 text-center text-base text-slate-600">
          Controle de fiado e cobrança do seu comércio
        </p>

        <div className="mt-8 w-full flex justify-center">
          <QRCodeCard
            url={APP_PUBLIC_URL}
            titulo="Caderneta Digital"
            subtitulo="Aponte a câmera do celular para abrir"
            tamanhoPx={300}
            filenamePng="caderneta-digital-qr.png"
            mostrarBotaoImprimir
          />
        </div>
      </div>
    </div>
  );
};
