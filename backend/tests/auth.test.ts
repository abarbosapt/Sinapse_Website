import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { login, logout } from '../src/auth/auth-service.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../src/auth/password.js';
import { hasPermission } from '../src/auth/permissions.js';
import { validateSession } from '../src/auth/sessions.js';
import { generateSessionToken, hashSessionToken } from '../src/auth/tokens.js';
import { createPrismaClient } from '../src/db.js';
import { createUser } from '../src/users.js';

const db = createPrismaClient(process.env.DATABASE_URL ?? '');
const policy = { idleMinutes: 60, absoluteHours: 12 };
const PASSWORD = 'palavra-passe-longa-1';
const EMAIL = 'ana@exemplo.pt';
const T0 = new Date('2026-11-02T10:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

async function makeUser(role: 'ADMIN' | 'ADMINISTRATIVO' | 'PROFISSIONAL' = 'ADMIN') {
  return createUser(db, { email: EMAIL, name: 'Ana Fictícia', password: PASSWORD, role });
}

async function loginOk(now: Date = T0) {
  const result = await login(db, { email: EMAIL, password: PASSWORD }, policy, now);
  if (!result.ok) throw new Error('o login devia ter funcionado');
  return result;
}

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE audit_log, sessions, users RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await db.$disconnect();
});

describe('palavras-passe', () => {
  it('gera hashes argon2id diferentes e verifica-os', async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword('outra-palavra-passe', a)).toBe(false);
  });

  it('rejeita hashes mal formados', async () => {
    expect(await verifyPassword(PASSWORD, 'isto-nao-e-um-hash')).toBe(false);
  });

  it('aplica a política de tamanho', () => {
    expect(checkPasswordPolicy('curta')).not.toBeNull();
    expect(checkPasswordPolicy('x'.repeat(129))).not.toBeNull();
    expect(checkPasswordPolicy(PASSWORD)).toBeNull();
  });
});

describe('tokens e permissões', () => {
  it('tokens são aleatórios e o hash é determinístico', () => {
    const t1 = generateSessionToken();
    expect(t1).not.toBe(generateSessionToken());
    expect(hashSessionToken(t1)).toBe(hashSessionToken(t1));
    expect(hashSessionToken(t1)).not.toContain(t1);
  });

  it('as permissões dependem do perfil', () => {
    expect(hasPermission('ADMIN', 'users:manage')).toBe(true);
    expect(hasPermission('ADMINISTRATIVO', 'users:manage')).toBe(false);
    expect(hasPermission('ADMINISTRATIVO', 'dashboard:read')).toBe(true);
    expect(hasPermission('PROFISSIONAL', 'dashboard:read')).toBe(false);
  });
});

describe('utilizadores', () => {
  it('cria utilizador sem expor o hash e regista auditoria', async () => {
    const user = await makeUser();
    expect(JSON.stringify(user)).not.toContain('argon2');
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    const audit = await db.auditLog.findMany({ where: { action: 'user.create' } });
    expect(audit).toHaveLength(1);
  });

  it('rejeita email inválido e palavra-passe fraca', async () => {
    await expect(
      createUser(db, { email: 'sem-arroba', name: 'X', password: PASSWORD, role: 'ADMIN' }),
    ).rejects.toThrow(/Email/);
    await expect(
      createUser(db, { email: EMAIL, name: 'X', password: 'curta', role: 'ADMIN' }),
    ).rejects.toThrow(/12 caracteres/);
  });

  it('normaliza o email para minúsculas', async () => {
    const user = await createUser(db, {
      email: '  Ana@Exemplo.PT ',
      name: 'Ana',
      password: PASSWORD,
      role: 'ADMIN',
    });
    expect(user.email).toBe('ana@exemplo.pt');
  });
});

describe('login', () => {
  it('autentica, cria sessão e regista auditoria', async () => {
    await makeUser();
    const result = await loginOk();
    expect(result.user.email).toBe(EMAIL);
    const stored = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(stored.lastLoginAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: 'auth.login.success' } })).toBe(1);
  });

  it('aceita o email em maiúsculas', async () => {
    await makeUser();
    const result = await login(db, { email: 'ANA@exemplo.PT', password: PASSWORD }, policy, T0);
    expect(result.ok).toBe(true);
  });

  it('falha de forma genérica e sem guardar o email tentado', async () => {
    const result = await login(
      db,
      { email: 'desconhecido@exemplo.pt', password: PASSWORD },
      policy,
      T0,
    );
    expect(result).toEqual({ ok: false });
    const audit = await db.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('desconhecido@exemplo.pt');
  });

  it('bloqueia a conta após 5 falhas e desbloqueia passados 15 minutos', async () => {
    await makeUser();
    for (let i = 0; i < 5; i++) {
      const result = await login(db, { email: EMAIL, password: 'errada-errada-1' }, policy, T0);
      expect(result.ok).toBe(false);
    }
    // Conta bloqueada: nem a palavra-passe certa funciona.
    expect((await login(db, { email: EMAIL, password: PASSWORD }, policy, at(1))).ok).toBe(false);
    // Passado o bloqueio, volta a funcionar.
    expect((await login(db, { email: EMAIL, password: PASSWORD }, policy, at(16))).ok).toBe(true);
    const stored = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(stored.failedLoginCount).toBe(0);
    expect(stored.lockedUntil).toBeNull();
  });

  it('não autentica utilizadores inativos', async () => {
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    expect((await login(db, { email: EMAIL, password: PASSWORD }, policy, T0)).ok).toBe(false);
  });

  it('a auditoria nunca contém palavras-passe', async () => {
    await makeUser();
    await login(db, { email: EMAIL, password: 'errada-errada-1' }, policy, T0);
    await loginOk();
    const audit = JSON.stringify(await db.auditLog.findMany());
    expect(audit).not.toContain(PASSWORD);
    expect(audit).not.toContain('errada-errada-1');
  });
});

describe('sessões', () => {
  it('uma sessão válida devolve o utilizador sem dados sensíveis', async () => {
    await makeUser();
    const { token } = await loginOk();
    const session = await validateSession(db, token, policy, at(10));
    expect(session?.user.email).toBe(EMAIL);
    expect(JSON.stringify(session)).not.toContain('passwordHash');
  });

  it('expira por inatividade (60 minutos)', async () => {
    await makeUser();
    const { token } = await loginOk();
    expect(await validateSession(db, token, policy, at(61))).toBeNull();
  });

  it('expira no limite absoluto (12 horas), mesmo com atividade', async () => {
    await makeUser();
    const { token } = await loginOk();
    const longIdle = { idleMinutes: 100_000, absoluteHours: 12 };
    expect(await validateSession(db, token, longIdle, at(12 * 60 - 1))).not.toBeNull();
    expect(await validateSession(db, token, longIdle, at(12 * 60 + 1))).toBeNull();
  });

  it('o logout revoga a sessão e fica registado', async () => {
    await makeUser();
    const { token, user } = await loginOk();
    const session = await validateSession(db, token, policy, at(1));
    if (!session) throw new Error('a sessão devia existir');
    await logout(db, { sessionId: session.sessionId, userId: user.id }, undefined, at(2));
    expect(await validateSession(db, token, policy, at(3))).toBeNull();
    expect(await db.auditLog.count({ where: { action: 'auth.logout' } })).toBe(1);
  });

  it('desativar o utilizador invalida as sessões', async () => {
    await makeUser();
    const { token, user } = await loginOk();
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await validateSession(db, token, policy, at(1))).toBeNull();
  });

  it('um token desconhecido não valida', async () => {
    expect(await validateSession(db, generateSessionToken(), policy, T0)).toBeNull();
  });
});
