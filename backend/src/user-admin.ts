import { recordAudit } from './audit.js';
import { checkPasswordPolicy, hashPassword } from './auth/password.js';
import type { Db } from './db.js';
import { AppError } from './errors.js';
import type { Role } from './generated/prisma/enums.js';

const USER_SELECT = { id: true, email: true, name: true, role: true, active: true } as const;

export async function listUsers(db: Db) {
  const users = await db.user.findMany({
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
    select: { ...USER_SELECT, lastLoginAt: true, createdAt: true },
  });
  return users.map((user) => ({
    ...user,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  }));
}

export interface UserPatch {
  name?: string;
  role?: Role;
  active?: boolean;
}

export async function updateUser(
  db: Db,
  actorId: string,
  targetId: string,
  patch: UserPatch,
  requestId?: string,
) {
  const target = await db.user.findUnique({ where: { id: targetId }, select: USER_SELECT });
  if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'Utilizador não encontrado.');

  // Evita que um administrador fique sem acesso por engano.
  const removesOwnAdmin =
    targetId === actorId &&
    (patch.active === false || (patch.role !== undefined && patch.role !== 'ADMIN'));
  if (removesOwnAdmin) {
    throw new AppError(
      409,
      'SELF_LOCKOUT',
      'Não pode desativar a sua conta nem retirar-se o perfil de administrador.',
    );
  }

  const data: { name?: string; role?: Role; active?: boolean } = {};
  const changed: string[] = [];
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'O nome é obrigatório.');
    if (name !== target.name) {
      data.name = name;
      changed.push('name');
    }
  }
  if (patch.role !== undefined && patch.role !== target.role) {
    data.role = patch.role;
    changed.push('role');
  }
  if (patch.active !== undefined && patch.active !== target.active) {
    data.active = patch.active;
    changed.push('active');
  }
  if (changed.length === 0) return target;

  return db.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: targetId },
      data,
      select: USER_SELECT,
    });
    if (data.active === false) {
      await tx.session.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await recordAudit(tx, {
      action: 'user.update',
      actorUserId: actorId,
      entityType: 'user',
      entityId: targetId,
      requestId,
      // Só nomes de campos e valores não pessoais.
      details: { changed: changed.join(','), role: updated.role, active: updated.active },
    });
    return updated;
  });
}

/** Define uma nova palavra-passe a OUTRO utilizador; termina as suas sessões e desbloqueia-o. */
export async function resetPassword(
  db: Db,
  actorId: string,
  targetId: string,
  newPassword: string,
  requestId?: string,
): Promise<void> {
  if (targetId === actorId) {
    throw new AppError(
      409,
      'USE_CHANGE_PASSWORD',
      'Para alterar a sua palavra-passe use a opção própria (exige a palavra-passe atual).',
    );
  }
  const policyError = checkPasswordPolicy(newPassword);
  if (policyError) throw new AppError(400, 'VALIDATION_ERROR', policyError);
  const target = await db.user.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'Utilizador não encontrado.');

  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });
    await tx.session.updateMany({
      where: { userId: targetId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAudit(tx, {
      action: 'user.password.reset',
      actorUserId: actorId,
      entityType: 'user',
      entityId: targetId,
      requestId,
    });
  });
}
