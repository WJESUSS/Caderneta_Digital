import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, Printer } from 'lucide-react';

interface QRCodeCardProps {
  url: string;
  titulo?: string;
  subtitulo?: string;
  tamanhoPx?: number;
  filenamePng?: string;
  mostrarBotaoImprimir?: boolean;
  extraWhatsAppUrl?: string;
  whatsAppBloqueadoMotivo?: string;
}

export const QRCodeCard: React.FC<QRCodeCardProps> = ({
  url,
  titulo = 'Caderneta Digital',
  subtitulo = 'Aponte a câmera do celular para abrir',
  tamanhoPx = 300,
  filenamePng = 'caderneta-digital-qr.png',
  mostrarBotaoImprimir = false,
  extraWhatsAppUrl,
  whatsAppBloqueadoMotivo,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erroQr, setErroQr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const render = async () => {
      if (!canvasRef.current || !url) return;
      try {
        setErroQr(null);
        await QRCode.toCanvas(canvasRef.current, url, {
          width: tamanhoPx,
          margin: 4,
          errorCorrectionLevel: 'Q',
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        });
      } catch {
        if (active) setErroQr('Não foi possível gerar o QR Code para este endereço.');
      }
    };
    void render();
    return () => {
      active = false;
    };
  }, [url, tamanhoPx]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setCopiado(false);
    }
  };

  const handleDownloadPng = async () => {
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 1024,
        margin: 4,
        errorCorrectionLevel: 'Q',
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filenamePng;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      setErroQr('Erro ao baixar a imagem PNG.');
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="rounded-2xl border border-[#E4E4DF] bg-white p-5 flex flex-col items-center">
        {erroQr ? (
          <p className="text-base text-red-700 py-8 px-4 text-center">{erroQr}</p>
        ) : (
          <canvas
            ref={canvasRef}
            aria-label={`QR Code para ${url}`}
            className="max-w-full h-auto block"
          />
        )}
      </div>

      <p className="mt-4 text-center text-base font-semibold text-[#14211E]">{subtitulo}</p>
      <p className="mt-1 text-center font-mono-nums text-sm text-slate-600 break-all max-w-md px-2">
        {url}
      </p>

      <div className="no-print mt-5 flex flex-wrap items-center justify-center gap-3 w-full">
        {mostrarBotaoImprimir && (
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800 transition-colors"
          >
            <Printer className="h-5 w-5" />
            <span>Imprimir cartaz (A4)</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleDownloadPng}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-5 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50 transition-colors"
        >
          <Download className="h-5 w-5" />
          <span>Baixar PNG</span>
        </button>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-5 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50 transition-colors"
        >
          {copiado ? <Check className="h-5 w-5 text-teal-700" /> : <Copy className="h-5 w-5" />}
          <span>{copiado ? 'Link copiado' : 'Copiar link'}</span>
        </button>

        {extraWhatsAppUrl ? (
          <a
            href={extraWhatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#15803D] px-5 py-3 text-base font-semibold text-white hover:bg-[#166534] transition-colors"
          >
            <span>Enviar por WhatsApp</span>
          </a>
        ) : whatsAppBloqueadoMotivo ? (
          <button
            type="button"
            disabled
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-slate-100 px-5 py-3 text-base font-semibold text-slate-500 cursor-not-allowed"
          >
            <span>Enviar por WhatsApp</span>
          </button>
        ) : null}
      </div>

      {!extraWhatsAppUrl && whatsAppBloqueadoMotivo && (
        <p className="no-print mt-3 w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 text-center">
          {whatsAppBloqueadoMotivo}
        </p>
      )}

      <span className="sr-only">{titulo}</span>
    </div>
  );
};
