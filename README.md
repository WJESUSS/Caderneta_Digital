# Caderneta Digital — Controle de Fiado e Cobrança

Aplicativo web **mobile-first** e instalável como **PWA** para controle de fiado, limites de crédito com autorização por PIN, recebimento de pagamentos, cobrança manual pelo WhatsApp e consulta de saldo via link único com QR Code.

---

## 1. Pré-requisitos e Configuração do Firebase

1. No [Firebase Console](https://console.firebase.google.com/), selecione o projeto (ou crie um novo na região `southamerica-east1` — São Paulo).
2. Em **Authentication → Sign-in method**, ative:
   - **E-mail/senha** (obrigatório para login de Dono e cadastro de Atendentes com senha provisória).
   - **Google** (opcional, também suportado na tela de login).
3. Em **Authentication → Settings → Authorized domains**, adicione o domínio final de produção do Cloud Run (ex.: `caderneta-digital-xxxx.run.app`).
4. Publique as regras de segurança e índices do Firestore:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

---

## 2. Variáveis de Ambiente

Copie `.env.example` para `.env` e preencha:

- `VITE_APP_PUBLIC_URL`: URL HTTPS final de produção (ex.: `https://caderneta-digital-xxxx.run.app`). **Nunca** deixe `localhost` em produção — é essa URL que será codificada no QR Code (`/qr`) e nos links enviados aos clientes.
- `APP_URL`: mesma URL de produção para configuração de CORS no servidor Express.
- `PORT`: porta HTTP (padrão `3000` local, `8080` no Cloud Run).

---

## 3. Como rodar localmente

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`.

### Rodar testes automatizados (Vitest) e validação das regras

```bash
npm test
npm run lint
npm run lint:rules
```

---

## 4. Como publicar no Google Cloud Run

```bash
gcloud run deploy caderneta-digital \
  --source . \
  --region southamerica-east1 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,VITE_APP_PUBLIC_URL=https://SEU-SERVICO.run.app,APP_URL=https://SEU-SERVICO.run.app"
```

1. No primeiro deploy, pegue a URL gerada pelo Cloud Run.
2. Atualize `VITE_APP_PUBLIC_URL` e `APP_URL` com essa URL HTTPS (e faça o redeploy com `--set-build-env-vars` / `--build-env-vars` para o Vite embutir `VITE_APP_PUBLIC_URL` no bundle).
3. Cadastre esse domínio em **Firebase Authentication → Domínios autorizados**.

---

## 5. Como gerar o QR Code de produção

1. Com `VITE_APP_PUBLIC_URL` apontando para o endereço HTTPS do Cloud Run, abra `https://SEU-SERVICO.run.app/qr` (rota pública, sem login).
2. Confirme que não aparece nenhum alerta vermelho (se aparecer, o endereço ainda está como `localhost` ou `http://`).
3. Clique em **Imprimir cartaz (A4)** para imprimir no balcão do comércio ou **Baixar PNG** para enviar na arte de divulgação.
4. Teste escaneando com a câmera de um celular usando dados móveis (4G/5G).

---

## 6. Backup diário do Firestore (RNF05)

Em produção, ative exportação agendada diária do Firestore para um bucket do Cloud Storage:

```bash
gcloud firestore backups schedules create \
  --database="(default)" \
  --recurrence=daily \
  --retention=14d
```

Ou configure Cloud Scheduler chamando `gcloud firestore export gs://SEU-BUCKET-BACKUP`.
