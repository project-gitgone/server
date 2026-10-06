import { test } from '@japa/runner'
import { grantRole } from '#tests/helpers/rbac'
import { DateTime } from 'luxon'
import User from '#models/user'
import Team from '#models/team'
import Project from '#models/project'
import ProjectKey from '#models/project_key'

const AUTH_KEY = 'k'.repeat(43)
const NEW_AUTH_KEY = 'n'.repeat(43)
const KDF = { algo: 'scrypt', salt: 'c2FsdHNhbHRzYWx0c2FsdA==', N: 131072, r: 8, p: 1 }
const NEW_KDF = { ...KDF, salt: 'bmV3c2FsdG5ld3NhbHRuZQ==' }

const createV1User = (email: string) =>
  User.create({
    email,
    password: 'password123',
    fullName: 'V1 User',
    publicKey: 'pub',
    encryptedPrivateKey: 'v1_vault',
    keySalt: 'salt',
    keyEncryptionAlgo: 'aes-256-gcm',
  })

const createV2User = async (email: string, systemRole: 'USER' | 'SUPERADMIN' = 'USER') => {
  const user = await User.create({
    email,
    password: AUTH_KEY,
    fullName: 'V2 User',
    cryptoVersion: 2,
    kdfParams: KDF as any,
    publicKey: 'pub',
    encryptedPrivateKey: 'v2_vault',
  })
  await grantRole(user, systemRole === 'SUPERADMIN' ? 'owner' : 'member')
  return user
}

test.group('Accounts v2 - prelogin & login', () => {
  test('prelogin tells the client which protocol to use', async ({ client, assert }) => {
    await createV1User('prelogin_v1@example.com')
    await createV2User('prelogin_v2@example.com')

    const v1 = await client.post('/api/auth/prelogin').json({ email: 'prelogin_v1@example.com' })
    v1.assertStatus(200)
    assert.deepEqual(v1.body(), { cryptoVersion: 1 })

    const v2 = await client.post('/api/auth/prelogin').json({ email: 'prelogin_v2@example.com' })
    v2.assertStatus(200)
    assert.deepEqual(v2.body(), { cryptoVersion: 2, kdf: KDF })
  })

  test('prelogin returns stable decoy params for unknown emails', async ({ client, assert }) => {
    const first = await client.post('/api/auth/prelogin').json({ email: 'ghost@example.com' })
    const second = await client.post('/api/auth/prelogin').json({ email: 'ghost@example.com' })
    const other = await client.post('/api/auth/prelogin').json({ email: 'ghost2@example.com' })

    assert.equal(first.body().cryptoVersion, 2)
    assert.deepEqual(first.body(), second.body())
    assert.notEqual(first.body().kdf.salt, other.body().kdf.salt)
  })

  test('v2 account logs in with its authKey only', async ({ client }) => {
    await createV2User('login_v2@example.com')

    const ok = await client
      .post('/api/auth/login')
      .json({ email: 'login_v2@example.com', authKey: AUTH_KEY })
    ok.assertStatus(200)
    ok.assertBodyContains({ user: { cryptoVersion: 2, kdfParams: KDF } })

    const withPasswordField = await client
      .post('/api/auth/login')
      .json({ email: 'login_v2@example.com', password: AUTH_KEY })
    withPasswordField.assertStatus(401)
  })

  test('v1 account cannot log in with an authKey', async ({ client }) => {
    await createV1User('login_v1@example.com')

    const response = await client
      .post('/api/auth/login')
      .json({ email: 'login_v1@example.com', authKey: 'password123' })
    response.assertStatus(401)
  })
})

test.group('Accounts v2 - upgrade', () => {
  test('upgrades a v1 account and revokes its other sessions', async ({ client, assert }) => {
    const user = await createV1User('upgrade@example.com')
    await User.accessTokens.create(user)

    const response = await client.post('/api/auth/upgrade').loginAs(user).json({
      password: 'password123',
      authKey: AUTH_KEY,
      kdf: KDF,
      encryptedPrivateKey: 'v2_vault',
    })

    response.assertStatus(200)
    response.assertBodyContains({ user: { cryptoVersion: 2, encryptedPrivateKey: 'v2_vault' } })

    await user.refresh()
    assert.equal(user.cryptoVersion, 2)
    assert.isNull(user.keySalt)
    assert.lengthOf(await User.accessTokens.all(user), 1)

    const oldLogin = await client
      .post('/api/auth/login')
      .json({ email: 'upgrade@example.com', password: 'password123' })
    oldLogin.assertStatus(401)

    const newLogin = await client
      .post('/api/auth/login')
      .json({ email: 'upgrade@example.com', authKey: AUTH_KEY })
    newLogin.assertStatus(200)
  })

  test('upgrade requires the current password', async ({ client, assert }) => {
    const user = await createV1User('upgrade_wrong@example.com')

    const response = await client.post('/api/auth/upgrade').loginAs(user).json({
      password: 'not-the-password',
      authKey: AUTH_KEY,
      kdf: KDF,
      encryptedPrivateKey: 'v2_vault',
    })

    response.assertStatus(401)
    await user.refresh()
    assert.equal(user.cryptoVersion, 1)
  })

  test('upgrade rejects weak KDF parameters', async ({ client }) => {
    const user = await createV1User('upgrade_weak@example.com')

    const response = await client
      .post('/api/auth/upgrade')
      .loginAs(user)
      .json({
        password: 'password123',
        authKey: AUTH_KEY,
        kdf: { ...KDF, N: 1024 },
        encryptedPrivateKey: 'v2_vault',
      })

    response.assertStatus(422)
  })
})

