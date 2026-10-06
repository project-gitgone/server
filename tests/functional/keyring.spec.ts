import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import Environment from '#models/environment'
import SecretSnapshot from '#models/secret_snapshot'
import {
  effectiveKeyring,
  environmentKeyring,
  keyringReaders,
  keyringSnapshots,
  keyringVersion,
  projectKeyring,
} from '#services/keyring'
import { createUser, grantRole } from '#tests/helpers/rbac'

async function workspace() {
  const team = await Team.create({ name: 'Keyring' })
  const project = await Project.create({ name: 'Keyring project', teamId: team.id })
  const maintainer = await createUser(`kr-maintainer-${Math.random()}@example.com`)
  await grantRole(maintainer, 'maintainer', { team })
  const snapshot = (environment: string) =>
    SecretSnapshot.create({
      projectId: project.id,
      environment,
      version: 1,
      ciphertext: 'c',
      iv: 'i',
      authTag: 't',
      createdBy: maintainer.id,
    })
  return { team, project, maintainer, snapshot }
}

test.group('Keyring', () => {
  test('an inherited environment uses the project keyring, a separated one its own', async ({
    assert,
  }) => {
    const { project } = await workspace()
    const development = await Environment.create({
      projectId: project.id,
      name: 'development',
      protected: false,
    })

    const inherited = await effectiveKeyring(project, 'development')
    assert.equal(inherited.kind, 'project')
    assert.equal(keyringVersion(await environmentKeyring(project, 'development')), 0)

    development.keyVersion = 1
    await development.save()
    const separated = await effectiveKeyring(project, 'development')
    assert.equal(separated.kind, 'environment')
    assert.equal(keyringVersion(separated), 1)

    const missing = await effectiveKeyring(project, 'qa')
    assert.equal(missing.kind, 'project')
  })

  test('the project keyring covers only inherited environments', async ({ assert }) => {
    const { project, snapshot } = await workspace()
    await Environment.create({ projectId: project.id, name: 'development', protected: false })
    await Environment.create({
      projectId: project.id,
      name: 'production',
      protected: true,
      keyVersion: 1,
    })
    await snapshot('development')
    await snapshot('production')

    const projectSnapshots = await keyringSnapshots(projectKeyring(project))
    assert.deepEqual(
      projectSnapshots.map((s) => s.environment),
      ['development']
    )
    const productionSnapshots = await keyringSnapshots(
      await environmentKeyring(project, 'production')
    )
    assert.deepEqual(
      productionSnapshots.map((s) => s.environment),
      ['production']
    )
  })

  test('readers of a protected environment exclude viewers', async ({ assert }) => {
    const { team, project, maintainer } = await workspace()
    const viewer = await createUser(`kr-viewer-${Math.random()}@example.com`)
    await grantRole(viewer, 'viewer', { team })
    await Environment.create({
      projectId: project.id,
      name: 'production',
      protected: true,
      keyVersion: 1,
    })

    assert.deepEqual(await keyringReaders(await environmentKeyring(project, 'production')), [
      maintainer.id,
    ])
    assert.sameMembers(await keyringReaders(projectKeyring(project)), [maintainer.id, viewer.id])
  })
})
