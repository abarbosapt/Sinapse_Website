import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPrismaClient } from '../src/db.js';
import { createUser } from '../src/users.js';

const db = createPrismaClient(process.env.DATABASE_URL ?? '');
const ORIGIN = 'http://localhost:5173';
const COOKIE_NAME = '__Host-sinapse_sid';
const PASSWORD = 'palavra-passe-longa-1';
const NEW_PASSWORD = 'outra-palavra-passe-2';
const ADMIN_EMAIL = 'ana@exemplo.pt';
const STAFF_EMAIL = 'bruno@exemplo.pt';

type App = Awaited<ReturnType<typeof buildApp>>;
const apps: App[] = [];

async function makeApp(): Promise<App> {
  const app = await buildApp(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: process.env.DATABASE_URL,
      ALLOWED_ORIGINS: ORIGIN,
      LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
    }),
  );
  await app.ready();
  apps.push(app);
  return app;
}

function setCookieOf(res: LightMyRequestResponse): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
}

function call(
  app: App,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  cookie?: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    ...(payload ? { payload } : {}),
  });
}

async function signInAs(app: App, email: string, password = PASSWORD): Promise<string> {
  const res = await call(app, 'POST', '/api/v1/auth/login', undefined, { email, password });
  const setCookie = setCookieOf(res);
  if (res.statusCode !== 200 || !setCookie) throw new Error('o login devia ter funcionado');
  return setCookie.split(';')[0] ?? '';
}

let adminId = '';
let staffId = '';

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE audit_log, sessions, users RESTART IDENTITY CASCADE');
  const admin = await createUser(db, {
    email: ADMIN_EMAIL,
    name: 'Ana Admin',
    password: PASSWORD,
    role: 'ADMIN',
  });
  const staff = await createUser(db, {
    email: STAFF_EMAIL,
    name: 'Bruno Administrativo',
    password: PASSWORD,
    role: 'ADMINISTRATIVO',
  });
  adminId = admin.id;
  staffId = staff.id;
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

afterAll(async () => {
  await db.$disconnect();
});

describe('permissões', () => {
  it('sem sessão devolve 401', async () => {
    const app = await makeApp();
    expect((await call(app, 'GET', '/api/v1/users')).statusCode).toBe(401);
    expect((await call(app, 'GET', '/api/v1/audit-log')).statusCode).toBe(401);
  });

  it('o perfil administrativo não gere utilizadores nem vê a auditoria', async () => {
    const app = await makeApp();
    const cookie = await signInAs(app, STAFF_EMAIL);
    for (const url of ['/api/v1/users', '/api/v1/audit-log']) {
      const res = await call(app, 'GET', url, cookie);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    }
    const create = await call(app, 'POST', '/api/v1/users', cookie, {
      email: 'novo@exemplo.pt',
      name: 'Novo',
      password: PASSWORD,
      role: 'ADMIN',
    });
    expect(create.statusCode).toBe(403);
    expect(await db.user.count()).toBe(2);
  });

  it('pedidos que alteram dados exigem Origin autorizado', async () => {
    const app = await makeApp();
    const cookie = await signInAs(app, ADMIN_EMAIL);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie },
      payload: { email: 'x@exemplo.pt', name: 'X', password: PASSWORD, role: 'ADMIN' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ORIGIN_NOT_ALLOWED');
  });
});

