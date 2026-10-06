import Environment from '#models/environment'
import SecretSnapshot from '#models/secret_snapshot'
import { defaultProtection, type EnvironmentRef } from '#services/rbac/environments'

export const findEnvironment = (projectId: string, name: string) =>
  Environment.query().where('project_id', projectId).where('name', name).first()

export async function ensureEnvironment(projectId: string, name: string) {
  return Environment.firstOrCreate(
    { projectId, name },
    { projectId, name, protected: defaultProtection(name), retention: null }
  )
}

export async function environmentRef(projectId: string, name: string): Promise<EnvironmentRef> {
  const environment = await findEnvironment(projectId, name)
  return { name, protected: environment ? environment.protected : defaultProtection(name) }
}

export const snapshotsOf = (projectId: string, environment: string) =>
  SecretSnapshot.query().where('project_id', projectId).where('environment', environment)

export async function applyRetention(environment: Environment) {
  if (!environment.retention) return 0
  const oldestKept = await snapshotsOf(environment.projectId, environment.name)
    .orderBy('version', 'desc')
    .offset(environment.retention - 1)
    .select('version')
    .first()
  if (!oldestKept) return 0
  const deleted = await snapshotsOf(environment.projectId, environment.name)
    .where('version', '<', oldestKept.version)
    .delete()
  return Number(deleted[0] ?? 0)
}
