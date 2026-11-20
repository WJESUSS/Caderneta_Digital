import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  formatWhatsAppDisplay,
  maskWhatsAppInput,
  parseBRLToCentavos,
} from '../lib/businessRules';
import { cadastrarCliente, editarCliente } from '../lib/firestoreService';

export const ClienteFormPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const { clientes, comercio, usuario } = useAuth();
  const navigate = useNavigate();
  const isDono = usuario?.perfil === 'dono';

  const clienteExistente = isEdit ? clientes.find((c) => c.id === id) : undefined;

  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [consentimento, setConsentimento] = useState(false);
  const [limiteStr, setLimiteStr] = useState('200,00');
  const [diaVencimento, setDiaVencimento] = useState(10);
  const [ativo, setAtivo] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (clienteExistente) {
      setNome(clienteExistente.nome);
      setWhatsapp(formatWhatsAppDisplay(clienteExistente.whatsapp));
      setConsentimento(clienteExistente.consentimentoWhatsapp);
      setLimiteStr((clienteExistente.limiteCredito / 100).toFixed(2).replace('.', ','));
      setDiaVencimento(clienteExistente.diaVencimento);
      setAtivo(clienteExistente.ativo);
    } else if (comercio) {
      setLimiteStr((comercio.limitePadrao / 100).toFixed(2).replace('.', ','));
    }
  }, [clienteExistente, comercio]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comercio || !usuario) return;
    setErro(null);
    if (nome.trim().length < 2) {
      setErro('Informe o nome completo do cliente.');
      return;
    }

    const limiteCentavos = isDono
      ? parseBRLToCentavos(limiteStr) || comercio.limitePadrao
      : clienteExistente?.limiteCredito ?? comercio.limitePadrao;

    setSalvando(true);
    try {
      if (isEdit && clienteExistente) {
        await editarCliente({
          clienteId: clienteExistente.id,
          comercioId: comercio.id,
          perfil: usuario.perfil,
          nome: nome.trim(),
          whatsappInput: whatsapp,
          consentimentoWhatsapp: consentimento,
          limiteCreditoCentavos: limiteCentavos,
          diaVencimento,
          ativo: isDono ? ativo : undefined,
          uid: usuario.uid,
        });
        navigate(`/clientes/${clienteExistente.id}`);
      } else {
        const novoId = await cadastrarCliente({
          comercioId: comercio.id,
          nome: nome.trim(),
          whatsappInput: whatsapp,
          consentimentoWhatsapp: consentimento,
          limiteCreditoCentavos: isDono ? limiteCentavos : comercio.limitePadrao,
          diaVencimento,
          uid: usuario.uid,
        });
        navigate(`/clientes/${novoId}`);
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar o cliente.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#E4E4DF] bg-white text-[#14211E] hover:bg-slate-50"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-bold text-[#14211E]">
          {isEdit ? 'Editar cliente' : 'Novo cliente'}
        </h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[#E4E4DF] bg-white p-5 sm:p-6 space-y-4"
      >
        <div>
          <label htmlFor="cli-nome" className="block text-base font-semibold text-[#14211E]">
            Nome do cliente
          </label>
          <input
            id="cli-nome"
            type="text"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex: Dona Raimunda Souza"
            className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="cli-wpp" className="block text-base font-semibold text-[#14211E]">
            WhatsApp (com DDD)
          </label>
          <input
            id="cli-wpp"
            type="tel"
            required
            value={whatsapp}
            onChange={(e) => setWhatsapp(maskWhatsAppInput(e.target.value))}
            placeholder="(71) 99999-9999"
            className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 font-mono-nums text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="cli-limite" className="block text-base font-semibold text-[#14211E]">
              Limite de crédito (R$)
            </label>
            <input
              id="cli-limite"
              type="text"
              inputMode="decimal"
              disabled={!isDono}
              value={limiteStr}
              onChange={(e) => setLimiteStr(e.target.value)}
              className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 font-mono-nums text-base text-[#14211E] disabled:bg-slate-100 disabled:text-slate-600 focus:border-teal-700 focus:outline-none"
            />
            {!isDono && (
              <p className="mt-1 text-xs text-slate-500">Somente o Dono pode alterar o limite.</p>
            )}
          </div>

          <div>
            <label htmlFor="cli-dia" className="block text-base font-semibold text-[#14211E]">
              Dia de vencimento (1 a 28)
            </label>
            <input
              id="cli-dia"
              type="number"
              min={1}
              max={28}
              required
              value={diaVencimento}
              onChange={(e) =>
                setDiaVencimento(Math.max(1, Math.min(28, Number(e.target.value) || 1)))
              }
              className="mt-1.5 min-h-[48px] w-full rounded-xl border border-[#D4D4CE] px-4 font-mono-nums text-base text-[#14211E] focus:border-teal-700 focus:outline-none"
            />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-xl bg-[#FAFAF8] border border-[#E4E4DF] p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={consentimento}
            onChange={(e) => setConsentimento(e.target.checked)}
            className="mt-1 h-5 w-5 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
          />
          <span className="text-sm text-slate-700">
            Confirmo que o cliente autorizou o cadastro e o envio de comprovantes/lembretes pelo WhatsApp (LGPD).
          </span>
        </label>

        {isEdit && isDono && (
          <label className="flex items-center gap-3 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
              className="h-5 w-5 rounded border-slate-300 text-teal-700"
            />
            <span className="text-base font-medium text-[#14211E]">
              Cliente ativo (desmarcar bloqueia novas compras e revoga o link de consulta)
            </span>
          </label>
        )}

        {erro && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-red-800" role="alert">
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={salvando}
          className="min-h-[52px] w-full rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Cadastrar cliente'}
        </button>
      </form>
    </div>
  );
};
