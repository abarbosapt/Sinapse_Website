import type { Db } from '../db.js';
import type { Role } from '../generated/prisma/enums.js';
import { generateSessionToken, hashSessionToken } from './tokens.js';

export interface SessionPolicy {
  idleMinutes: number;
  absoluteHours: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface AuthSession {
  sessionId: string;
  user: AuthUser;
}

// Atualiza "última atividade" no máximo uma vez por minuto (menos escritas).
const TOUCH_INTERVAL_MS = 60_000;

export async function createSession(
  db: Db,
  userId: string,
  policy: SessionPolicy,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + policy.absoluteHours * 3_600_000);
  await db.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: expiresAt,
    },
  });
  return { token, expiresAt };
}

export async function validateSession(
  db: Db,
  token: string,
  policy: SessionPolicy,
  now: Date = new Date(),
): Promise<AuthSession | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || !session.user.active) return null;
  if (session.absoluteExpiresAt <= now) return null;
  const idleLimit = session.lastSeenAt.getTime() + policy.idleMinutes * 60_000;
  if (idleLimit <= now.getTime()) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }
  const { id, email, name, role } = session.user;
  return { sessionId: session.id, user: { id, email, name, role } };
}

export async function revokeSession(
  db: Db,
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export async function revokeAllUserSessions(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
}
