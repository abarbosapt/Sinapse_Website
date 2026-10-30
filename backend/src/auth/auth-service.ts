import { recordAudit } from '../audit.js';
import type { Db } from '../db.js';
import { verifyAgainstDummy, verifyPassword } from './password.js';
import { createSession, revokeSession, type AuthUser, type SessionPolicy } from './sessions.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export type LoginResult =
  { ok: true; user: AuthUser; token: string; expiresAt: Date } | { ok: false };

export interface LoginInput {
  email: string;
  password: string;
  requestId?: string;
}

/**
 * A falha é sempre genérica ({ ok: false }): não revela se o email existe nem se a conta
 * está bloqueada ou inativa. A auditoria guarda só identificadores e o motivo técnico.
 */
export async function login(
  db: Db,
  input: LoginInput,
  policy: SessionPolicy,
  now: Date = new Date(),
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const requestId = input.requestId;
  const user = await db.user.findUnique({ where: { email } });

  if (!user) {
    await verifyAgainstDummy(input.password);
    await recordAudit(db, {
      action: 'auth.login.failure',
      requestId,
      details: { reason: 'unknown_user' },
    });
    return { ok: false };
  }

  const locked = user.lockedUntil !== null && user.lockedUntil > now;
  if (!user.active || locked) {
    await verifyAgainstDummy(input.password);
    await recordAudit(db, {
      action: 'auth.login.failure',
      actorUserId: user.id,
      entityType: 'user',
      entityId: user.id,
      requestId,
      details: { reason: user.active ? 'locked' : 'inactive' },
    });
    return { ok: false };
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    const updated = await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const lockNow = updated.failedLoginCount >= MAX_FAILED_LOGINS;
    if (lockNow) {
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000),
        },
      });
    }
    await recordAudit(db, {
      action: 'auth.login.failure',
      actorUserId: user.id,
      entityType: 'user',
      entityId: user.id,
      requestId,
      details: { reason: 'bad_password', lockedNow: lockNow },
    });
    return { ok: false };
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });
  const { token, expiresAt } = await createSession(db, user.id, policy, now);
  await recordAudit(db, {
    action: 'auth.login.success',
    actorUserId: user.id,
    entityType: 'user',
    entityId: user.id,
    requestId,
  });
  return {
    ok: true,
    token,
    expiresAt,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}

export async function logout(
  db: Db,
  auth: { sessionId: string; userId: string },
  requestId?: string,
  now: Date = new Date(),
): Promise<void> {
  await revokeSession(db, auth.sessionId, now);
  await recordAudit(db, {
    action: 'auth.logout',
    actorUserId: auth.userId,
    entityType: 'session',
    entityId: auth.sessionId,
    requestId,
  });
}
