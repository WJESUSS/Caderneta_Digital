# Auditoria da Fila Offline e Conformidade com o RNF09

Este documento registra a investigação técnica do comportamento atual de criação, enfileiramento e sincronização de lançamentos offline no projeto **Caderneta Digital**, em comparação com o requisito não funcional **RNF09 revisado** (revalidação de regras na reconexão e encaminhamento de conflitos para revisão do Dono, sem descarte silencioso).

> **Escopo desta entrega:** Apenas investigação e diagnóstico. Nenhuma alteração foi feita no fluxo de sincronização offline no código-fonte nesta etapa.

---

## 1. Mapeamento do comportamento atual

### 1.1 Captura offline na interface (`NovaCompraPage.tsx` e `ReceberPagamentoPage.tsx`)
- **`src/pages/NovaCompraPage.tsx` (linhas 82–114 e 147–178):**
  - Quando `!isOnline` (via `useOnlineStatus()`) ou quando `registrarCompra()` falha com mensagem contendo `'offline'` ou `'network'`, o aplicativo chama `enqueueOfflineLancamento(...)` (`src/lib/offlineQueue.ts`) gravando o item na chave `caderneta_offline_queue_v1` do `localStorage`.
  - Mesmo offline, `validarCompra()` é executada localmente sobre o estado em cache do cliente (`clienteSelecionado.saldoDevedor` e `limiteCredito`), permitindo inclusive abrir o `PinModal` e armazenar `autorizadoExcecaoPor` no item da fila.
  - Em seguida, o sistema exibe imediatamente o `ComprovanteCard` ao operador com a etiqueta `offline: true` (*"Compra salva na fila offline"*).
- **`src/pages/ReceberPagamentoPage.tsx` (linhas 81–112):**
  - Quando `!isOnline`, o aplicativo executa `validarPagamento(clienteSelecionado.saldoDevedor, valorCentavos)` usando o saldo em cache (além da trava do checkbox de conferência de extrato para `pix_manual`), chama `enqueueOfflineLancamento(...)` e exibe o recibo (`ComprovanteCard` com `offline: true`).
  - *Observação:* No bloco `catch` de `ReceberPagamentoPage.tsx` (linhas 141–156), diferente de `NovaCompraPage.tsx`, não há fallback para `enqueueOfflineLancamento` se uma queda de rede ocorrer exatamente durante o envio online.

### 1.2 Estrutura armazenada (`src/lib/offlineQueue.ts`)
Cada item em `caderneta_offline_queue_v1` guarda apenas:
- `idempotencyKey`, `comercioId`, `clienteId`, `clienteNome`, `tipo` (`'compra' | 'pagamento'`), `valor`, `forma`, `itens`, `autorizadoExcecaoPor`, `enqueuedAt` (timestamp em ms).
- Não há campo de `status` (ex.: `pendente`, `em_conflito`, `resolvido`), nem registro do motivo de falha, nem identificação do operador (`registradoPorUid` / `registradoPorNome`) no objeto da fila.

### 1.3 Sincronização na reconexão (`src/context/AuthContext.tsx`, linhas 128–176)
- Ao detectar `isOnline && usuario && comercio`, um `useEffect` lê `getOfflineQueue().filter(q => q.comercioId === comercio.id)` e percorre os itens sequencialmente em loop `for`:
  - Para `'compra'`, chama `registrarCompra(...)` (`src/lib/firestoreService.ts:934`).
  - Para `'pagamento'`, chama `registrarPagamento(...)` (`src/lib/firestoreService.ts:1127`).
- Se a chamada obtiver sucesso (ou encontrar a mesma `idempotencyKey` já gravada), remove o item do `localStorage` via `removeFromOfflineQueue(item.idempotencyKey)`.
- **Tratamento de erro atual (linhas 162–169):**
  ```ts
  if (err instanceof Error && (err.message.includes('limite') || err.message.includes('maior'))) {
    removeFromOfflineQueue(item.idempotencyKey);
    refreshOfflineQueueCount();
  }
  ```

### 1.4 Revalidação no servidor/transação (`src/lib/firestoreService.ts`)
- **As regras `validarCompra` e `validarPagamento` SÃO re-executadas na reconexão?**
  - **Sim.** Tanto `registrarCompra` (linhas 980–1020) quanto `registrarPagamento` (linhas 1170–1202) executam uma `runTransaction` no Firestore, relêem o documento do cliente e recalculam o saldo autoritativo a partir dos lançamentos existentes (`recalcularCarteiraCliente`), validando `validarCompra(...)` e `validarPagamento(...)` contra o saldo real atualizado no banco e checando `idempotencyKey` para evitar duplicidade.

---

## 2. Lacunas encontradas frente ao RNF09 revisado

