import { z } from 'zod';
import {
  calcularVencimentoCompra,
  validarCompra,
  validarPagamento,
} from '../../src/lib/businessRules';

interface VercelReq {
  method?: string;
  body?: unknown;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
}

const validarLancamentoSchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('compra'),
    saldoDevedorAtual: z.number().int().min(0),
    valorCentavos: z.number().int().positive().max(100_000_000),
    limiteCredito: z.number().int().min(0),
    diaVencimento: z.number().int().min(1).max(28),
    excecaoAutorizadaPorPin: z.boolean().default(false),
  }),
  z.object({
    tipo: z.literal('pagamento'),
    saldoDevedorAtual: z.number().int().min(0),
    valorCentavos: z.number().int().positive().max(100_000_000),
  }),
]);

export default function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  }

  const parsed = validarLancamentoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, erro: 'Dados inválidos.' });
  }

  const data = parsed.data;
  if (data.tipo === 'compra') {
    const check = validarCompra(
      data.saldoDevedorAtual,
      data.valorCentavos,
      data.limiteCredito,
      data.excecaoAutorizadaPorPin
    );
    const vencimento = calcularVencimentoCompra(new Date(), data.diaVencimento);
    return res.status(check.permitida ? 200 : 422).json({
      ...check,
      vencimento,
    });
  }

  const check = validarPagamento(data.saldoDevedorAtual, data.valorCentavos);
  return res.status(check.permitido ? 200 : 422).json(check);
}
