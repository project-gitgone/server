import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import AuditEvent from '#models/audit_event'
import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import type { Scope } from '#services/rbac/assignments'

export type AuditAction =
  | 'auth.login'
  | 'auth.login.failed'
  | 'auth.activate'
  | 'auth.password'
  | 'auth.upgrade'
  | 'auth.init'
  | 'secrets.pull'
  | 'secrets.push'
  | 'secrets.rollback'
  | 'tokens.use'
  | 'tokens.use.denied'
  | 'tokens.create'
  | 'tokens.revoke'
  | 'keys.setup'
  | 'keys.share'
  | 'keys.rotate'
  | 'roles.create'
  | 'roles.update'
  | 'roles.delete'
  | 'access.grant'
  | 'access.revoke'
  | 'environments.create'
  | 'environments.update'
  | 'teams.create'
  | 'projects.create'
  | 'projects.update'
  | 'users.create'
  | 'users.update'
  | 'users.reset'
  | 'users.delete'

export type AuditData = {
  projectId?: string
  environment?: string
  targetType?: string
  targetId?: string
  details?: Record<string, unknown>
  actor?: { type: 'user' | 'token'; id: string; label: string }
  client?: TransactionClientContract
}

const PURGE_INTERVAL_MS = 60 * 60 * 1000
let lastPurge = Date.now()

function purgeIfDue() {
  if (Date.now() - lastPurge < PURGE_INTERVAL_MS) return
  lastPurge = Date.now()
  const days = env.get('AUDIT_RETENTION_DAYS', 365)
  AuditEvent.query()
    .where('created_at', '<', DateTime.now().minus({ days }).toSQL()!)
    .delete()
    .catch((error) => logger.warn({ err: error }, 'Audit purge failed'))
}

export async function audit(
  ctx: Pick<HttpContext, 'auth' | 'request'>,
  action: AuditAction,
  data: AuditData = {}
) {
  const user = ctx.auth.user
  const actor =
    data.actor ?? (user ? { type: 'user' as const, id: user.id, label: user.email } : null)
  if (!actor) throw new Error(`audit(${action}) needs an authenticated user or an explicit actor`)

  try {
    await AuditEvent.create(
      {
        actorType: actor.type,
        actorId: actor.id,
        actorLabel: actor.label,
        action,
        projectId: data.projectId ?? null,
        environment: data.environment ?? null,
        targetType: data.targetType ?? null,
        targetId: data.targetId ?? null,
        details: data.details ?? null,
        ip: ctx.request.ip(),
        userAgent: ctx.request.header('user-agent') ?? null,
      },
      data.client ? { client: data.client } : undefined
    )
  } catch (error) {
    logger.error({ err: error, action }, 'Could not record an audit event')
  }
  purgeIfDue()
}

export function auditAccess(
  ctx: Pick<HttpContext, 'auth' | 'request'>,
  action: 'access.grant' | 'access.revoke',
  change: { userId: string; scope: Scope; roleId?: string }
) {
  return audit(ctx, action, {
    projectId: change.scope.type === 'project' ? change.scope.id : undefined,
    targetType: 'user',
    targetId: change.userId,
    details: { scope: change.scope, ...(change.roleId ? { roleId: change.roleId } : {}) },
  })
}
