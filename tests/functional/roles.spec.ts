import { test } from '@japa/runner'
import Role from '#models/role'
import RoleAssignment from '#models/role_assignment'
import { createUser, grantRole } from '#tests/helpers/rbac'

const qaWriter = {
  name: 'QA writer',
  scope: 'workspace',
  grants: [
    { permission: 'env.read' },
    { permission: 'env.write', environments: { type: 'list', names: ['qa'] } },
  ],
}

test.group('Roles API', () => {
  test('anyone signed in reads the catalogue and the roles', async ({ client, assert }) => {
    const user = await createUser('catalogue@example.com')
    const permissions = await client.get('/api/permissions').loginAs(user)
    permissions.assertStatus(200)
    assert.deepInclude(permissions.body().permissions, { key: 'env.write', level: 'env' })

    const roles = await client.get('/api/roles').loginAs(user)
    roles.assertStatus(200)
    assert.includeMembers(
      roles.body().map((r: any) => r.key),
      ['owner', 'admin', 'member', 'maintainer', 'developer', 'viewer']
    )
  })

  test('an admin creates a custom role with normalized grants', async ({ client, assert }) => {
    const admin = await createUser('roles-admin@example.com')
    await grantRole(admin, 'admin')
    const response = await client.post('/api/roles').loginAs(admin).json(qaWriter)
    response.assertStatus(201)
    assert.deepEqual(response.body().grants, [
      { permission: 'env.read', environments: { type: 'all' } },
      { permission: 'env.write', environments: { type: 'list', names: ['qa'] } },
    ])
    const response1 = await client.post('/api/roles').loginAs(admin).json(qaWriter)
    response1.assertStatus(409)
  })

  test('invalid grants and missing permission are refused', async ({ client }) => {
    const admin = await createUser('roles-admin2@example.com')
    const member = await createUser('roles-member@example.com')
    await grantRole(admin, 'admin')
    await grantRole(member, 'member')
    const response2 = await client.post('/api/roles').loginAs(member).json(qaWriter)
    response2.assertStatus(403)
    const response3 = await client
      .post('/api/roles')
      .loginAs(admin)
      .json({ name: 'Bad', scope: 'instance', grants: [{ permission: 'env.read' }] })
    response3.assertStatus(422)
  })

  test('system roles cannot be changed, used roles cannot be deleted', async ({ client }) => {
    const admin = await createUser('roles-admin3@example.com')
    await grantRole(admin, 'admin')
    const response4 = await client
      .patch('/api/roles/role_developer')
      .loginAs(admin)
      .json({ name: 'Dev' })
    response4.assertStatus(409)
    const response5 = await client.delete('/api/roles/role_viewer').loginAs(admin)
    response5.assertStatus(409)

    const role = await Role.create({
      name: 'Temp',
      scope: 'workspace',
      isSystem: false,
      grants: [],
    } as any)
    await RoleAssignment.create({
      userId: admin.id,
      roleId: role.id,
      scopeType: 'project',
      scopeId: 'prj_x',
    })
    const response6 = await client.delete(`/api/roles/${role.id}`).loginAs(admin)
    response6.assertStatus(409)

    const unused = await Role.create({
      name: 'Unused',
      scope: 'workspace',
      isSystem: false,
      grants: [],
    } as any)
    const response7 = await client.delete(`/api/roles/${unused.id}`).loginAs(admin)
    response7.assertStatus(204)
  })
})
