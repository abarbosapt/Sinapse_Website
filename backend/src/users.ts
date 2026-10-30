import { z } from 'zod';
import { recordAudit } from './audit.js';
import { checkPasswordPolicy, hashPassword } from './auth/password.js';
import type { Db } from './db.js';
import type { Role } from './generated/prisma/enums.js';

export interface NewUser {
  email: string;
  name: string;
  password: string;
  role: Role;
}

/** Cria um utilizador. Nunca devolve o hash da palavra-passe. */
export async function createUser(db: Db, input: NewUser, actorUserId?: string) {
  const email = input.email.trim().toLowerCase();
  if (!z.email().safeParse(email).success) throw new Error('Email inválido.');
  const name = input.name.trim();
  if (name.length === 0) throw new Error('O nome é obrigatório.');
  const policyError = checkPasswordPolicy(input.password);
  if (policyError) throw new Error(policyError);

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
