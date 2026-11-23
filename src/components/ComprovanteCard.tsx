import React, { useState } from 'react';
import { Check, CheckCircle2, Copy, MessageCircle, Printer } from 'lucide-react';
import { buildWhatsAppUrl, formatCentavos } from '../lib/businessRules';

export interface ComprovanteDados {
  tipo: 'compra' | 'pagamento';
  comercioNome: string;
  clienteNome: string;
  clienteWhatsapp: string;
  saldoAnterior: number;
  valor: number;
  novoSaldo: number;
  limiteCredito: number;
  formaLabel: string;
  itens?: string;
  dataHora: Date;
  lancamentoId: string;
  registradoPorNome: string;
  offline: boolean;
}

interface ComprovanteCardProps {
  dados: ComprovanteDados;
  acoesExtras?: React.ReactNode;
}

export const ComprovanteCard: React.FC<ComprovanteCardProps> = ({ dados, acoesExtras }) => {
  const [copiado, setCopiado] = useState(false);

  const limiteDisponivel = Math.max(0, dados.limiteCredito - dados.novoSaldo);
  const dataHoraFormatada = dados.dataHora.toLocaleString('pt-BR', {
    timeZone: 'America/Bahia',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const titulo =
    dados.tipo === 'compra'
      ? dados.offline
        ? 'Compra salva na fila offline'
        : 'Comprovante de Compra Fiado'
      : dados.offline
      ? 'Pagamento salvo na fila offline'
      : 'Recibo de Pagamento';

  const textoComprovante = [
    `*${dados.comercioNome}*`,
    dados.tipo === 'compra' ? 'COMPROVANTE DE COMPRA FIADO' : 'RECIBO DE PAGAMENTO',
    '--------------------------------',
    `Cliente: ${dados.clienteNome}`,
    `Data/hora: ${dataHoraFormatada}`,
    `Lancamento: #${dados.lancamentoId}`,
    `Registrado por: ${dados.registradoPorNome}`,
    `Forma: ${dados.formaLabel}`,
    ...(dados.itens ? [`Itens: ${dados.itens}`] : []),
    '--------------------------------',
    `Saldo anterior: ${formatCentavos(dados.saldoAnterior)}`,
    `${dados.tipo === 'compra' ? 'Valor da compra' : 'Valor pago'}: ${formatCentavos(dados.valor)}`,
    `Novo saldo: ${formatCentavos(dados.novoSaldo)}`,
    `Limite disponivel: ${formatCentavos(limiteDisponivel)}`,
    ...(dados.offline ? ['', '(Salvo offline — sera sincronizado ao reconectar)'] : []),
  ].join('\n');

  const primeiroNome = dados.clienteNome.trim().split(/\s+/)[0] || dados.clienteNome;
  const msgWhats =
    dados.tipo === 'compra'
      ? `Olá, ${primeiroNome}! Segue o comprovante da sua compra em ${dados.comercioNome}:\n• Compra #${dados.lancamentoId}: ${formatCentavos(
          dados.valor
        )}\n• Saldo anterior: ${formatCentavos(dados.saldoAnterior)}\n• Novo saldo: ${formatCentavos(
          dados.novoSaldo
        )}\n• Limite disponível: ${formatCentavos(limiteDisponivel)}\n• Data/hora: ${dataHoraFormatada}\n• Atendido por: ${
          dados.registradoPorNome
        }`
      : `Olá, ${primeiroNome}! Segue o recibo do seu pagamento em ${dados.comercioNome}:\n• Recibo #${dados.lancamentoId}: ${formatCentavos(
          dados.valor
        )} (${dados.formaLabel})\n• Saldo anterior: ${formatCentavos(dados.saldoAnterior)}\n• Novo saldo: ${formatCentavos(
          dados.novoSaldo
        )}${dados.novoSaldo === 0 ? ' (Conta quitada!)' : ''}\n• Limite disponível: ${formatCentavos(
          limiteDisponivel
        )}\n• Data/hora: ${dataHoraFormatada}\n• Registrado por: ${dados.registradoPorNome}`;

  const handleCopiar = async () => {
    try {
      await navigator.clipboard.writeText(textoComprovante);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="print-only-receipt rounded-2xl border border-[#E4E4DF] bg-white p-6 sm:p-8">
        <div className="text-center border-b border-dashed border-[#D4D4CE] pb-4">
          <div className="no-print mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {dados.comercioNome}
          </p>
          <h1 className="mt-1 text-xl font-bold text-[#14211E]">{titulo}</h1>
          {dados.offline && (
            <p className="no-print mt-2 rounded-xl bg-amber-50 p-2.5 text-sm text-amber-900">
              Sem internet: será sincronizado automaticamente ao reconectar sem duplicar.
            </p>
          )}
        </div>

        <dl className="mt-4 space-y-2.5 text-sm sm:text-base">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Cliente</dt>
            <dd className="font-semibold text-[#14211E] text-right">{dados.clienteNome}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Data e hora</dt>
            <dd className="font-mono-nums text-[#14211E] text-right">{dataHoraFormatada}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Nº do lançamento</dt>
            <dd className="font-mono-nums text-xs sm:text-sm text-slate-700 text-right break-all">
              {dados.lancamentoId}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Registrado por</dt>
            <dd className="text-[#14211E] text-right">{dados.registradoPorNome}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Forma</dt>
            <dd className="font-medium text-[#14211E] text-right">{dados.formaLabel}</dd>
          </div>
          {dados.itens && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Descrição</dt>
              <dd className="text-[#14211E] text-right max-w-[65%]">{dados.itens}</dd>
            </div>
          )}

          <div className="border-t border-dashed border-[#D4D4CE] pt-3 mt-3 space-y-2">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Saldo anterior</dt>
              <dd className="font-mono-nums text-[#14211E]">{formatCentavos(dados.saldoAnterior)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-semibold text-[#14211E]">
                {dados.tipo === 'compra' ? 'Valor da compra' : 'Valor do pagamento'}
              </dt>
              <dd
                className={`font-mono-nums font-bold ${
                  dados.tipo === 'pagamento' ? 'text-teal-700' : 'text-[#14211E]'
                }`}
              >
                {dados.tipo === 'pagamento' ? '− ' : '+ '}
                {formatCentavos(dados.valor)}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-[#ECECE7] pt-2 text-base sm:text-lg">
              <dt className="font-bold text-[#14211E]">Novo saldo</dt>
              <dd className="font-mono-nums font-extrabold text-[#14211E]">
                {formatCentavos(dados.novoSaldo)}
              </dd>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <dt className="text-slate-600">Limite disponível</dt>
              <dd className="font-mono-nums font-semibold text-teal-800">
                {formatCentavos(limiteDisponivel)}
              </dd>
            </div>
          </div>
        </dl>
      </div>

      <div className="no-print space-y-3">
        {dados.clienteWhatsapp && dados.clienteWhatsapp !== 'ANONIMIZADO' && (
          <a
            href={buildWhatsAppUrl(dados.clienteWhatsapp, msgWhats)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#15803D] px-5 py-3 text-base font-semibold text-white hover:bg-[#166534]"
          >
            <MessageCircle className="h-5 w-5" />
            <span>Enviar por WhatsApp</span>
          </a>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleCopiar}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-4 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50"
          >
            {copiado ? <Check className="h-5 w-5 text-teal-700" /> : <Copy className="h-5 w-5" />}
            <span>{copiado ? 'Texto copiado!' : 'Copiar texto'}</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-4 py-3 text-base font-semibold text-[#14211E] hover:bg-slate-50"
          >
            <Printer className="h-5 w-5" />
            <span>Imprimir</span>
          </button>
        </div>

        {acoesExtras}
      </div>
    </div>
  );
};
