import { describe, expect, it } from 'vitest';
import {
  decryptPublicPayload,
  encryptPublicPayload,
  generateRandomTokenHex,
  sha256Hex,
} from './crypto';

describe('crypto public link encryption & verification', () => {
  it('encrypts and decrypts ResumoPublicoCliente roundtrip with tokenHash and comercioId:last4', async () => {
    const rawToken = generateRandomTokenHex(32);
    const tokenHash = await sha256Hex(rawToken);
    const comercioId = 'com_1795456211240_c1d0e22e43b9f34e';
    const last4 = '2301';

    const payload = {
      comercioNome: 'Mercadinho São João',
      primeiroNome: 'Raimunda',
      saldoDevedor: 13700,
      valorVencido: 9500,
      valorAVencer: 4200,
      proximoVencimento: '2026-12-05',
      atualizadoEmIso: new Date().toISOString(),
      pixChave: '71999990000',
      pixRecebedor: 'Mercadinho São João',
      comercioWhatsapp: '+5571999990000',
      lancamentos: [
        {
          id: 'lnc_1',
          numero: '#CMP-0001',
          tipo: 'compra',
          valor: 14500,
          forma: 'fiado',
          itens: 'Arroz, feijão, óleo e café',
          vencimento: '2026-11-14',
          valorEmAberto: 9500,
          criadoEmIso: new Date().toISOString(),
          estornado: false,
        },
      ],
    };

    const encrypted = await encryptPublicPayload(
      JSON.stringify(payload),
      tokenHash,
      `${comercioId}:${last4}`
    );

    const expectedHash = await sha256Hex(`${tokenHash}:${last4}`);
    const checkHash = await sha256Hex(`${tokenHash}:${last4}`);
    expect(checkHash).toBe(expectedHash);

    const decryptedJson = await decryptPublicPayload(
      encrypted,
      tokenHash,
      `${comercioId}:${last4}`
    );
    const parsed = JSON.parse(decryptedJson);
    expect(parsed.comercioNome).toBe('Mercadinho São João');
    expect(parsed.saldoDevedor).toBe(13700);
    expect(parsed.lancamentos).toHaveLength(1);
  });

  it('rejects decryption when wrong last 4 digits are provided', async () => {
    const rawToken = generateRandomTokenHex(32);
    const tokenHash = await sha256Hex(rawToken);
    const comercioId = 'com_123';

    const encrypted = await encryptPublicPayload(
      JSON.stringify({ ok: true }),
      tokenHash,
      `${comercioId}:1234`
    );

    await expect(
      decryptPublicPayload(encrypted, tokenHash, `${comercioId}:9999`)
    ).rejects.toThrow();
  });
});
