import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import {
  calcularVencimentoCompra,
  validarCompra,
  validarPagamento,
} from './src/lib/businessRules';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Redirecionamento HTTP -> HTTPS em produção (Cloud Run)
  if (isProd) {
    app.use((req, res, next) => {
      if (req.path === '/api/health') return next();
      const proto = req.header('x-forwarded-proto');
      if (proto && proto !== 'https') {
        return res.redirect(301, `https://${req.header('host')}${req.originalUrl}`);
      }
      return next();
    });
  }

  // Cabeçalhos de segurança Helmet
  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'", 'https://apis.google.com'],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              fontSrc: ["'self'", 'https://fonts.gstatic.com'],
              imgSrc: ["'self'", 'data:', 'blob:'],
              connectSrc: [
                "'self'",
                'https://*.googleapis.com',
                'https://*.firebaseio.com',
                'https://firestore.googleapis.com',
                'https://identitytoolkit.googleapis.com',
                'https://securetoken.googleapis.com',
              ],
              frameSrc: ["'self'", 'https://*.firebaseapp.com'],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS restrito ao domínio configurado em produção
  const allowedOrigins = [
    process.env.VITE_APP_PUBLIC_URL,
    process.env.APP_URL,
    'http://localhost:3000',
  ]
    .filter((x): x is string => Boolean(x && x.trim()))
    .map((u) => u.replace(/\/+$/, ''));

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || !isProd || allowedOrigins.length === 0) {
          return callback(null, true);
        }
        const normalized = origin.replace(/\/+$/, '');
        if (allowedOrigins.includes(normalized)) {
          return callback(null, true);
        }
        return callback(new Error('Origem não autorizada pelo CORS.'));
      },
    })
  );

  app.use(express.json({ limit: '64kb' }));

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas requisições. Aguarde alguns minutos.' },
  });

  const consultaLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Limite de tentativas excedido. Aguarde 15 minutos.' },
  });

  app.use('/api', apiLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: 'Caderneta Digital',
      timezone: 'America/Bahia',
    });
  });

  const precheckSchema = z.object({
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/i),
  });

  app.post('/api/consulta/precheck', consultaLimiter, (req, res) => {
    const parsed = precheckSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, erro: 'Token inválido.' });
    }
    return res.json({ ok: true });
  });

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

  app.post('/api/validar/lancamento', (req, res) => {
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
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir, { maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Caderneta Digital rodando na porta ${port} (${isProd ? 'produção' : 'desenvolvimento'})`);
  });
}

void startServer();
