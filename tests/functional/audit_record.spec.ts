import { test } from '@japa/runner'
import hash from '@adonisjs/core/services/hash'
import Team from '#models/team'
import Project from '#models/project'
import ProjectToken from '#models/project_token'
import SecretSnapshot from '#models/secret_snapshot'
import AuditEvent from '#models/audit_event'
import { createUser, grantRole } from '#tests/helpers/rbac'

test.group('Audit record', () => {
  test('push and pull are recorded with the user, project and environment', async ({
    client,
    assert,
  }) => {
    const team = await Team.create({ name: 'Audit' })
    const project = await Project.create({ name: 'Audit project', teamId: team.id })
    const dev = await createUser('audited@example.com')
    await grantRole(dev, 'developer', { team })

    const push = await client
      .post('/api/secrets')
      .loginAs(dev)
      .json({
        projectId: project.id,
        environment: 'development',
        encryptedData: { ciphertext: 'c', iv: 'i', authTag: 't' },
      })
    push.assertStatus(201)
    const pull = await client
      .get(`/api/secrets/latest?projectId=${project.id}&env=development`)
      .loginAs(dev)
    pull.assertStatus(200)

    const events = await AuditEvent.query().where('project_id', project.id).orderBy('created_at')
    assert.deepEqual(
      events.map((e) => ({
        action: e.action,
        actorType: e.actorType,
        actorId: e.actorId,
        environment: e.environment,
      })),
      [
        { action: 'secrets.push', actorType: 'user', actorId: dev.id, environment: 'development' },
        { action: 'secrets.pull', actorType: 'user', actorId: dev.id, environment: 'development' },
      ]
    )
    assert.equal(events[0].actorLabel, 'audited@example.com')
  })

  test('a CI token pull records the token as actor', async ({ client, assert }) => {
    const team = await Team.create({ name: 'Audit token' })
    const project = await Project.create({ name: 'Audit token project', teamId: team.id })
    const owner = await createUser('token-owner-audit@example.com')
    await SecretSnapshot.create({
      projectId: project.id,
      environment: 'production',
      version: 1,
      ciphertext: 'c',
      iv: 'i',
      authTag: 't',
      createdBy: owner.id,
    })
    const verifier = 'v'.repeat(43)
    const token = await ProjectToken.create({
      name: 'ci',
      token: await hash.make(verifier),
      cryptoVersion: 2,
      projectId: project.id,
      environment: 'production',
      encryptedProjectKey: 'k',
      createdBy: owner.id,
    })

    const response = await client
      .get('/api/secrets/token')
      .header('Authorization', `Bearer v2.${token.id}.${verifier}`)
    response.assertStatus(200)
    const event = await AuditEvent.query().where('action', 'tokens.use').firstOrFail()
    assert.include(event.serialize(), {
      actorType: 'token',
      actorId: token.id,
      actorLabel: 'ci',
      environment: 'production',
    })
  })

  test('nothing secret is stored', async ({ client, assert }) => {
    const team = await Team.create({ name: 'Audit secret' })
    const project = await Project.create({ name: 'Audit secret project', teamId: team.id })
    const dev = await createUser('no-secret@example.com')
    await grantRole(dev, 'developer', { team })
    const push = await client
      .post('/api/secrets')
      .loginAs(dev)
      .json({
        projectId: project.id,
        environment: 'development',
        encryptedData: { ciphertext: 'SECRET_CIPHER', iv: 'i', authTag: 't' },
      })
    push.assertStatus(201)
    const event = await AuditEvent.query().where('action', 'secrets.push').firstOrFail()
    assert.notInclude(JSON.stringify(event.serialize()), 'SECRET_CIPHER')
  })
})