describe('listar e criar', () => {
  it('o administrador lista os utilizadores sem hashes', async () => {
    const app = await makeApp();
    const cookie = await signInAs(app, ADMIN_EMAIL);
    const res = await call(app, 'GET', '/api/v1/users', cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().users).toHaveLength(2);
    expect(res.body).not.toMatch(/argon2|passwordHash/);
  });

  it('cria um utilizador, que passa a conseguir entrar', async () => {
    const app = await makeApp();
    const cookie = await signInAs(app, ADMIN_EMAIL);
    const res = await call(app, 'POST', '/api/v1/users', cookie, {
      email: 'Carla@Exemplo.pt',
      name: 'Carla Fictícia',
      password: PASSWORD,
      role: 'ADMINISTRATIVO',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe('carla@exemplo.pt');
    expect(await signInAs(app, 'carla@exemplo.pt')).toContain(COOKIE_NAME);
    const audit = await db.auditLog.findMany({ where: { action: 'user.create' } });
    expect(audit.some((entry) => entry.actorUserId === adminId)).toBe(true);
  });

  it('rejeita email duplicado, palavra-passe fraca e perfil inválido', async () => {
    const app = await makeApp();
    const cookie = await signInAs(app, ADMIN_EMAIL);
    const base = { email: 'dina@exemplo.pt', name: 'Dina', password: PASSWORD, role: 'ADMIN' };
    const duplicate = await call(app, 'POST', '/api/v1/users', cookie, {
      ...base,
      email: STAFF_EMAIL,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('EMAIL_IN_USE');
    expect(
      (await call(app, 'POST', '/api/v1/users', cookie, { ...base, password: 'curta' })).statusCode,
    ).toBe(400);
    expect(
      (await call(app, 'POST', '/api/v1/users', cookie, { ...base, role: 'SUPERUSER' })).statusCode,
    ).toBe(400);
  });
});

describe('atualizar', () => {
  it('a mudança de perfil tem efeito imediato na sessão existente', async () => {
    const app = await makeApp();
    const adminCookie = await signInAs(app, ADMIN_EMAIL);
    const staffCookie = await signInAs(app, STAFF_EMAIL);
    expect((await call(app, 'GET', '/api/v1/users', staffCookie)).statusCode).toBe(403);
    const res = await call(app, 'PATCH', `/api/v1/users/${staffId}`, adminCookie, {
      role: 'ADMIN',
    });
    expect(res.statusCode).toBe(200);
    expect((await call(app, 'GET', '/api/v1/users', staffCookie)).statusCode).toBe(200);
  });

  it('desativar revoga as sessões e impede novos logins', async () => {
    const app = await makeApp();
    const adminCookie = await signInAs(app, ADMIN_EMAIL);
    const staffCookie = await signInAs(app, STAFF_EMAIL);
    const res = await call(app, 'PATCH', `/api/v1/users/${staffId}`, adminCookie, {
      active: false,
    });
    expect(res.statusCode).toBe(200);
    expect((await call(app, 'GET', '/api/v1/auth/me', staffCookie)).statusCode).toBe(401);
    const login = await call(app, 'POST', '/api/v1/auth/login', undefined, {
      email: STAFF_EMAIL,
      password: PASSWORD,
    });
    expect(login.statusCode).toBe(401);
    const audit = await db.auditLog.findMany({ where: { action: 'user.update' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.entityId).toBe(staffId);
  });

  it('não deixa o administrador desativar-se nem retirar-se o perfil', async () => {
    const app = await makeApp();
    const cookie = await signInAs(app, ADMIN_EMAIL);
    for (const body of [{ active: false }, { role: 'ADMINISTRATIVO' }]) {
      const res = await call(app, 'PATCH', `/api/v1/users/${adminId}`, cookie, body);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('SELF_LOCKOUT');
    }
    const stored = await db.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(stored.active).toBe(true);
    expect(stored.role).toBe('ADMIN');
  });

  it('valida o pedido: corpo vazio, id inválido e utilizador inexistente', async () => {
    const app = await makeApp();
    const cookie = await signInAs(app, ADMIN_EMAIL);
    expect((await call(app, 'PATCH', `/api/v1/users/${staffId}`, cookie, {})).statusCode).toBe(400);
    expect(
      (await call(app, 'PATCH', '/api/v1/users/nao-e-uuid', cookie, { active: true })).statusCode,
    ).toBe(400);
    const unknown = await call(
      app,
      'PATCH',
      '/api/v1/users/6a1f0c1e-8a3e-4f6e-9a55-1f3c1a1b2c3d',
      cookie,
      { active: true },
    );
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe('USER_NOT_FOUND');
  });

  it('um pedido sem alterações não gera auditoria', async () => {
    const app = await makeApp();
    const cookie = await signInAs(app, ADMIN_EMAIL);
    const res = await call(app, 'PATCH', `/api/v1/users/${staffId}`, cookie, { active: true });
    expect(res.statusCode).toBe(200);
    expect(await db.auditLog.count({ where: { action: 'user.update' } })).toBe(0);
  });
});

describe('redefinir palavra-passe de outro utilizador', () => {
  const reset = (app: App, cookie: string, id: string, newPassword: string) =>
    call(app, 'POST', `/api/v1/users/${id}/reset-password`, cookie, { newPassword });

  it('termina as sessões, desbloqueia a conta e permite entrar com a nova', async () => {
    const app = await makeApp();
    const adminCookie = await signInAs(app, ADMIN_EMAIL);
    const staffCookie = await signInAs(app, STAFF_EMAIL);
    await db.user.update({
      where: { id: staffId },
      data: { failedLoginCount: 3, lockedUntil: new Date(Date.now() + 3_600_000) },
    });
    const res = await reset(app, adminCookie, staffId, NEW_PASSWORD);
    expect(res.statusCode).toBe(204);
    expect((await call(app, 'GET', '/api/v1/auth/me', staffCookie)).statusCode).toBe(401);
    expect(await signInAs(app, STAFF_EMAIL, NEW_PASSWORD)).toContain(COOKIE_NAME);
    const old = await call(app, 'POST', '/api/v1/auth/login', undefined, {
      email: STAFF_EMAIL,
      password: PASSWORD,
    });
    expect(old.statusCode).toBe(401);
    expect(await db.auditLog.count({ where: { action: 'user.password.reset' } })).toBe(1);
  });

  it('não permite redefinir a própria palavra-passe por esta via', async () => {
    const app = await makeApp();
    const cookie = await signInAs(app, ADMIN_EMAIL);
    const res = await reset(app, cookie, adminId, NEW_PASSWORD);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('USE_CHANGE_PASSWORD');
  });

  it('aplica a política de palavras-passe', async () => {
    const app = await makeApp();
    const cookie = await signInAs(app, ADMIN_EMAIL);
    expect((await reset(app, cookie, staffId, 'curta')).statusCode).toBe(400);
  });
});

describe('consulta da auditoria', () => {
  it('lista os registos sem dados pessoais nem palavras-passe', async () => {
    const app = await makeApp();
    const cookie = await signInAs(app, ADMIN_EMAIL);
    await call(app, 'PATCH', `/api/v1/users/${staffId}`, cookie, { name: 'Bruno Renomeado' });
    const res = await call(app, 'GET', '/api/v1/audit-log', cookie);
    expect(res.statusCode).toBe(200);
    const actions = res.json().entries.map((entry: { action: string }) => entry.action);
    expect(actions).toContain('user.update');
    expect(actions).toContain('auth.login.success');
    expect(res.body).not.toContain(PASSWORD);
    expect(res.body).not.toContain(ADMIN_EMAIL);
    expect(res.body).not.toContain('Bruno Renomeado');
  });

  it('pagina e filtra por ação', async () => {
    const app = await makeApp();
    const cookie = await signInAs(app, ADMIN_EMAIL);
    const first = await call(app, 'GET', '/api/v1/audit-log?limit=1', cookie);
    expect(first.json().entries).toHaveLength(1);
    const firstId: number = first.json().entries[0].id;
    const older = await call(app, 'GET', `/api/v1/audit-log?beforeId=${firstId}&limit=100`, cookie);
    expect(older.json().entries.every((entry: { id: number }) => entry.id < firstId)).toBe(true);
    const filtered = await call(app, 'GET', '/api/v1/audit-log?action=user.create', cookie);
    expect(filtered.json().entries.length).toBeGreaterThan(0);
    expect(
      filtered.json().entries.every((entry: { action: string }) => entry.action === 'user.create'),
    ).toBe(true);
  });
});
