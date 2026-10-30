import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const FAKE_URL = 'postgresql://u:p@127.0.0.1:5432/x';

describe('API base', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: process.env.DATABASE_URL,
      }),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health responde 200 com estado ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'sinapse-backend' });
  });

  it('GET /api/v1/health/ready confirma a ligação à base de dados', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('rota inexistente devolve 404 num formato uniforme', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nao-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'NOT_FOUND', message: 'Recurso não encontrado.' });
  });

  it('a documentação OpenAPI inclui as rotas de health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toContain('/api/v1/health/ready');
  });
});

describe('loadConfig', () => {
  it('usa valores por defeito seguros', () => {
    const config = loadConfig({ DATABASE_URL: FAKE_URL });
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.PORT).toBe(3001);
    expect(config.NODE_ENV).toBe('development');
  });

  it('rejeita uma PORT inválida sem mostrar o valor', () => {
    expect(() => loadConfig({ PORT: 'abc', DATABASE_URL: FAKE_URL })).toThrow(/PORT/);
  });

  it('exige DATABASE_URL e não a mostra na mensagem', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://segredo@x/y' })).not.toThrow(/segredo/);
  });
});
