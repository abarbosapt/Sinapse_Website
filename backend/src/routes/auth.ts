import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { login, logout } from '../auth/auth-service.js';
import {
  clearCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
  sessionPolicyFrom,
} from '../auth/cookie.js';
import { getAuth, requireAuth } from '../auth/guards.js';
import { ROLES } from '../auth/permissions.js';
import { AppError } from '../errors.js';
import { changePassword, toUserDto } from '../users.js';

const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  permissions: z.array(z.string()),
});
const errorSchema = z.object({ code: z.string(), message: z.string() });

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { config } = app;
  const policy = sessionPolicyFrom(config);

  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: { max: config.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['Autenticação'],
        summary: 'Iniciar sessão (define o cookie de sessão)',
        body: z.object({
          email: z.string().min(3).max(254),
          password: z.string().min(1).max(256),
        }),
        response: { 200: z.object({ user: userSchema }), 401: errorSchema },
      },
    },
    async (request, reply) => {
      const result = await login(
        app.db,
        { email: request.body.email, password: request.body.password, requestId: request.id },
        policy,
      );
      if (!result.ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Credenciais inválidas.');
      reply.setCookie(
        sessionCookieName(config),
        result.token,
        sessionCookieOptions(config, result.expiresAt),
      );
      return { user: toUserDto(result.user) };
    },
  );

  app.get(
    '/auth/me',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['Autenticação'],
        summary: 'Utilizador da sessão atual',
        response: { 200: z.object({ user: userSchema }), 401: errorSchema },
      },
    },
    async (request) => ({ user: toUserDto(getAuth(request).user) }),
  );

  app.post(
    '/auth/logout',
    {
      preHandler: requireAuth,
      schema: { tags: ['Autenticação'], summary: 'Terminar sessão' },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await logout(app.db, { sessionId: auth.sessionId, userId: auth.user.id }, request.id);
      reply.clearCookie(sessionCookieName(config), clearCookieOptions(config));
      return reply.code(204).send();
    },
  );

  app.post(
    '/auth/change-password',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['Autenticação'],
        summary: 'Alterar a própria palavra-passe (termina todas as sessões)',
        body: z.object({
          currentPassword: z.string().min(1).max(256),
          newPassword: z.string().min(1).max(256),
        }),
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await changePassword(
        app.db,
        auth.user.id,
        request.body.currentPassword,
        request.body.newPassword,
        request.id,
      );
      reply.clearCookie(sessionCookieName(config), clearCookieOptions(config));
      return reply.code(204).send();
    },
  );
};
