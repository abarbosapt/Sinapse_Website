import { randomUUID } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { createPrismaClient } from './db.js';
import { AppError } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const GLOBAL_RATE_LIMIT_PER_MINUTE = 300;
const RATE_LIMITED_MESSAGE = 'Demasiados pedidos. Tente novamente mais tarde.';

export async function buildApp(config: Config) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      serializers: {
        // Regista só método e caminho: sem cabeçalhos nem query string (podem conter dados pessoais).
        req(request) {
          return { method: request.method, url: request.url.split('?')[0] };
        },
      },
    },
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: '127.0.0.1',
    bodyLimit: 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  const db = createPrismaClient(config.DATABASE_URL);
  app.decorate('db', db);
  app.decorate('config', config);
  app.decorateRequest('auth', null);
  app.addHook('onClose', async () => {
    await db.$disconnect();
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos.',
        details: error.validation.map((issue) => ({
          path: issue.instancePath,
          message: issue.message,
        })),
      });
    }
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if (statusCode === 429) {
      return reply.code(429).send({ code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE });
    }
    if (statusCode >= 400 && statusCode < 500) {
      const message = error instanceof Error ? error.message : 'Pedido inválido.';
      return reply.code(statusCode).send({ code: 'REQUEST_ERROR', message });
    }
    request.log.error({ err: error }, 'Erro interno');
    return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.' });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ code: 'NOT_FOUND', message: 'Recurso não encontrado.' });
  });

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, {
    global: true,
    max: GLOBAL_RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: RATE_LIMITED_MESSAGE,
    }),
  });

  // Proteção CSRF: pedidos que alteram dados só de origens autorizadas.
  const allowedOrigins = new Set(config.ALLOWED_ORIGINS);
  app.addHook('onRequest', async (request) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origem do pedido não permitida.');
    }
  });

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Sinapse API',
        description: 'API de gestão operacional e financeira da clínica Sinapse',
        version: '0.1.0',
      },
    },
    transform: jsonSchemaTransform,
  });

  // A documentação interativa não é exposta em produção.
  if (config.NODE_ENV !== 'production') {
    await app.register(fastifySwaggerUi, { routePrefix: '/api/v1/docs' });
  }

  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, { prefix: '/api/v1' });

  return app;
}
