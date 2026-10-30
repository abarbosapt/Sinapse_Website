import { z } from 'zod';
import { recordAudit } from './audit.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from './auth/password.js';
import { permissionsFor } from './auth/permissions.js';
import { revokeAllUserSessions, type AuthUser } from './auth/sessions.js';
import type { Db } from './db.js';
import { AppError } from './errors.js';
import type { Role } from './generated/prisma/enums.js';

export interface NewUser {
  email: string;
  name: string;
  password: string;
  role: Role;
}

/** Forma pública de um utilizador (nunca inclui o hash da palavra-passe). */
export function toUserDto(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: permissionsFor(user.role),
  };
}

export async function createUser(db: Db, input: NewUser, actorUserId?: string) {
  const email = input.email.trim().toLowerCase();
  if (!z.email().safeParse(email).success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Email inválido.');
  }
  const name = input.name.trim();
  if (name.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'O nome é obrigatório.');
  const policyError = checkPasswordPolicy(input.password);
  if (policyError) throw new AppError(400, 'VALIDATION_ERROR', policyError);

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new AppError(409, 'EMAIL_IN_USE', 'Já existe um utilizador com este email.');
  }

  const user = await db.user.create({
    data: { email, name, role: input.role, passwordHash: await hashPassword(input.password) },
    select: { id: true, email: true, name: true, role: true, active: true },
  });
  await recordAudit(db, {
    action: 'user.create',
    actorUserId: actorUserId ?? null,
    entityType: 'user',
    entityId: user.id,
    details: { role: user.role },
  });
  return user;
}

/** Só funciona enquanto não existir nenhum administrador. */
export async function createFirstAdmin(db: Db, input: Omit<NewUser, 'role'>) {
  if ((await db.user.count({ where: { role: 'ADMIN' } })) > 0) {
    throw new AppError(
      409,
      'ADMIN_EXISTS',
      'Já existe um administrador. Use a aplicação para criar outros utilizadores.',
    );
  }
  const user = await createUser(db, { ...input, role: 'ADMIN' });
  await recordAudit(db, {
    action: 'admin.bootstrap',
    actorUserId: user.id,
    entityType: 'user',
    entityId: user.id,
  });
  return user;
}

/** Exige a palavra-passe atual e revoga todas as sessões do utilizador. */
export async function changePassword(
  db: Db,
  userId: string,
  currentPassword: string,
  newPassword: string,
  requestId?: string,
): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'A palavra-passe atual está incorreta.');
  }
  const policyError = checkPasswordPolicy(newPassword);
  if (policyError) throw new AppError(400, 'VALIDATION_ERROR', policyError);
  if (newPassword === currentPassword) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'A nova palavra-passe tem de ser diferente da atual.',
    );
  }

  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await revokeAllUserSessions(db, userId);
  await recordAudit(db, {
    action: 'auth.password.change',
    actorUserId: userId,
    entityType: 'user',
    entityId: userId,
    requestId,
  });
}
