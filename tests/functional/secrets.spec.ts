
import { test } from '@japa/runner'
import User from '#models/user'
import Team from '#models/team'
import Project from '#models/project'

test.group('Secrets', () => {
  test('push a secret successfully', async ({ client }) => {
    const user = await User.create({
      email: 'secret_owner@example.com',
      password: 'password123',
      fullName: 'Secret Owner',
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
      keySalt: 'salt',
      keyEncryptionAlgo: 'aes-256-gcm',
    })

    const team = await Team.create({ name: 'Secret Team' })
    await team.related('members').create({
      userId: user.id,
      role: 'OWNER',
    })

    const project = await Project.create({
      name: 'Secret Project',
      teamId: team.id,
    })

    const response = await client
      .post('/api/secrets')
      .loginAs(user)
      .json({
        projectId: project.id,
        environment: 'production',
        encryptedData: {
          ciphertext: 'secret_data',
          iv: 'iv',
          authTag: 'tag',
        },
      })

    response.assertStatus(201)
    response.assertBodyContains({
      projectId: project.id,
      environment: 'production',
      version: 1,
    })
  })

  test('retrieve latest secret', async ({ client }) => {
    const user = await User.create({
      email: 'secret_reader@example.com',
      password: 'password123',
      fullName: 'Secret Reader',
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
      keySalt: 'salt',
      keyEncryptionAlgo: 'aes-256-gcm',
    })

    const team = await Team.create({ name: 'Reader Team' })
    await team.related('members').create({
      userId: user.id,
      role: 'MEMBER',
    })

    const project = await Project.create({
      name: 'Reader Project',
      teamId: team.id,
    })

    await project.related('snapshots').create({
      environment: 'staging',
      version: 1,
      ciphertext: 'old_secret',
      iv: 'iv1',
      authTag: 'tag1',
      createdBy: user.id,
    })

    await project.related('snapshots').create({
      environment: 'staging',
      version: 2,
      ciphertext: 'new_secret',
      iv: 'iv2',
      authTag: 'tag2',
      createdBy: user.id,
    })

    const response = await client
      .get('/api/secrets/latest')
      .loginAs(user)
      .qs({ projectId: project.id, env: 'staging' })

    response.assertStatus(200)
    response.assertBodyContains({
      ciphertext: 'new_secret',
      version: 2,
    })
  })

  test('cannot push secret to project without access', async ({ client }) => {
    const user = await User.create({
      email: 'no_access@example.com',
      password: 'password123',
      fullName: 'No Access',
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
      keySalt: 'salt',
      keyEncryptionAlgo: 'aes-256-gcm',
    })

    const team = await Team.create({ name: 'Other Team' })
    const project = await Project.create({
      name: 'Other Project',
      teamId: team.id,
    })

    const response = await client
      .post('/api/secrets')
      .loginAs(user)
      .json({
        projectId: project.id,
        environment: 'production',
        encryptedData: {
          ciphertext: 'hack',
          iv: 'iv',
          authTag: 'tag',
        },
      })

    response.assertStatus(403)
  })
})
