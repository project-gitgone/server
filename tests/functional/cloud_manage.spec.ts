import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Team from '#models/team'
import Project from '#models/project'
import Environment from '#models/environment'
import ProjectToken from '#models/project_token'
import UserIdentity from '#models/user_identity'
import { createUser, grantRole } from '#tests/helpers/rbac'
import { disableCloud, enableCloud, signCloudToken, stopCloud } from '#tests/helpers/cloud'

async function linkedUser(subject: string) {
  const user = await createUser(`${subject}@example.com`)
  await UserIdentity.create({ provider: 'gitgone-cloud', subject, userId: user.id })
  return user
}

const bearer = (subject: string, claims: Record<string, unknown> = {}) =>
  `Bearer ${signCloudToken({ sub: subject, ...claims })}`

test.group('Cloud management API', (group) => {
  group.each.teardown(() => disableCloud())
  group.teardown(() => stopCloud())

  test('the management API does not exist on a self-hosted instance', async ({ client }) => {
    await linkedUser('cloud_selfhosted')
    const token = bearer('cloud_selfhosted')
    disableCloud()
    const response = await client.get('/api/manage/v1/auth/me').header('Authorization', token)
    response.assertStatus(404)
  })

  test('a linked user acts with their own rights', async ({ client, assert }) => {
    await enableCloud()
    const team = await Team.create({ name: 'Managed team' })
    const maintainer = await linkedUser('cloud_maintainer')
    const developer = await linkedUser('cloud_developer')
    await grantRole(maintainer, 'maintainer', { team })
    await grantRole(developer, 'developer', { team })

    const members = await client
      .get(`/api/manage/v1/teams/${team.id}/members`)
      .header('Authorization', bearer('cloud_maintainer'))
    members.assertStatus(200)
    assert.lengthOf(members.body(), 2)

    const role = await client
      .post('/api/manage/v1/roles')
      .header('Authorization', bearer('cloud_developer'))
      .json({ name: 'Nope', scope: 'workspace', grants: [] })
    role.assertStatus(403)
  })

  test('encrypted content is out of reach', async ({ client }) => {
    await enableCloud()
    await linkedUser('cloud_reader')
    for (const path of ['/api/manage/v1/secrets/latest?projectId=x&env=development', '/api/manage/v1/keys/vault']) {
      const response = await client.get(path).header('Authorization', bearer('cloud_reader'))
      response.assertStatus(404)
    }
  })

  test('unlinked, deleted and service subjects are refused', async ({ client }) => {
    await enableCloud()
    const deleted = await linkedUser('cloud_deleted')
    deleted.deletedAt = DateTime.now()
    await deleted.save()

    for (const subject of ['cloud_unknown', 'cloud_deleted', 'cloud:service']) {
      const response = await client.get('/api/manage/v1/auth/me').header('Authorization', bearer(subject))
      response.assertStatus(401)
    }
    const noToken = await client.get('/api/manage/v1/auth/me')
    noToken.assertStatus(401)
  })

  test('an instance access token does not open the management API', async ({ client }) => {
    await enableCloud()
    const user = await linkedUser('cloud_token_user')
    const response = await client.get('/api/manage/v1/auth/me').loginAs(user)
    response.assertStatus(401)
  })

  test('no wrapped key ever leaves through the management API', async ({ client, assert }) => {
    await enableCloud()
    const admin = await linkedUser('cloud_admin_keys')
    await grantRole(admin, 'admin')
    admin.encryptedPrivateKey = 'WRAPPED_PRIVATE_KEY'
    admin.keySalt = 'SALT_VALUE'
    await admin.save()
    const team = await Team.create({ name: 'Token leak' })
    const project = await Project.create({ name: 'Token leak project', teamId: team.id })
    await grantRole(admin, 'maintainer', { team })
    await ProjectToken.create({
      name: 'ci',
      token: 'hash',
      cryptoVersion: 2,
      projectId: project.id,
      environment: 'production',
      encryptedProjectKey: 'WRAPPED_PROJECT_KEY',
    })

    for (const path of ['/auth/me', '/users', `/projects/${project.id}/tokens`]) {
      const response = await client.get(`/api/manage/v1${path}`).header('Authorization', bearer('cloud_admin_keys'))
      response.assertStatus(200)
      const body = JSON.stringify(response.body())
      for (const secret of ['WRAPPED_PRIVATE_KEY', 'SALT_VALUE', 'WRAPPED_PROJECT_KEY']) {
        assert.notInclude(body, secret, `${path} leaks ${secret}`)
      }
    }
  })

  test('teams are listed as far as the user can see them', async ({ client, assert }) => {
    await enableCloud()
    const visible = await Team.create({ name: 'Visible team' })
    const hidden = await Team.create({ name: 'Hidden team' })
    await Project.create({ name: 'Visible project', teamId: visible.id })
    const developer = await linkedUser('cloud_teams_dev')
    const admin = await linkedUser('cloud_teams_admin')
    await grantRole(developer, 'developer', { team: visible })
    await grantRole(admin, 'admin')

    const mine = await client.get('/api/manage/v1/teams').header('Authorization', bearer('cloud_teams_dev'))
    mine.assertStatus(200)
    assert.deepEqual(
      mine.body().map((t: { id: string }) => t.id),
      [visible.id]
    )

    const all = await client.get('/api/manage/v1/teams').header('Authorization', bearer('cloud_teams_admin'))
    assert.includeMembers(
      all.body().map((t: { id: string }) => t.id),
      [visible.id, hidden.id]
    )
  })

  test('a user reads their own rights on a team and a project', async ({ client, assert }) => {
    await enableCloud()
    const team = await Team.create({ name: 'Rights team' })
    const project = await Project.create({ name: 'Rights project', teamId: team.id })
    await Environment.create({ projectId: project.id, name: 'qa', protected: false })
    await Environment.create({ projectId: project.id, name: 'production', protected: true })
    const developer = await linkedUser('cloud_rights_dev')
    await grantRole(developer, 'developer', { team })

    const teams = await client.get('/api/manage/v1/teams').header('Authorization', bearer('cloud_rights_dev'))
    assert.notInclude(teams.body()[0].permissions, 'team.members.manage')

    const rights = await client
      .get(`/api/manage/v1/projects/${project.id}/permissions`)
      .header('Authorization', bearer('cloud_rights_dev'))
    rights.assertStatus(200)
    assert.notInclude(rights.body().project, 'project.members.manage')
    assert.include(rights.body().environments.qa, 'env.write')
    assert.notInclude(rights.body().environments.production, 'env.write')
  })
})
