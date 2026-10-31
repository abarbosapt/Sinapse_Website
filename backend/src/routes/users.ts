import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getAuth, requirePermission } from '../auth/guards.js';
import { ROLES } from '../auth/permissions.js';
import { listUsers, resetPassword, updateUser } from '../user-admin.js';
import { createUser } from '../users.js';

const userCore = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  active: z.boolean(),
});
const userRow = userCore.extend({ lastLoginAt: z.string().nullable(), createdAt: z.string() });
const idParams = z.object({ id: z.uuid() });

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  const canManage = requirePermission('users:manage');

  app.get(
    '/users',
    {
      preHandler: canManage,
      schema: {
        tags: ['Utilizadores'],
        summary: 'Listar utilizadores',
        response: { 200: z.object({ users: z.array(userRow) }) },
      },
    },
    async () => ({ users: await listUsers(app.db) }),
  );

  app.post(
    '/users',
    {
      preHandler: canManage,
      schema: {
        tags: ['Utilizadores'],
        summary: 'Criar utilizador',
        body: z.object({
          email: z.string().min(3).max(254),
          name: z.string().min(1).max(120),
          password: z.string().min(1).max(256),
          role: z.enum(ROLES),
        }),
        response: { 201: z.object({ user: userCore }) },
      },
    },
    async (request, reply) => {
      const actor = getAuth(request);
      const user = await createUser(app.db, request.body, actor.user.id);
      return reply.code(201).send({ user });
    },
  );

  app.patch(
    '/users/:id',
    {
      preHandler: canManage,
      schema: {
        tags: ['Utilizadores'],
        summary: 'Alterar nome, perfil ou estado (ativo/inativo)',
        params: idParams,
        body: z
          .object({
            name: z.string().min(1).max(120).optional(),
            role: z.enum(ROLES).optional(),
            active: z.boolean().optional(),
          })
          .refine((body) => Object.keys(body).length > 0, {
            message: 'Indique pelo menos um campo.',
          }),
        response: { 200: z.object({ user: userCore }) },
      },
    },
    async (request) => {
      const actor = getAuth(request);
      const user = await updateUser(
        app.db,
        actor.user.id,
        request.params.id,
        request.body,
        request.id,
      );
      return { user };
    },
  );

  app.post(
    '/users/:id/reset-password',
    {
      preHandler: canManage,
      schema: {
        tags: ['Utilizadores'],
        summary: 'Definir nova palavra-passe a outro utilizador (termina as suas sessões)',
        params: idParams,
        body: z.object({ newPassword: z.string().min(1).max(256) }),
      },
    },
    async (request, reply) => {
      const actor = getAuth(request);
      await resetPassword(
        app.db,
        actor.user.id,
        request.params.id,
        request.body.newPassword,
        request.id,
      );
      return reply.code(204).send();
    },
  );
};
