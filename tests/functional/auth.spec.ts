import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import User from '#models/user'
import { DateTime } from 'luxon'
import RoleAssignment from '#models/role_assignment'
import { createUser, grantRole } from '#tests/helpers/rbac'
import { disableCloud, enableCloud, stopCloud } from '#tests/helpers/cloud'

const AUTH_KEY = 'k'.repeat(43)
const KDF = { algo: 'scrypt', salt: 'c2FsdHNhbHRzYWx0c2FsdA==', N: 131072, r: 8, p: 1 }

test.group('Auth', () => {
  test('initialize admin successfully', async ({ client, assert }) => {
    const payload = {
      email: 'admin@example.com',
      fullName: 'Super Admin',
      authKey: AUTH_KEY,
      kdf: KDF,
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
    }

    const response = await client.post('/api/setup/init-admin').json(payload)

    response.assertStatus(201)
    response.assertBodyContains({
      message: 'Admin initialized successfully',
      user: {
        email: 'admin@example.com',
        full_name: 'Super Admin',
      },
    })

    const user = await User.findByOrFail('email', 'admin@example.com')
    assert.equal(user.cryptoVersion, 2)
    assert.deepEqual(user.kdfParams, KDF)

    const login = await client.post('/api/auth/login').json({
      email: 'admin@example.com',
      authKey: AUTH_KEY,
    })
    login.assertStatus(200)
  })

  test('cannot initialize admin twice', async ({ client }) => {
    const existing = await User.create({
      email: 'existing@example.com',
      password: 'password123',
      fullName: 'Existing Admin',
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
      keySalt: 'salt',
      keyEncryptionAlgo: 'aes-256-gcm',
    })
    await grantRole(existing, 'owner')

    const payload = {
      email: 'admin2@example.com',
      fullName: 'Admin 2',
      authKey: AUTH_KEY,
      kdf: KDF,
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
    }

    const response = await client.post('/api/setup/init-admin').json(payload)

    response.assertStatus(403)
    response.assertBodyContains({ message: 'Server is already initialized' })
  })

  test('login successfully', async ({ client, assert }) => {
    await User.create({
      email: 'user@example.com',
      password: 'password123',
      fullName: 'Test User',
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
      keySalt: 'salt',
      keyEncryptionAlgo: 'aes-256-gcm',
    })

    const response = await client.post('/api/auth/login').json({
      email: 'user@example.com',
      password: 'password123',
    })

    response.assertStatus(200)
    response.assertBodyContains({
      user: {
        email: 'user@example.com',
      },
    })
    assert.properties(response.body(), ['token', 'user'])
  })

  test('deleted user cannot login', async ({ client }) => {
    await User.create({
      email: 'deleted@example.com',
      password: 'password123',
      fullName: 'Deleted User',
      deletedAt: DateTime.now(),
    })

    const response = await client.post('/api/auth/login').json({
      email: 'deleted@example.com',
      password: 'password123',
    })

    response.assertStatus(401)
  })

  test('deleted user token is rejected', async ({ client }) => {
    const user = await User.create({
      email: 'deleted_token@example.com',
      password: 'password123',
      fullName: 'Deleted Token User',
      deletedAt: DateTime.now(),
    })

    const response = await client.get('/api/auth/me').loginAs(user)

    response.assertStatus(401)
  })
})

const ADMIN_PAYLOAD = {
  email: 'setup@example.com',
  fullName: 'Setup Admin',
  authKey: AUTH_KEY,
  kdf: KDF,
  publicKey: 'abc',
  encryptedPrivateKey: 'def',
}

const isInitialized = async (client: ApiClient) => {
  const response = await client.get('/healthcheck')
  return response.body().initialized as boolean
}

test.group('Instance setup', () => {
  test('a member who signed in before the setup does not block it', async ({ client, assert }) => {
    const early = await createUser('early@example.com')
    await grantRole(early, 'member')

    const response = await client.post('/api/setup/init-admin').json(ADMIN_PAYLOAD)

    response.assertStatus(201)
    const admin = await User.findByOrFail('email', 'setup@example.com')
    const role = await RoleAssignment.query().where('user_id', admin.id).firstOrFail()
    assert.equal(role.roleId, 'role_owner')
  })

  test('the instance is initialized only once it has an owner', async ({ client, assert }) => {
    const member = await createUser('member@example.com')
    await grantRole(member, 'member')
    assert.isFalse(await isInitialized(client))

    const owner = await createUser('owner@example.com')
    await grantRole(owner, 'owner')
    assert.isTrue(await isInitialized(client))
  })

  test('a deactivated owner does not count', async ({ client, assert }) => {
    const owner = await createUser('gone@example.com')
    await grantRole(owner, 'owner')
    owner.deletedAt = DateTime.now()
    await owner.save()

    assert.isFalse(await isInitialized(client))
    const response = await client.post('/api/setup/init-admin').json(ADMIN_PAYLOAD)
    response.assertStatus(201)
  })
})

test.group('Instance setup on a cloud instance', (group) => {
  group.each.setup(() => enableCloud())
  group.each.teardown(() => disableCloud())
  group.teardown(() => stopCloud())

  test('the password setup is closed: the cloud designates the administrator', async ({
    client,
    assert,
  }) => {
    const response = await client.post('/api/setup/init-admin').json(ADMIN_PAYLOAD)

    response.assertStatus(403)
    assert.isNull(await User.findBy('email', 'setup@example.com'))
  })
})
