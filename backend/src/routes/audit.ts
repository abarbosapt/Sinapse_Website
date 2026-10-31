import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '../auth/guards.js';
import { listAudit } from '../audit-log.js';

const entrySchema = z.object({
  id: z.number(),
  occurredAt: z.string(),
  actorUserId: z.string().nullable(),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  requestId: z.string().nullable(),
  details: z.unknown(),
});

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/audit-log',
    {
      preHandler: requirePermission('audit:read'),
      schema: {
        tags: ['Auditoria'],
        summary: 'Consultar o registo de auditoria (mais recentes primeiro)',
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          beforeId: z.coerce.number().int().positive().optional(),
          action: z.string().min(1).max(100).optional(),
        }),
        response: { 200: z.object({ entries: z.array(entrySchema) }) },
      },
    },
    async (request) => ({ entries: await listAudit(app.db, request.query) }),
  );
};