1. **Descarte silencioso de lançamentos legítimos após recibo emitido (crítico):**
   - Se o cliente fez compras em outro caixa ou teve o limite reduzido enquanto este dispositivo estava offline, `validarCompra` lança `"Compra acima do limite"` na reconexão.
   - Se outro operador registrou um pagamento antes da reconexão, `validarPagamento` lança `"O pagamento não pode ser maior que o saldo devedor."`.
   - Em ambos os casos, `AuthContext.tsx` (linha 165) detecta `'limite'` ou `'maior'` na mensagem e **remove silenciosamente o item do `localStorage`**, sem notificar o Dono, sem registrar na coleção `auditoria` e sem alertar o operador — mesmo que um comprovante já tenha sido exibido/entregue ao cliente offline.

2. **Itens presos em loop de retentativa para outras regras determinísticas:**
   - Erros definitivos cuja mensagem não contém `'limite'` nem `'maior'` — por exemplo:
     - `'Este cliente não possui saldo em aberto.'` (quando o saldo foi zerado por outro operador antes da reconexão);
     - `'Cliente inativo ou anonimizado.'`;
     - erros de permissão (`PERMISSION_DENIED`) caso o atendente tenha sido desativado antes de sincronizar.
   - Esses itens permanecem indefinidamente na fila com status implícito de pendente, falhando a cada re-execução do efeito sem visibilidade para o Dono.

3. **Cálculo de vencimento usa a hora da reconexão em vez de `enqueuedAt` (`firestoreService.ts:1022`):**
   - `registrarCompra` usa `agora = new Date()` no momento da sincronização para `calcularVencimentoCompra(agora, diaVencimento)` em vez de usar `item.enqueuedAt`.
   - Se uma compra foi feita antes da virada do dia de vencimento (ex.: dia 9 à noite offline) e sincronizada no dia 11, o vencimento calculado será deslocado para o mês seguinte ou divergirá do que ocorreu no balcão.

4. **Fila restrita ao `localStorage` do navegador/dispositivo local:**
   - Caso um atendente registre uma compra offline em conflito no caixa 2, o Dono no caixa 1 não consegue visualizar nem resolver o conflito porque a fila não é persistida em coleção compartilhada no Firestore (ex.: `filaConflitos`), além de estar sujeita à limpeza de cache do navegador.

5. **Falta de fluxo de revisão e resolução do Dono:**
   - Não existe painel ou fila de conflitos com ações explícitas (aprovar exceção de limite com PIN do Dono, ajustar/vincular pagamento excedente ou cancelar com justificativa auditada).

---

## 3. Requisitos necessários para atender ao RNF09 revisado

Para adequar a fila offline ao RNF09 revisado em uma próxima etapa de implementação:

1. **Nunca descartar lançamentos em conflito:**
   - Substituir a remoção silenciosa em `AuthContext.tsx` por transição de estado para `conflito` / `pendente_revisao_dono`, mantendo a integridade do dado original (`idempotencyKey`, `enqueuedAt`, `valor`, `itens`, `forma`, `registradoPor`, `motivoConflito`).
2. **Persistência compartilhada para revisão do Dono (ex.: coleção `conflitosSincronizacao` no Firestore + backup local):**
   - Ao ocorrer conflito de regra de negócio na reconexão (`Compra acima do limite`, `Pagamento maior que o saldo`, `Saldo zerado`, `Cliente inativo`), gravar um documento de conflito vinculado ao `comercioId` (com regra no `firestore.rules` permitindo criação por membro do comércio e leitura/resolução apenas pelo Dono, sem exclusão física) e evento em `auditoria`, removendo o item da fila ativa de retentativas apenas após confirmação da gravação do conflito.
3. **Preservar a data original da operação (`enqueuedAt`):**
   - Passar `dataOperacaoMs?: number` opcional para `registrarCompra` / `registrarPagamento` ao sincronizar itens offline, calculando `calcularVencimentoCompra(new Date(enqueuedAt), diaVencimento)` quando aplicável e registrando a data real da venda no balcão.
4. **Painel "Pendências e conflitos offline" (exclusivo do Dono, RN06):**
   - Exibir contador visível no topo/painel do Dono enquanto houver itens `abertos`.
   - Permitir ao Dono escolher uma ação auditada por conflito:
     - **Para compra acima do limite:** *Autorizar exceção com PIN do Dono* (chama `registrarCompra` com `autorizadoExcecaoPor: donoUid`) ou *Descartar compra com justificativa* (grava `auditoria`).
     - **Para pagamento maior que o saldo ou com saldo zerado:** *Abater até o saldo atual* (ajustando valor e registrando diferença na auditoria) ou *Descartar pagamento com justificativa* (ex.: estorno manual no caixa).
     - **Para cliente inativo/anonimizado:** *Arquivar conflito com justificativa* na auditoria (bloqueando gravação de compra em cliente anonimizado).
5. **Testes automatizados:**
   - Cobrir em testes unitários e de regras de segurança: não descarte em erro de limite/saldo, proteção de resolução exclusiva do Dono, preservação de `enqueuedAt` e trilha de auditoria.
