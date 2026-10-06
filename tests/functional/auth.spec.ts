import { test } from '@japa/runner'
import User from '#models/user'
import { DateTime } from 'luxon'

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
    await User.create({
      email: 'existing@example.com',
      password: 'password123',
      fullName: 'Existing Admin',
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
      keySalt: 'salt',
      keyEncryptionAlgo: 'aes-256-gcm',
    })

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
