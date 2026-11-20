import { z } from 'zod';

interface VercelReq {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
}

const attemptsByIp = new Map<string, { count: number; resetAt: number }>();

const precheckSchema = z.object({
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/i),
});

export default function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  }

  const forwarded = req.headers?.['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded || 'unknown')
    .split(',')[0]
    .trim();

  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const entry = attemptsByIp.get(ip);
  if (!entry || entry.resetAt <= now) {
    attemptsByIp.set(ip, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count += 1;
    if (entry.count > 30) {
      return res.status(429).json({
        ok: false,
        erro: 'Limite de tentativas excedido. Aguarde 15 minutos.',
      });
    }
  }

  const parsed = precheckSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, erro: 'Token inválido.' });
  }

  return res.status(200).json({ ok: true });
}
