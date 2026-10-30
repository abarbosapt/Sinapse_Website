import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/db.js';

const db = createPrismaClient(process.env.DATABASE_URL ?? '');

const fakeUser = (email: string) => ({
  email,
  name: 'Utilizador Fictício',
  passwordHash: 'hash-ficticio',
  role: 'ADMINISTRATIVO' as const,
});

beforeEach(async () => {
  // TRUNCATE não dispara o trigger de auditoria; só existe na base de testes descartável.
  await db.$executeRawUnsafe('TRUNCATE TABLE audit_log, sessions, users RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await db.$disconnect();
});

describe('users', () => {
  it('cria um utilizador com valores por defeito', async () => {
    const user = await db.user.create({ data: fakeUser('ana@exemplo.pt') });
    expect(user.active).toBe(true);
    expect(user.failedLoginCount).toBe(0);
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejeita email duplicado', async () => {
    await db.user.create({ data: fakeUser('ana@exemplo.pt') });
    await expect(db.user.create({ data: fakeUser('ana@exemplo.pt') })).rejects.toThrow();
  });

  it('rejeita email com maiúsculas (restrição na base de dados)', async () => {
    await expect(db.user.create({ data: fakeUser('Ana@Exemplo.pt') })).rejects.toThrow();
  });

  it('não permite apagar um utilizador com registos de auditoria', async () => {
    const user = await db.user.create({ data: fakeUser('ana@exemplo.pt') });
    await db.auditLog.create({ data: { actorUserId: user.id, action: 'teste.criar' } });
    await expect(db.user.delete({ where: { id: user.id } })).rejects.toThrow();
  });
});

describe('sessions', () => {
  it('rejeita dois tokens com o mesmo hash', async () => {
    const user = await db.user.create({ data: fakeUser('ana@exemplo.pt') });
    const data = {
      userId: user.id,
      tokenHash: 'hash-unico',
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
    };
    await db.session.create({ data });
    await expect(db.session.create({ data })).rejects.toThrow();
  });
});

describe('audit_log', () => {
  it('aceita novos registos', async () => {
    const entry = await db.auditLog.create({ data: { action: 'teste.criar' } });
    expect(entry.id).toBeGreaterThan(0);
  });

  it('não permite alterar nem apagar registos (append-only)', async () => {
    const entry = await db.auditLog.create({ data: { action: 'teste.criar' } });
    await expect(
      db.auditLog.update({ where: { id: entry.id }, data: { action: 'adulterado' } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
  });
});
