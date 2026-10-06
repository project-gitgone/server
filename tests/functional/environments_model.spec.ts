import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import { ensureEnvironment, environmentRef } from '#services/environments'

test.group('Environments model', () => {
  test('ensureEnvironment creates once, with the default protection', async ({ assert }) => {
    const team = await Team.create({ name: 'Env team' })
    const project = await Project.create({ name: 'Env project', teamId: team.id })

    const prod = await ensureEnvironment(project.id, 'production')
    const again = await ensureEnvironment(project.id, 'production')
    const dev = await ensureEnvironment(project.id, 'development')

    assert.equal(prod.id, again.id)
    assert.isTrue(prod.protected)
    assert.isFalse(dev.protected)
    assert.isNull(dev.retention)
  })

  test('environmentRef uses the stored flag, or the default for unknown names', async ({
    assert,
  }) => {
    const team = await Team.create({ name: 'Ref team' })
    const project = await Project.create({ name: 'Ref project', teamId: team.id })
    const live = await ensureEnvironment(project.id, 'live')
    live.protected = true
    await live.save()

    assert.deepEqual(await environmentRef(project.id, 'live'), { name: 'live', protected: true })
    assert.deepEqual(await environmentRef(project.id, 'prod'), { name: 'prod', protected: true })
    assert.deepEqual(await environmentRef(project.id, 'qa'), { name: 'qa', protected: false })
  })
})
