import { test } from '@japa/runner'
import User from '#models/user'
import Team from '#models/team'
import Project from '#models/project'

test.group('Project Keys', () => {
  test('upload public key successfully', async ({ client, assert }) => {
    const user = await User.create({
      email: 'key_user@example.com',
      password: 'password123',
      fullName: 'Key User',
    })

    const response = await client
      .post('/api/keys/upload-public-key')
      .loginAs(user)
      .json({
        publicKey: 'user_public_key',
        encryptedPrivateKey: 'user_encrypted_private_key',
        keySalt: 'salt',
        keyEncryptionAlgo: 'aes-256-gcm',
      })

    response.assertStatus(200)

    await user.refresh()
    assert.equal(user.publicKey, 'user_public_key')
    assert.equal(user.encryptedPrivateKey, 'user_encrypted_private_key')
  })

  test('get vault returns encrypted private key', async ({ client }) => {
    const user = await User.create({
      email: 'vault_user@example.com',
      password: 'password123',
      fullName: 'Vault User',
      encryptedPrivateKey: 'vault_encrypted_private_key',
      keySalt: 'vault_salt',
      keyEncryptionAlgo: 'aes-256-gcm',
    })

    const response = await client
      .get('/api/keys/vault')
      .loginAs(user)

    response.assertStatus(200)
    response.assertBodyContains({
      encryptedPrivateKey: 'vault_encrypted_private_key',
      keySalt: 'vault_salt',
    })
  })

  test('setup and share project keys', async ({ client, assert }) => {
    const owner = await User.create({
      email: 'owner@example.com',
      password: 'password123',
      fullName: 'Owner',
      publicKey: 'owner_pub',
    })

    const otherUser = await User.create({
      email: 'other@example.com',
      password: 'password123',
      fullName: 'Other User',
      publicKey: 'other_pub',
    })

    const team = await Team.create({ name: 'Key Sharing Team' })
    await team.related('members').createMany([
      { userId: owner.id, role: 'OWNER' },
      { userId: otherUser.id, role: 'MEMBER' },
    ])

    const project = await Project.create({
      name: 'Key Project',
      teamId: team.id,
    })

    const setupResponse = await client
      .post(`/api/keys/${project.id}/setup`)
      .loginAs(owner)
      .json({ encryptedKey: 'owner_encrypted_project_key' })

    setupResponse.assertStatus(200)

    const pendingResponse = await client
      .get(`/api/keys/${project.id}/pending`)
      .loginAs(owner)

    pendingResponse.assertStatus(200)
    assert.lengthOf(pendingResponse.body(), 1)
    assert.equal(pendingResponse.body()[0].id, otherUser.id)

    const shareResponse = await client
      .post(`/api/keys/${project.id}/share`)
      .loginAs(owner)
      .json({
        targetUserId: otherUser.id,
        encryptedKey: 'other_encrypted_project_key',
      })

    shareResponse.assertStatus(200)

    const getResponse = await client
      .get(`/api/keys/${project.id}`)
      .loginAs(otherUser)

    getResponse.assertStatus(200)
    getResponse.assertBodyContains({
      encryptedKey: 'other_encrypted_project_key'
    })
  })

  test('cannot retrieve project key if not shared', async ({ client }) => {
    const user = await User.create({
      email: 'no_key@example.com',
      password: 'password123',
      fullName: 'No Key User',
    })

    const team = await Team.create({ name: 'No Key Team' })
    await team.related('members').create({ userId: user.id, role: 'MEMBER' })

    const project = await Project.create({
      name: 'No Key Project',
      teamId: team.id,
    })

    const response = await client
      .get(`/api/keys/${project.id}`)
      .loginAs(user)

    response.assertStatus(404)
    response.assertBodyContains({ message: 'No project key found for you. Ask the admin to re-invite you or rotate keys.' })
  })
})
