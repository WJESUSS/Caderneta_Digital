import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { BookOpen, Check, Copy, Lock, MessageCircle, QrCode, ShieldCheck } from 'lucide-react';
import {
  buildWhatsAppUrl,
  formatCentavos,
  formatDateBR,
  type ResumoPublicoCliente,
} from '../lib/businessRules';
import { gerarPayloadPixEstatico } from '../lib/pix';
import { consultarSaldoPublicoPorToken } from '../lib/firestoreService';

type OpcaoValorPix = 'vencido' | 'total' | 'sem_valor';

export const PublicConsultaPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const [digitos, setDigitos] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [resumo, setResumo] = useState<ResumoPublicoCliente | null>(null);

  const [opcaoValorPix, setOpcaoValorPix] = useState<OpcaoValorPix>('sem_valor');
  const [chaveCopiada, setChaveCopiada] = useState(false);
  const [copiaColaCopiado, setCopiaColaCopiado] = useState(false);
  const pixCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setErro(null);
    setIndisponivel(false);
    setResumo(null);
    setDigitos('');
  }, [token]);

  const handleConsultar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (!/^\d{4}$/.test(digitos)) {
      setErro('Digite os 4 últimos dígitos do seu WhatsApp.');
      return;
    }
    setCarregando(true);
    try {
      const resp = await consultarSaldoPublicoPorToken(token, digitos);
      if (resp.status === 'ok') {
        setResumo(resp.resumo);
        if (resp.resumo.valorVencido > 0) {
          setOpcaoValorPix('vencido');
        } else if (resp.resumo.saldoDevedor > 0) {
          setOpcaoValorPix('total');
        } else {
          setOpcaoValorPix('sem_valor');
        }
      } else if (resp.status === 'invalido_digitos') {
        setDigitos('');
        setErro(
          `Número incorreto. Os 4 dígitos não conferem com o WhatsApp cadastrado na loja. Confira e tente novamente. ${
            resp.tentativasRestantes === 1
              ? 'Resta 1 tentativa.'
              : `Restam ${resp.tentativasRestantes} tentativas.`
          }`
        );
      } else if (resp.status === 'bloqueado') {
        setIndisponivel(true);
        setErro(
          'Muitas tentativas incorretas. Por segurança, este link ficou bloqueado. Aguarde 15 minutos e abra o link novamente.'
        );
      } else if (resp.status === 'erro_conexao') {
        setErro('Sem conexão com o servidor. Verifique sua internet e tente novamente.');
      } else if (resp.status === 'erro_dados') {
        setIndisponivel(true);
        setErro('Não foi possível carregar seu extrato. Peça um novo link ao comércio.');
      } else {
        setIndisponivel(true);
        setErro(
          'Não foi possível abrir este link. Ele pode ter expirado, sido substituído por um mais novo ou estar bloqueado por 15 minutos após várias tentativas erradas. Peça um novo link ao comércio.'
        );
      }
    } catch {
      setErro('Sem conexão com o servidor. Verifique sua internet e tente novamente.');
    } finally {
      setCarregando(false);
    }
  };

  const valorPixCentavos = useMemo(() => {
    if (!resumo) return undefined;
    if (opcaoValorPix === 'vencido' && resumo.valorVencido > 0) return resumo.valorVencido;
    if (opcaoValorPix === 'total' && resumo.saldoDevedor > 0) return resumo.saldoDevedor;
    return undefined;
  }, [resumo, opcaoValorPix]);

  const pixPayload = useMemo(() => {
    if (!resumo || !resumo.pixChave) return '';
    return gerarPayloadPixEstatico({
      chavePix: resumo.pixChave,
      nomeRecebedor: resumo.pixRecebedor || resumo.comercioNome,
      valorCentavos: valorPixCentavos,
    });
  }, [resumo, valorPixCentavos]);

  useEffect(() => {
    if (!pixPayload || !pixCanvasRef.current) return;
    void QRCode.toCanvas(pixCanvasRef.current, pixPayload, {
      width: 220,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });
  }, [pixPayload]);

  const handleCopiarChave = async () => {
    if (!resumo?.pixChave) return;
    try {
      await navigator.clipboard.writeText(resumo.pixChave);
      setChaveCopiada(true);
      setTimeout(() => setChaveCopiada(false), 2500);
    } catch {
      setChaveCopiada(false);
    }
  };

  const handleCopiarCopiaCola = async () => {
    if (!pixPayload) return;
    try {
      await navigator.clipboard.writeText(pixPayload);
      setCopiaColaCopiado(true);
      setTimeout(() => setCopiaColaCopiado(false), 2500);
    } catch {
      setCopiaColaCopiado(false);
    }
  };

  const whatsappAvisoUrl = useMemo(() => {
    if (!resumo) return '';
    const valorTexto = valorPixCentavos
      ? formatCentavos(valorPixCentavos)
      : formatCentavos(resumo.saldoDevedor);
    const msg = `Olá! Aqui é ${resumo.primeiroNome}. Acabei de fazer um Pix${
      valorPixCentavos || resumo.saldoDevedor > 0 ? ` de ${valorTexto}` : ''
    } para acertar minha caderneta em ${resumo.comercioNome}. Vou enviar o comprovante aqui!`;

    if (resumo.comercioWhatsapp) {
      return buildWhatsAppUrl(resumo.comercioWhatsapp, msg);
    }
    return `https://wa.me/?text=${encodeURIComponent(msg)}`;
  }, [resumo, valorPixCentavos]);

  return (
    <div className="min-h-screen bg-[#FAFAF8] px-4 py-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="flex items-center justify-center gap-2.5 text-teal-800 mb-6">
          <BookOpen className="h-6 w-6" />
          <span className="text-lg font-bold text-[#14211E]">Caderneta Digital</span>
        </div>

        {!resumo ? (
          <div className="rounded-2xl border border-[#E4E4DF] bg-white p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-800">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#14211E]">Consulta de saldo</h1>
                <p className="text-sm text-slate-600">Acesso exclusivo somente leitura</p>
              </div>
            </div>

            {indisponivel ? (
              <div className="mt-6 rounded-xl bg-slate-100 p-5 text-base text-slate-700" role="alert">
                {erro}
              </div>
            ) : (
              <form onSubmit={handleConsultar} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="digitos-wpp" className="block text-base font-semibold text-[#14211E]">
                    Digite os 4 últimos dígitos do seu WhatsApp
                  </label>
                  <p className="mt-1 text-sm text-slate-600">
                    Confirmação simples para proteger seus dados.
                  </p>
                  <input
                    id="digitos-wpp"
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    autoFocus
                    value={digitos}
                    onChange={(e) => setDigitos(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="0000"
                    className="mt-3 min-h-[54px] w-full rounded-xl border border-[#D4D4CE] px-4 text-center font-mono-nums text-2xl tracking-[0.5em] text-[#14211E] focus:border-teal-700 focus:outline-none"
                  />
                </div>

                {erro && (
                  <p className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-800" role="alert">
                    {erro}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={carregando || digitos.length !== 4}
                  className="min-h-[52px] w-full rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {carregando ? 'Verificando...' : 'Ver meu saldo'}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-2xl border border-[#E4E4DF] bg-white p-6">
              <div className="flex items-center gap-2 text-sm text-teal-800 font-semibold">
                <ShieldCheck className="h-4 w-4" />
                <span>{resumo.comercioNome}</span>
              </div>
              <h1 className="mt-1 text-2xl font-bold text-[#14211E]">
                Olá, {resumo.primeiroNome}
              </h1>

              <div className="mt-5 grid grid-cols-1 gap-4 border-t border-[#ECECE7] pt-5">
                <div>
                  <p className="text-sm text-slate-600">Saldo total em aberto</p>
                  <p className="font-mono-nums text-3xl font-bold text-[#14211E]">
                    {formatCentavos(resumo.saldoDevedor)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-600">Valor vencido</p>
                    <p
                      className={`font-mono-nums text-xl font-bold ${
                        resumo.valorVencido > 0 ? 'text-red-700' : 'text-[#14211E]'
                      }`}
                    >
                      {formatCentavos(resumo.valorVencido)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">A vencer</p>
                    <p className="font-mono-nums text-xl font-bold text-[#14211E]">
                      {formatCentavos(resumo.valorAVencer)}
                    </p>
                  </div>
                </div>

                {typeof resumo.limiteDisponivel === 'number' && (
                  <div className="flex items-center justify-between border-t border-[#ECECE7] pt-3">
                    <span className="text-sm text-slate-600">Limite disponível</span>
                    <span className="font-mono-nums text-base font-bold text-teal-800">
                      {formatCentavos(resumo.limiteDisponivel)}
                    </span>
                  </div>
                )}

                {resumo.proximoVencimento && (
                  <p className="text-base text-slate-700">
                    Próximo vencimento:{' '}
                    <strong className="font-mono-nums">
                      {formatDateBR(resumo.proximoVencimento)}
                    </strong>
                  </p>
                )}

                {resumo.atualizadoEmIso && (
                  <p className="text-xs text-slate-500">
                    Atualizado em{' '}
                    {new Date(resumo.atualizadoEmIso).toLocaleString('pt-BR', {
                      timeZone: 'America/Bahia',
                    })}
                  </p>
                )}
              </div>
            </div>

            {/* Cartão Pix estático — exibido SOMENTE após validação dos 4 últimos dígitos */}
            {resumo.pixChave && (
              <div className="rounded-2xl border border-[#E4E4DF] bg-white p-6 space-y-4">
                <div className="flex items-center gap-2 text-[#14211E]">
                  <QrCode className="h-5 w-5 text-teal-700" />
                  <h2 className="text-lg font-bold">Vai acertar no Pix?</h2>
                </div>

                <div className="rounded-xl border border-[#ECECE7] bg-[#FAFAF8] p-4 space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Recebedor
                  </p>
                  <p className="text-base font-bold text-[#14211E]">
                    {resumo.pixRecebedor || resumo.comercioNome}
                  </p>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 pt-1">
                    Chave Pix
                  </p>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="font-mono-nums text-sm sm:text-base font-semibold text-[#14211E] break-all">
                      {resumo.pixChave}
                    </p>
                    <button
                      type="button"
                      onClick={handleCopiarChave}
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-4 py-2 text-sm font-semibold text-[#14211E] hover:bg-slate-50 shrink-0"
                    >
                      {chaveCopiada ? (
                        <Check className="h-4 w-4 text-teal-700" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      <span>{chaveCopiada ? 'Chave copiada' : 'Copiar chave'}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-semibold text-[#14211E] mb-2">
                    Escolha o valor do QR Code Pix:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {resumo.valorVencido > 0 && (
                      <button
                        type="button"
                        onClick={() => setOpcaoValorPix('vencido')}
                        className={`min-h-[48px] rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                          opcaoValorPix === 'vencido'
                            ? 'border-teal-700 bg-teal-50 text-teal-900'
                            : 'border-[#D4D4CE] bg-white text-[#14211E] hover:bg-slate-50'
                        }`}
                      >
                        Vencido ({formatCentavos(resumo.valorVencido)})
                      </button>
                    )}

                    {resumo.saldoDevedor > 0 && (
                      <button
                        type="button"
                        onClick={() => setOpcaoValorPix('total')}
                        className={`min-h-[48px] rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                          opcaoValorPix === 'total'
                            ? 'border-teal-700 bg-teal-50 text-teal-900'
                            : 'border-[#D4D4CE] bg-white text-[#14211E] hover:bg-slate-50'
                        }`}
                      >
                        Total ({formatCentavos(resumo.saldoDevedor)})
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setOpcaoValorPix('sem_valor')}
                      className={`min-h-[48px] rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                        opcaoValorPix === 'sem_valor'
                          ? 'border-teal-700 bg-teal-50 text-teal-900'
                          : 'border-[#D4D4CE] bg-white text-[#14211E] hover:bg-slate-50'
                      }`}
                    >
                      Sem valor definido
                    </button>
                  </div>
                </div>

                <div className="flex flex-col items-center rounded-xl border border-[#ECECE7] bg-white p-4">
                  <canvas
                    ref={pixCanvasRef}
                    aria-label="QR Code Pix estático"
                    className="max-w-full h-auto block"
                  />
                  <button
                    type="button"
                    onClick={handleCopiarCopiaCola}
                    className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D4D4CE] bg-white px-4 py-2 text-sm font-semibold text-[#14211E] hover:bg-slate-50"
                  >
                    {copiaColaCopiado ? (
                      <Check className="h-4 w-4 text-teal-700" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    <span>
                      {copiaColaCopiado ? 'Código Pix copiado' : 'Copiar Pix Copia e Cola'}
                    </span>
                  </button>
                </div>

                <p className="text-sm text-slate-600 text-center">
                  Depois de pagar, avise a loja pelo WhatsApp.
                </p>

                <a
                  href={whatsappAvisoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#15803D] px-5 py-3 text-base font-semibold text-white hover:bg-[#166534]"
                >
                  <MessageCircle className="h-5 w-5" />
                  <span>Já paguei, avisar no WhatsApp</span>
                </a>
              </div>
            )}

            <div className="rounded-2xl border border-[#E4E4DF] bg-white p-6">
              <h2 className="text-lg font-bold text-[#14211E]">Últimos lançamentos</h2>

              {resumo.lancamentos.length === 0 ? (
                <p className="mt-3 text-base text-slate-600">Nenhum lançamento registrado ainda.</p>
              ) : (
                <ul className="mt-4 divide-y divide-[#ECECE7]">
                  {resumo.lancamentos.map((l) => (
                    <li key={l.id} className="py-3.5 flex items-start justify-between gap-4">
                      <div>
                        <p
                          className={`text-base font-semibold ${
                            l.estornado ? 'line-through text-slate-400' : 'text-[#14211E]'
                          }`}
                        >
                          {l.tipo === 'compra'
                            ? 'Compra fiado'
                            : l.tipo === 'pagamento'
                            ? 'Pagamento'
                            : 'Estorno'}
                        </p>
                        <p className="text-sm text-slate-600">
                          {new Date(l.criadoEmIso).toLocaleDateString('pt-BR')}
                          {l.itens ? ` · ${l.itens}` : ''}
                          {l.vencimento ? ` · Venc. ${formatDateBR(l.vencimento)}` : ''}
                          {l.estornado ? ' · Estornado' : ''}
                        </p>
                      </div>
                      <p
                        className={`font-mono-nums text-base font-bold shrink-0 ${
                          l.estornado
                            ? 'line-through text-slate-400'
                            : l.tipo === 'pagamento'
                            ? 'text-teal-700'
                            : 'text-[#14211E]'
                        }`}
                      >
                        {l.tipo === 'pagamento' ? '− ' : ''}
                        {formatCentavos(l.valor)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
