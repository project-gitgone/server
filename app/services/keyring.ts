import { Exception } from '@adonisjs/core/exceptions'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import Project from '#models/project'
import Environment from '#models/environment'
import EnvironmentKey from '#models/environment_key'
import ProjectKey from '#models/project_key'
import ProjectToken from '#models/project_token'
import SecretSnapshot from '#models/secret_snapshot'
import User from '#models/user'
import { findEnvironment } from '#services/environments'
import { defaultProtection, type EnvironmentRef } from '#services/rbac/environments'
import { usersWithPermission } from '#services/rbac/permission_resolver'

export type Keyring =
  | { kind: 'project'; project: Project }
  | {
      kind: 'environment'
      project: Project
      environment: EnvironmentRef & { record: Environment | null }
    }

export async function deleteCount(query: { delete(): Promise<unknown> }) {
  const result = (await query.delete()) as number[]
  return Number(result[0] ?? 0)
}

export const projectKeyring = (project: Project): Keyring => ({ kind: 'project', project })

export async function environmentKeyring(project: Project, name: string): Promise<Keyring> {
  const record = await findEnvironment(project.id, name)
  return {
    kind: 'environment',
    project,
    environment: {
      name,
      protected: record ? record.protected : defaultProtection(name),
      record,
    },
  }
}

export async function effectiveKeyring(project: Project, name: string): Promise<Keyring> {
  const keyring = await environmentKeyring(project, name)
  return keyringVersion(keyring) > 0 ? keyring : projectKeyring(project)
}

export const keyringVersion = (keyring: Keyring) =>
  keyring.kind === 'project'
    ? keyring.project.keyVersion
    : (keyring.environment.record?.keyVersion ?? 0)

export async function keyringReaders(keyring: Keyring): Promise<string[]> {
  if (keyring.kind === 'environment') {
    return usersWithPermission(keyring.project, 'env.read', {
      name: keyring.environment.name,
      protected: keyring.environment.protected,
    })
  }
  const inherited = await Environment.query()
    .where('project_id', keyring.project.id)
    .whereNull('key_version')
  if (inherited.length === 0) return usersWithPermission(keyring.project, 'env.read')
  const readers = await Promise.all(
    inherited.map((environment) =>
      usersWithPermission(keyring.project, 'env.read', {
        name: environment.name,
        protected: environment.protected,
      })
    )
  )
  return [...new Set(readers.flat())]
}

export async function keyringRecipients(keyring: Keyring, client?: TransactionClientContract) {
  const readerIds = await keyringReaders(keyring)
  return {
    query: () =>
      User.query(client ? { client } : {})
        .whereNull('deleted_at')
        .whereNotNull('public_key')
        .whereIn('id', readerIds),
  }
}

export function findUserKey(keyring: Keyring, userId: string) {
  if (keyring.kind === 'project') {
    return ProjectKey.query()
      .where('project_id', keyring.project.id)
      .where('user_id', userId)
      .first()
  }
  const environmentId = keyring.environment.record?.id
  if (!environmentId) return Promise.resolve(null)
  return EnvironmentKey.query()
    .where('environment_id', environmentId)
    .where('user_id', userId)
    .first()
}

const separatedEnvironments = (projectId: string, client?: TransactionClientContract) =>
  Environment.query(client ? { client } : {})
    .where('project_id', projectId)
    .whereNotNull('key_version')
    .select('name')

function coveredBy<Query extends ModelQueryBuilderContract<any, any>>(
  query: Query,
  keyring: Keyring,
  client?: TransactionClientContract
): Query {
  query.where('project_id', keyring.project.id)
  return keyring.kind === 'project'
    ? query.whereNotIn('environment', separatedEnvironments(keyring.project.id, client))
    : query.where('environment', keyring.environment.name)
}

export const keyringSnapshots = (keyring: Keyring, client?: TransactionClientContract) =>
  coveredBy(SecretSnapshot.query(client ? { client } : {}), keyring, client)

export const keyringTokens = (keyring: Keyring, client?: TransactionClientContract) =>
  coveredBy(ProjectToken.query(client ? { client } : {}), keyring, client)

export const keyHolders = (keyring: Keyring) =>
  keyring.kind === 'project'
    ? ProjectKey.query().where('project_id', keyring.project.id).select('user_id')
    : EnvironmentKey.query()
        .where('environment_id', keyring.environment.record?.id ?? '')
        .select('user_id')

export class KeyAlreadySharedError extends Exception {
  static status = 409
}

export async function saveUserKey(
  keyring: Keyring,
  userId: string,
  encryptedKey: string,
  client?: TransactionClientContract
) {
  if (!client && (await findUserKey(keyring, userId))) {
    throw new KeyAlreadySharedError('This user already holds the key')
  }
  const options = client ? { client } : undefined
  return keyring.kind === 'project'
    ? ProjectKey.create({ projectId: keyring.project.id, userId, encryptedKey }, options)
    : EnvironmentKey.create(
        { environmentId: keyring.environment.record!.id, userId, encryptedKey },
        options
      )
}

type KeysToRotate = {
  projectsToRotate: { id: string; name: string; keyVersion: number }[]
  environmentsToRotate: { projectId: string; projectName: string; environment: string }[]
}

export async function revokeLostKeys(projects: Project[], userId?: string): Promise<KeysToRotate> {
  const result: KeysToRotate = { projectsToRotate: [], environmentsToRotate: [] }

  for (const project of projects) {
    const projectReaders = await keyringReaders(projectKeyring(project))
    const lostProjectKey = ProjectKey.query()
      .where('project_id', project.id)
      .whereNotIn('user_id', projectReaders)
    if (userId) lostProjectKey.where('user_id', userId)
    if ((await deleteCount(lostProjectKey)) > 0) {
      result.projectsToRotate.push({
        id: project.id,
        name: project.name,
        keyVersion: project.keyVersion,
      })
    }

    const separated = await Environment.query()
      .where('project_id', project.id)
      .whereNotNull('key_version')
    for (const environment of separated) {
      const readers = await keyringReaders(await environmentKeyring(project, environment.name))
      const lostKey = EnvironmentKey.query()
        .where('environment_id', environment.id)
        .whereNotIn('user_id', readers)
      if (userId) lostKey.where('user_id', userId)
      if ((await deleteCount(lostKey)) === 0) continue
      environment.rotationRequired = true
      await environment.save()
      result.environmentsToRotate.push({
        projectId: project.id,
        projectName: project.name,
        environment: environment.name,
      })
    }
  }
  return result
}

export async function revokeAllKeysOf(userId: string) {
  await ProjectKey.query().where('user_id', userId).delete()
  const heldKeys = await EnvironmentKey.query().where('user_id', userId).select('environment_id')
  const environmentIds = heldKeys.map((k) => k.environmentId)
  await EnvironmentKey.query().where('user_id', userId).delete()
  if (environmentIds.length > 0) {
    await Environment.query().whereIn('id', environmentIds).update({ rotation_required: true })
  }
}
