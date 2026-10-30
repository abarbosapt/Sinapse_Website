import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { sessionCookieName, sessionPolicyFrom } from './cookie.js';
import { hasPermission, type Permission } from './permissions.js';
import { validateSession, type AuthSession } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthSession | null;
  }
}

async function authenticate(request: FastifyRequest): Promise<AuthSession> {
  const { db, config } = request.server;
  const token = request.cookies[sessionCookieName(config)];
  const session = token ? await validateSession(db, token, sessionPolicyFrom(config)) : null;
  if (!session) throw new AppError(401, 'UNAUTHENTICATED', 'Sessão inválida ou expirada.');
  request.auth = session;
  return session;
}

/** Exige sessão válida. A autorização verifica-se sempre no backend. */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  await authenticate(request);
}

/** Exige sessão válida e a permissão indicada. */
export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest): Promise<void> => {
    const session = await authenticate(request);
    if (!hasPermission(session.user.role, permission)) {
      throw new AppError(403, 'FORBIDDEN', 'Não tem permissão para esta ação.');
    }
  };
}

/** Devolve a sessão já validada por requireAuth/requirePermission. */
export function getAuth(request: FastifyRequest): AuthSession {
  if (!request.auth) throw new AppError(401, 'UNAUTHENTICATED', 'Sessão inválida ou expirada.');
  return request.auth;
}
