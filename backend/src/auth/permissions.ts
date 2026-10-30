import type { Role } from '../generated/prisma/enums.js';

export const ROLES = ['ADMIN', 'ADMINISTRATIVO', 'PROFISSIONAL'] as const satisfies readonly Role[];

// Acrescentam-se permissões à medida que as etapas as introduzem.
export const PERMISSIONS = ['dashboard:read', 'users:manage', 'audit:read'] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ['dashboard:read', 'users:manage', 'audit:read'],
  ADMINISTRATIVO: ['dashboard:read'],
  PROFISSIONAL: [], // consulta da própria agenda: Etapa C
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
