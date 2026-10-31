import type { Db } from './db.js';

export interface AuditQuery {
  limit: number;
  beforeId?: number;
  action?: string;
}

/** Consulta paginada (do mais recente para o mais antigo). */
export async function listAudit(db: Db, query: AuditQuery) {
  const rows = await db.auditLog.findMany({
    where: {
      ...(query.action ? { action: query.action } : {}),
      ...(query.beforeId ? { id: { lt: query.beforeId } } : {}),
    },
    orderBy: { id: 'desc' },
    take: query.limit,
  });
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actorUserId: row.actorUserId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    requestId: row.requestId,
    details: row.details,
  }));
}
