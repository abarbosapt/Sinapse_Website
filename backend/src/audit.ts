import type { Db } from './db.js';

// Só valores simples e não sensíveis: nunca palavras-passe, emails nem dados pessoais.
export type AuditDetails = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  action: string;
  actorUserId?: string | null;
  entityType?: string;
  entityId?: string;
  requestId?: string;
  details?: AuditDetails;
}

// Aceita o cliente normal ou uma transação.
export async function recordAudit(db: Pick<Db, 'auditLog'>, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      actorUserId: entry.actorUserId ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      requestId: entry.requestId ?? null,
      details: entry.details,
    },
  });
}
