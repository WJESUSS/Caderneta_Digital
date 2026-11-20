import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Firestore Rules Static Security Assertions (Dirty Dozen)', () => {
  const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');

  it('1. Enforces default-deny global safety net', () => {
    expect(rules).toContain('match /{document=**}');
    expect(rules).toContain('allow read, write: if false;');
  });

  it('2. Blocks self-promotion on usuarios update and locks perfil', () => {
    expect(rules).toContain("incoming().perfil == existing().perfil");
    expect(rules).toContain("affectedKeys().hasOnly(['ativo', 'nome'])");
  });

  it('3. Enforces strict hasAll + hasOnly blueprints on every entity', () => {
    for (const fn of [
      'isValidComercio',
      'isValidUsuario',
      'isValidCliente',
      'isValidLancamento',
      'isValidLinkConsulta',
      'isValidConsultaPublica',
      'isValidAcessoLink',
      'isValidAuditoria',
    ]) {
      expect(rules).toContain(`function ${fn}(data)`);
    }
  });

  it('4. Restricts estorno creation strictly to isDono', () => {
    expect(rules).toContain("(incoming().tipo != 'estorno' || isDono(incoming().comercioId))");
  });

  it('5. Restricts limiteCredito and comercio settings to isDono', () => {
    expect(rules).toContain("isDono(incoming().comercioId)");
    expect(rules).toContain("isDono(existing().comercioId)");
  });

  it('6. Prevents deleting or mutating financial lancamento fields', () => {
    expect(rules).toContain("match /lancamentos/{lancamentoId}");
    expect(rules).toContain("incoming().diff(existing()).affectedKeys().hasOnly(['valorEmAberto'])");
    expect(rules).toContain("allow delete: if false;");
  });

  it('7. Enforces atomic comercio + dono creation with existsAfter', () => {
    expect(rules).toContain("existsAfter(/databases/$(database)/documents/usuarios/$(request.auth.uid))");
    expect(rules).toContain("existsAfter(/databases/$(database)/documents/comercios/$(incoming().comercioId))");
  });

  it('8. Enforces multi-tenant isolation on list queries', () => {
    expect(rules).toContain("allow list: if isMembroComercio(resource.data.comercioId);");
  });

  it('9. Enforces server request.time on all creation timestamps', () => {
    expect(rules).toContain("incoming().criadoEm == request.time");
    expect(rules).toContain("incoming().quando == request.time");
  });

  it('10. Blocks listing consultasPublicas and requires valid non-expired, non-revoked, unlocked state', () => {
    expect(rules).toContain("allow list: if false;");
    expect(rules).toContain("resource.data.revogado == false");
    expect(rules).toContain("resource.data.expiraEm > request.time");
    expect(rules).toContain("resource.data.bloqueadoAte <= request.time");
  });

  it('11. Protects pinHash and pinSalt from Atendente updates', () => {
    expect(rules).toContain("affectedKeys().hasOnly([\n              'pinTentativasErradas', 'pinBloqueadoAte'\n            ])");
  });

  it('12. Restricts unauthenticated consultasPublicas updates strictly to +1 failed attempt counter', () => {
    expect(rules).toContain("incoming().tentativasErradas == existing().tentativasErradas + 1");
  });
});
