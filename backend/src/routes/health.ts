import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['Sistema'],
        summary: 'Estado do serviço (liveness)',
        response: {
          200: z.object({
            status: z.literal('ok'),
            service: z.string(),
            uptimeSeconds: z.number(),
          }),
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: 'sinapse-backend',
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['Sistema'],
        summary: 'Pronto para receber pedidos (verifica a base de dados)',
        response: {
          200: z.object({ status: z.literal('ok'), database: z.literal('ok') }),
          503: z.object({ status: z.literal('error'), database: z.literal('unavailable') }),
        },
      },
    },
    async (request, reply) => {
      try {
        await app.db.$queryRaw`SELECT 1`;
        return { status: 'ok' as const, database: 'ok' as const };
      } catch (err) {
        // Só o nome do erro: mensagens da base de dados podem conter dados.
        request.log.error(
          { errorName: err instanceof Error ? err.name : 'unknown' },
          'Base de dados indisponível',
        );
        return reply.code(503).send({ status: 'error' as const, database: 'unavailable' as const });
      }
    },
  );
};
