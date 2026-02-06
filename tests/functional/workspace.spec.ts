import { test } from '@japa/runner'
import User from '#models/user'
import Team from '#models/team'

test.group('Workspace', () => {
  test('create a team successfully', async ({ client, assert }) => {
    const user = await User.create({
      email: 'owner@example.com',
      password: 'password123',
      fullName: 'Team Owner',
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
      keySalt: 'salt',
      keyEncryptionAlgo: 'aes-256-gcm',
    })

    const response = await client
      .post('/api/teams')
      .loginAs(user)
      .json({ name: 'My New Team' })

    response.assertStatus(201)
    response.assertBodyContains({ name: 'My New Team' })

    const team = await Team.findByOrFail('name', 'My New Team')
    assert.equal(team.name, 'My New Team')

    await team.load('members')
    const member = team.members.find((m) => m.userId === user.id)
    assert.exists(member)
    assert.equal(member!.role, 'OWNER')
  })

  test('create a project in a team', async ({ client }) => {
    const user = await User.create({
      email: 'owner2@example.com',
      password: 'password123',
      fullName: 'Team Owner 2',
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
      keySalt: 'salt',
      keyEncryptionAlgo: 'aes-256-gcm',
    })

    const team = await Team.create({ name: 'Team for Project' })
    await team.related('members').create({
      userId: user.id,
      role: 'OWNER',
    })

    const response = await client
      .post(`/api/teams/${team.id}/projects`)
      .loginAs(user)
      .json({ name: 'My Project' })

    response.assertStatus(201)
    response.assertBodyContains({ name: 'My Project', teamId: team.id })
  })

  test('cannot create a project in a team if not a member', async ({ client }) => {
    const user = await User.create({
      email: 'notmember@example.com',
      password: 'password123',
      fullName: 'Not Member',
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
      keySalt: 'salt',
      keyEncryptionAlgo: 'aes-256-gcm',
    })

    const team = await Team.create({ name: 'Private Team' })

    const response = await client
      .post(`/api/teams/${team.id}/projects`)
      .loginAs(user)
      .json({ name: 'Hack Project' })

    response.assertStatus(403)
  })
})
