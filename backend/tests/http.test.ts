import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPrismaClient } from '../src/db.js';
import { createFirstAdmin, createUser } from '../src/users.js';

const db = createPrismaClient(process.env.DATABASE_URL ?? '');
const ORIGIN = 'http://localhost:5173';
const COOKIE_NAME = '__Host-sinapse_sid';
const PASSWORD = 'palavra-passe-longa-1';
const NEW_PASSWORD = 'outra-palavra-passe-2';
const EMAIL = 'ana@exemplo.pt';

type App = Awaited<ReturnType<typeof buildApp>>;
const apps: App[] = [];

async function makeApp(overrides: Record<string, string> = {}): Promise<App> {
  const app = await buildApp(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: process.env.DATABASE_URL,
      ALLOWED_ORIGINS: ORIGIN,
      LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
      ...overrides,
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

const cookiePair = (setCookie: string) => setCookie.split(';')[0] ?? '';

function signIn(app: App, email = EMAIL, password = PASSWORD) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: ORIGIN },
    payload: { email, password },
  });
}

async function signInCookie(app: App): Promise<string> {
  const res = await signIn(app);
  const setCookie = setCookieOf(res);
  if (res.statusCode !== 200 || !setCookie) throw new Error('o login devia ter funcionado');
  return cookiePair(setCookie);
}

const me = (app: App, cookie?: string) =>
  app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: cookie ? { cookie } : {},
  });

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE audit_log, sessions, users RESTART IDENTITY CASCADE');
  await createUser(db, { email: EMAIL, name: 'Ana Fictícia', password: PASSWORD, role: 'ADMIN' });
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

afterAll(async () => {
  await db.$disconnect();
});

describe('POST /auth/login', () => {
  it('autentica e define um cookie seguro, sem expor dados sensíveis', async () => {
    const app = await makeApp();
    const res = await signIn(app);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe(EMAIL);
    expect(body.user.permissions).toContain('users:manage');
    expect(res.body).not.toMatch(/argon2|passwordHash/);

    const setCookie = setCookieOf(res);
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Domain=/i);
  });

  it('devolve a mesma resposta para palavra-passe errada e utilizador inexistente', async () => {
    const app = await makeApp();
    const wrong = await signIn(app, EMAIL, 'errada-errada-12');
    const unknown = await signIn(app, 'ninguem@exemplo.pt', PASSWORD);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json().code).toBe('INVALID_CREDENTIALS');
    expect(setCookieOf(wrong)).toBeUndefined();
  });

  it('rejeita corpos inválidos com um formato uniforme', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: EMAIL },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.json().details)).toBe(true);
  });

  it('limita as tentativas por IP (429)', async () => {
    const app = await makeApp({ LOGIN_RATE_LIMIT_PER_MINUTE: '3' });
    for (let i = 0; i < 3; i++) {
      expect((await signIn(app, EMAIL, 'errada-errada-12')).statusCode).toBe(401);
    }
    const blocked = await signIn(app, EMAIL, 'errada-errada-12');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('RATE_LIMITED');
  });
});

describe('proteção de origem (CSRF)', () => {
  it('rejeita pedidos que alteram dados sem Origin', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('rejeita uma origem não autorizada', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://site-malicioso.example' },
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
  });

  it('não exige Origin em pedidos de leitura', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
  });
});

describe('sessão e logout', () => {
  it('GET /auth/me exige sessão', async () => {
    const app = await makeApp();
    const res = await me(app);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  it('GET /auth/me devolve o utilizador com a sessão', async () => {
    const app = await makeApp();
    const cookie = await signInCookie(app);
    const res = await me(app, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(EMAIL);
  });

  it('um cookie inventado não autentica', async () => {
    const app = await makeApp();
    const res = await me(app, `${COOKIE_NAME}=token-inventado`);
    expect(res.statusCode).toBe(401);
  });

  it('o logout revoga a sessão e limpa o cookie', async () => {
    const app = await makeApp();
    const cookie = await signInCookie(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin: ORIGIN },
    });
    expect(res.statusCode).toBe(204);
    expect(setCookieOf(res)).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
    expect((await me(app, cookie)).statusCode).toBe(401);
  });
});

describe('POST /auth/change-password', () => {
  const change = (app: App, cookie: string, currentPassword: string, newPassword: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { cookie, origin: ORIGIN },
      payload: { currentPassword, newPassword },
    });

  it('altera a palavra-passe e termina todas as sessões', async () => {
    const app = await makeApp();
    const cookie = await signInCookie(app);
    const res = await change(app, cookie, PASSWORD, NEW_PASSWORD);
    expect(res.statusCode).toBe(204);
    expect((await me(app, cookie)).statusCode).toBe(401);
    expect((await signIn(app, EMAIL, PASSWORD)).statusCode).toBe(401);
    expect((await signIn(app, EMAIL, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('exige a palavra-passe atual correta', async () => {
    const app = await makeApp();
    const cookie = await signInCookie(app);
    const res = await change(app, cookie, 'errada-errada-12', NEW_PASSWORD);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_CURRENT_PASSWORD');
    expect((await me(app, cookie)).statusCode).toBe(200);
  });

  it('aplica a política de palavras-passe e exige que seja diferente', async () => {
    const app = await makeApp();
    const cookie = await signInCookie(app);
    expect((await change(app, cookie, PASSWORD, 'curta')).statusCode).toBe(400);
    expect((await change(app, cookie, PASSWORD, PASSWORD)).statusCode).toBe(400);
  });

  it('exige sessão', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { origin: ORIGIN },
      payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('primeiro administrador', () => {
  it('só pode ser criado quando não existe nenhum administrador', async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE audit_log, sessions, users RESTART IDENTITY CASCADE',
    );
    const admin = await createFirstAdmin(db, {
      email: 'admin@exemplo.pt',
      name: 'Admin Fictício',
      password: PASSWORD,
    });
    expect(admin.role).toBe('ADMIN');
    await expect(
      createFirstAdmin(db, { email: 'outro@exemplo.pt', name: 'Outro', password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'ADMIN_EXISTS' });
    expect(await db.auditLog.count({ where: { action: 'admin.bootstrap' } })).toBe(1);
  });
});
