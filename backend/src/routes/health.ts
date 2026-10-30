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
};
