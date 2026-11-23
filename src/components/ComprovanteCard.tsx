import React, { useState } from 'react';
import { Check, CheckCircle2, Copy, MessageCircle, Printer } from 'lucide-react';
import {
  buildWhatsAppUrl,
  formatarNomePropio,
  formatCentavos,
  obterNumeroLancamentoExibicao,
  type FormaPagamento,
} from '../lib/businessRules';

export interface ComprovanteDados {
  tipo: 'compra' | 'pagamento' | 'estorno';
  comercioNome: string;
  clienteNome: string;
  clienteWhatsapp: string;
  saldoAnterior: number;
  valor: number;
  novoSaldo: number;
  limiteCredito: number;
  forma?: FormaPagamento;
  formaLabel: string;
  itens?: string;
  justificativa?: string;
  dataHora: Date;
  lancamentoId: string;
  numero?: string;
  registradoPorNome: string;
  offline: boolean;
}

interface ComprovanteCardProps {
  dados: ComprovanteDados;
  acoesExtras?: React.ReactNode;
}

export const ComprovanteCard: React.FC<ComprovanteCardProps> = ({ dados, acoesExtras }) => {
  const [copiado, setCopiado] = useState(false);

  const comercioNomeLimpo = dados.comercioNome.trim() || 'Comércio';
  const limiteDisponivel = Math.max(0, dados.limiteCredito - dados.novoSaldo);
  const numeroExibicao = obterNumeroLancamentoExibicao(dados.numero, dados.lancamentoId);
  const registradoPorFormatado = formatarNomePropio(dados.registradoPorNome) || 'Comércio';
  const isPixManual =
    dados.forma === 'pix_manual' || dados.formaLabel.toLowerCase().includes('pix');

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
      : dados.tipo === 'pagamento'
      ? dados.offline
        ? 'Pagamento salvo na fila offline'
        : 'Recibo de Pagamento'
      : 'Comprovante de Estorno';

  const cabecalhoTexto =
    dados.tipo === 'compra'
      ? 'COMPROVANTE DE COMPRA FIADO'
      : dados.tipo === 'pagamento'
      ? 'RECIBO DE PAGAMENTO'
      : 'COMPROVANTE DE ESTORNO';

  const rotuloValor =
    dados.tipo === 'compra'
      ? 'Valor da compra'
      : dados.tipo === 'pagamento'
      ? 'Valor pago'
      : 'Valor estornado';

  const situacaoLinha =
    dados.tipo === 'pagamento'
      ? dados.novoSaldo === 0
        ? 'Conta quitada'
        : `Saldo restante: ${formatCentavos(dados.novoSaldo)}`
      : null;

  const textoComprovante = [
    comercioNomeLimpo,
    cabecalhoTexto,
    '--------------------------------',
    `Cliente: ${dados.clienteNome}`,
    `Data/hora: ${dataHoraFormatada}`,
    `Lançamento: ${numeroExibicao}`,
    `Registrado por: ${registradoPorFormatado}`,
    `Forma: ${dados.formaLabel}`,
    ...(isPixManual ? ['Pix conferido pelo comércio (sem confirmação do banco)'] : []),
    ...(dados.itens ? [`Itens: ${dados.itens}`] : []),
    ...(dados.justificativa ? [`Motivo: ${dados.justificativa}`] : []),
    '--------------------------------',
    `Saldo anterior: ${formatCentavos(dados.saldoAnterior)}`,
    `${rotuloValor}: ${formatCentavos(dados.valor)}`,
    `Novo saldo: ${formatCentavos(dados.novoSaldo)}`,
    `Limite disponível: ${formatCentavos(limiteDisponivel)}`,
    ...(situacaoLinha ? [situacaoLinha] : []),
    ...(dados.offline ? ['', '(Salvo offline — será sincronizado ao reconectar)'] : []),
  ].join('\n');

  const primeiroNome = dados.clienteNome.trim().split(/\s+/)[0] || dados.clienteNome;
  const msgWhats =
    dados.tipo === 'compra'
      ? `Olá, ${primeiroNome}! Segue o comprovante da sua compra em ${comercioNomeLimpo}:\n• Lançamento: ${numeroExibicao}\n• Valor da compra: ${formatCentavos(
          dados.valor
        )}${dados.itens ? `\n• Itens: ${dados.itens}` : ''}\n• Saldo anterior: ${formatCentavos(
          dados.saldoAnterior
        )}\n• Novo saldo: ${formatCentavos(
          dados.novoSaldo
        )}\n• Limite disponível: ${formatCentavos(limiteDisponivel)}\n• Data/hora: ${dataHoraFormatada}\n• Registrado por: ${registradoPorFormatado}`
      : dados.tipo === 'pagamento'
      ? `Olá, ${primeiroNome}! Segue o recibo do seu pagamento em ${comercioNomeLimpo}:\n• Lançamento: ${numeroExibicao}\n• Forma: ${
          dados.formaLabel
        }${
          isPixManual ? '\n• Pix conferido pelo comércio (sem confirmação do banco)' : ''
        }\n• Saldo anterior: ${formatCentavos(
          dados.saldoAnterior
        )}\n• Valor pago: ${formatCentavos(dados.valor)}\n• Novo saldo: ${formatCentavos(
          dados.novoSaldo
        )}\n• Limite disponível: ${formatCentavos(
          limiteDisponivel
        )}\n• ${situacaoLinha}\n• Data/hora: ${dataHoraFormatada}\n• Registrado por: ${registradoPorFormatado}`
      : `Olá, ${primeiroNome}! Segue o comprovante de estorno em ${comercioNomeLimpo}:\n• Lançamento: ${numeroExibicao}\n• Valor estornado: ${formatCentavos(
          dados.valor
        )}${
          dados.justificativa ? `\n• Motivo: ${dados.justificativa}` : ''
        }\n• Saldo anterior: ${formatCentavos(
          dados.saldoAnterior
        )}\n• Novo saldo: ${formatCentavos(
          dados.novoSaldo
        )}\n• Limite disponível: ${formatCentavos(
          limiteDisponivel
        )}\n• Data/hora: ${dataHoraFormatada}\n• Registrado por: ${registradoPorFormatado}`;

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
          <p className="text-sm font-semibold tracking-wide text-slate-600">
            {comercioNomeLimpo}
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
            <dt className="text-slate-600">Data/hora</dt>
            <dd className="font-mono-nums text-[#14211E] text-right">{dataHoraFormatada}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Lançamento</dt>
            <dd className="font-mono-nums text-sm font-bold text-[#14211E] text-right">
              {numeroExibicao}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Registrado por</dt>
            <dd className="text-[#14211E] text-right">{registradoPorFormatado}</dd>
          </div>
          <div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Forma</dt>
              <dd className="font-medium text-[#14211E] text-right">{dados.formaLabel}</dd>
            </div>
            {isPixManual && (
              <p className="mt-0.5 text-xs text-slate-500 text-right">
                Pix conferido pelo comércio (sem confirmação do banco)
              </p>
            )}
          </div>
          {dados.itens && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Itens</dt>
              <dd className="text-[#14211E] text-right max-w-[65%]">{dados.itens}</dd>
            </div>
          )}
          {dados.justificativa && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Motivo</dt>
              <dd className="text-[#14211E] text-right max-w-[65%]">{dados.justificativa}</dd>
            </div>
          )}

          <div className="border-t border-dashed border-[#D4D4CE] pt-3 mt-3 space-y-2">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Saldo anterior</dt>
              <dd className="font-mono-nums text-[#14211E]">{formatCentavos(dados.saldoAnterior)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-semibold text-[#14211E]">{rotuloValor}</dt>
              <dd
                className={`font-mono-nums font-bold ${
                  dados.tipo === 'pagamento' ? 'text-teal-700' : 'text-[#14211E]'
                }`}
              >
                {dados.tipo === 'pagamento' ? '− ' : dados.tipo === 'compra' ? '+ ' : ''}
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
            {situacaoLinha && (
              <div className="pt-1 text-sm font-bold text-right">
                <span
                  className={
                    dados.novoSaldo === 0 ? 'text-teal-800' : 'text-[#14211E]'
                  }
                >
                  {situacaoLinha}
                </span>
              </div>
            )}
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
