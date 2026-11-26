# Security Specification — Caderneta Digital

## 1. Data Invariants
1. Multi-tenancy: Every `clientes`, `lancamentos`, `linksConsulta`, `consultasPublicas`, `acessosLink`, `auditoria`, `consentimentos`, and `solicitacoesTitular` document belongs strictly to a single `comercioId`. Cross-tenant reads and writes are forbidden.
2. Role Segregation (RN06 / RNF06): Only `dono` can change `clientes.limiteCredito`, `clientes.diaVencimento`, `clientes.consentimentoWhatsapp`, `clientes.consentimentoEm`, `clientes.ativo`, `clientes.anonimizado`, create `estorno` records, manage `usuarios` (create/toggle `atendente`), conclude `solicitacoesTitular`, or update `comercios` settings/PIN. `atendente` can only edit `clientes.nome` and `clientes.whatsapp`, or register `opt_out` (`semContatoWhatsapp: true`), besides creating purchases/payments. `atendente` cannot promote themselves to `dono` or create `estorno`.
3. Immutability (RN07 / RF17 / RF19): `lancamentos`, `auditoria`, `consentimentos`, and `solicitacoesTitular` cannot be deleted. `consentimentos` cannot be updated. `solicitacoesTitular` cannot be reopened once `status == 'atendida'`. Financial fields (`valor`, `tipo`, `clienteId`, `forma`, `estornoDe`, `justificativa`, `criadoPor`, `criadoEm`) in `lancamentos` cannot be mutated after creation.
4. Balance Integrity: `clientes.saldoDevedor == clientes.valorVencido + clientes.valorAVencer` and all three are non-negative integers (centavos).
5. Zero-Plaintext Public Lookup (RN19): `consultasPublicas/{tokenHash}` cannot be listed (`allow list: if false`). Unauthenticated `get` requires non-revoked, non-expired, non-blocked state and yields only AES-GCM encrypted payload (`payloadCifrado`) keyed by `token + last4Digits`.
6. Timestamp Integrity: All `criadoEm`, `atualizadoEm`, `quando`, `dataHora`, `dataAbertura`, and `dataConclusao` fields on create/conclusion must equal `request.time`.

## 2. The "Dirty Dozen" (+ LGPD/RN06) Adversarial Payloads
1. Cross-tenant `clientes` list without `comercioId` filter or with another store's `comercioId`.
2. Self-promotion: `usuarios/{uid}` update attempting to change `perfil: "dono"`.
3. Shadow field injection: `clientes` create containing an extra ghost key `isVerified: true`.
4. Attendant creating an `estorno` lancamento (`tipo: "estorno"`).
5. Attendant modifying `clientes.limiteCredito` or `comercios.pinHash`.
6. Mutating `lancamentos.valor` or deleting a `lancamentos` document.
7. Creating a `comercio` with `donoUid` set to another user's UID.
8. Creating a `usuario` (`perfil: "dono"`) attached to an existing `comercioId`.
9. Forged client-side timestamp (`criadoEm` != `request.time`) on `lancamentos` create.
10. Listing `consultasPublicas` collection directly without knowing a `tokenHash`.
11. Reading a revoked or expired `consultasPublicas/{tokenHash}` document publicly.
12. Unauthenticated write trying to overwrite `consultasPublicas.payloadCifrado` or `revogado`.
13. Attendant attempting to modify `clientes.diaVencimento` on an existing client (`update` with `diaVencimento`).
14. Attendant attempting to modify `clientes.consentimentoWhatsapp` or `clientes.consentimentoEm` directly, or revert `semContatoWhatsapp: false`.
15. Member attempting to update or delete a `consentimentos` event, or delete/reopen an attended `solicitacoesTitular` document.
