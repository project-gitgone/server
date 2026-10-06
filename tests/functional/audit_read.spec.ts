import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import AuditEvent from '#models/audit_event'
import { createUser, grantRole } from '#tests/helpers/rbac'

const event = (projectId: string | null, action = 'secrets.pull') =>
  AuditEvent.create({ actorType: 'user', actorId: 'usr_x', actorLabel: 'x@example.com', action, projectId })

test.group('Audit read', () => {
  test('a maintainer reads their project only', async ({ client, assert }) => {
    const team = await Team.create({ name: 'Audit read' })
    const mine = await Project.create({ name: 'Mine', teamId: team.id })
    const otherTeam = await Team.create({ name: 'Other team' })
    const other = await Project.create({ name: 'Other', teamId: otherTeam.id })
    const maintainer = await createUser('audit-reader@example.com')
    await grantRole(maintainer, 'maintainer', { team })
    await event(mine.id)
    await event(other.id)

    const own = await client.get(`/api/audit?projectId=${mine.id}`).loginAs(maintainer)
    own.assertStatus(200)
    assert.lengthOf(own.body().data, 1)
    const foreign = await client.get(`/api/audit?projectId=${other.id}`).loginAs(maintainer)
    foreign.assertStatus(403)
    const instance = await client.get('/api/audit').loginAs(maintainer)
    instance.assertStatus(403)
  })

  test('an admin reads everything and filters by action', async ({ client, assert }) => {
    const admin = await createUser('audit-admin@example.com')
    await grantRole(admin, 'admin')
    await event(null, 'users.create')
    await event(null, 'secrets.pull')

    const all = await client.get('/api/audit?action=users.create').loginAs(admin)
    all.assertStatus(200)
    assert.isTrue(all.body().data.every((e: any) => e.action === 'users.create'))
    assert.isAtLeast(all.body().data.length, 1)
  })
})
