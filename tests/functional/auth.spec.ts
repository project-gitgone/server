import { test } from '@japa/runner'
import User from '#models/user'

test.group('Auth', () => {
  test('initialize admin successfully', async ({ client, assert }) => {
    const payload = {
      email: 'admin@example.com',
      password: 'password123',
      fullName: 'Super Admin',
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
      keySalt: 'salt',
      keyEncryptionAlgo: 'aes-256-gcm',
    }

    const response = await client.post('/api/setup/init-admin').json(payload)

    response.assertStatus(201)
    response.assertBodyContains({
      message: 'Admin initialized successfully',
      user: {
        email: 'admin@example.com',
        full_name: 'Super Admin',
      }
    })

    const user = await User.findByOrFail('email', 'admin@example.com')
    assert.equal(user.email, 'admin@example.com')
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
      systemRole: 'SUPERADMIN',
    })

    const payload = {
      email: 'admin2@example.com',
      password: 'password123',
      fullName: 'Admin 2',
      publicKey: 'abc',
      encryptedPrivateKey: 'def',
      keySalt: 'salt',
      keyEncryptionAlgo: 'aes-256-gcm',
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
      }
    })
    assert.properties(response.body(), ['token', 'user'])
  })
})