test.group('Accounts v2 - password change', () => {
  test('changes the password with the current authKey', async ({ client, assert }) => {
    const user = await createV2User('passwd@example.com')

    const wrong = await client.post('/api/auth/password').loginAs(user).json({
      currentAuthKey: NEW_AUTH_KEY,
      authKey: NEW_AUTH_KEY,
      kdf: NEW_KDF,
      encryptedPrivateKey: 'new_vault',
    })
    wrong.assertStatus(401)

    const response = await client.post('/api/auth/password').loginAs(user).json({
      currentAuthKey: AUTH_KEY,
      authKey: NEW_AUTH_KEY,
      kdf: NEW_KDF,
      encryptedPrivateKey: 'new_vault',
    })
    response.assertStatus(200)

    await user.refresh()
    assert.deepEqual(user.kdfParams, NEW_KDF as any)
    assert.equal(user.encryptedPrivateKey, 'new_vault')

    const login = await client
      .post('/api/auth/login')
      .json({ email: 'passwd@example.com', authKey: NEW_AUTH_KEY })
    login.assertStatus(200)
  })
})

test.group('Accounts v2 - invitations', () => {
  test('admin invites a user who activates with their own keys', async ({ client, assert }) => {
    const admin = await createV2User('invite_admin@example.com', 'SUPERADMIN')

    const invite = await client
      .post('/api/users')
      .loginAs(admin)
      .json({ email: 'invitee@example.com', fullName: 'Invitee' })

    invite.assertStatus(201)
    const { activationCode } = invite.body()
    assert.isString(activationCode)
    assert.notProperty(invite.body().user, 'activationCode')

    const cannotLogin = await client
      .post('/api/auth/login')
      .json({ email: 'invitee@example.com', authKey: AUTH_KEY })
    cannotLogin.assertStatus(401)

    const activation = {
      email: 'invitee@example.com',
      code: activationCode,
      authKey: AUTH_KEY,
      kdf: KDF,
      publicKey: 'invitee_pub',
      encryptedPrivateKey: 'invitee_vault',
    }

    const activated = await client.post('/api/auth/activate').json(activation)
    activated.assertStatus(200)
    assert.properties(activated.body(), ['token', 'user'])
    activated.assertBodyContains({ user: { publicKey: 'invitee_pub', cryptoVersion: 2 } })

    const reused = await client.post('/api/auth/activate').json(activation)
    reused.assertStatus(400)

    const login = await client
      .post('/api/auth/login')
      .json({ email: 'invitee@example.com', authKey: AUTH_KEY })
    login.assertStatus(200)
  })

  test('activation fails with a wrong or expired code', async ({ client }) => {
    const user = new User()
    user.merge({ email: 'expired@example.com', fullName: 'Expired', cryptoVersion: 2 })
    const code = await user.issueActivationCode()
    await user.save()

    const activation = {
      email: 'expired@example.com',
      authKey: AUTH_KEY,
      kdf: KDF,
      publicKey: 'pub',
      encryptedPrivateKey: 'vault',
    }

    const wrong = await client.post('/api/auth/activate').json({ ...activation, code: 'wrong' })
    wrong.assertStatus(400)

    user.activationExpiresAt = DateTime.now().minus({ minutes: 1 })
    await user.save()

    const expired = await client.post('/api/auth/activate').json({ ...activation, code })
    expired.assertStatus(400)
  })
})

test.group('Accounts v2 - credentials reset', () => {
  test('admin reset wipes keys, project access and sessions', async ({ client, assert }) => {
    const admin = await createV2User('reset_admin@example.com', 'SUPERADMIN')
    const user = await createV2User('reset_target@example.com')
    await User.accessTokens.create(user)

    const team = await Team.create({ name: 'Reset Team' })
    await grantRole(user, 'developer', { team })
    const project = await Project.create({ name: 'Reset Project', teamId: team.id })
    await ProjectKey.create({ projectId: project.id, userId: user.id, encryptedKey: 'k' })

    const response = await client.post(`/api/users/${user.id}/reset-credentials`).loginAs(admin)

    response.assertStatus(200)
    assert.isString(response.body().activationCode)

    await user.refresh()
    assert.isNull(user.publicKey)
    assert.isNull(user.encryptedPrivateKey)
    assert.isNull(user.password)
    assert.lengthOf(await User.accessTokens.all(user), 0)
    assert.isNull(await ProjectKey.query().where('user_id', user.id).first())

    const activated = await client.post('/api/auth/activate').json({
      email: 'reset_target@example.com',
      code: response.body().activationCode,
      authKey: NEW_AUTH_KEY,
      kdf: NEW_KDF,
      publicKey: 'new_pub',
      encryptedPrivateKey: 'new_vault',
    })
    activated.assertStatus(200)
  })

  test('non-admin cannot reset credentials', async ({ client }) => {
    const user = await createV2User('reset_user@example.com')
    const other = await createV2User('reset_other@example.com')

    const response = await client.post(`/api/users/${other.id}/reset-credentials`).loginAs(user)

    response.assertStatus(403)
  })
})
