import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import User from '#models/user'
import UserIdentity from '#models/user_identity'
import LoginCode from '#models/login_code'
import RoleAssignment from '#models/role_assignment'
import {
  completeCloudLogin,
  issueLoginCode,
  redeemLoginCode,
  type CloudProfile,
} from '#services/cloud_login'
import { createUser } from '#tests/helpers/rbac'
import { CLOUD_INSTANCE_ID, disableCloud, enableCloud, stopCloud } from '#tests/helpers/cloud'

const profile = (overrides: Partial<CloudProfile> = {}): CloudProfile => ({
  subject: 'cloud_user_login',
  email: 'login@example.com',
  name: 'Login User',
  emailVerified: true,
  organization: CLOUD_INSTANCE_ID,
  role: 'member',
  ...overrides,
})

const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')
const VERIFIER = 'v'.repeat(50)

test.group('Cloud login', (group) => {
  group.each.setup(() => enableCloud())
  group.each.teardown(() => disableCloud())
  group.teardown(() => stopCloud())

  test('non-members and members of another organization are refused', async ({ assert }) => {
    await assert.rejects(() => completeCloudLogin(profile({ role: null })))
    await assert.rejects(() => completeCloudLogin(profile({ organization: 'org_other' })))
  })

  test('a new member gets an account, then the same one on the next login', async ({ assert }) => {
    const user = await completeCloudLogin(profile())
    const again = await completeCloudLogin(profile({ name: 'Renamed' }))
    assert.equal(again.id, user.id)
    assert.equal(user.email, 'login@example.com')
    const stored = await User.findOrFail(user.id)
    assert.isNull(stored.password)
    const identity = await UserIdentity.query().where('subject', 'cloud_user_login').firstOrFail()
    assert.equal(identity.userId, user.id)
    const role = await RoleAssignment.query().where('user_id', user.id).firstOrFail()
    assert.equal(role.roleId, 'role_member')
  })

  test('an unverified cloud email neither creates nor links an account', async ({ assert }) => {
    await assert.rejects(() =>
      completeCloudLogin(
        profile({
          subject: 'cloud_unverified',
          email: 'unverified@example.com',
          emailVerified: false,
        })
      )
    )
    assert.isNull(await User.findBy('email', 'unverified@example.com'))
  })

  test('the cloud role decides the instance role of a new account', async ({ assert }) => {
    const owner = await completeCloudLogin(
      profile({ subject: 'cloud_owner', email: 'owner@example.com', role: 'owner' })
    )
    const admin = await completeCloudLogin(
      profile({ subject: 'cloud_admin', email: 'admin@example.com', role: 'admin' })
    )
    const ownerRole = await RoleAssignment.query().where('user_id', owner.id).firstOrFail()
    const adminRole = await RoleAssignment.query().where('user_id', admin.id).firstOrFail()
    assert.equal(ownerRole.roleId, 'role_owner')
    assert.equal(adminRole.roleId, 'role_admin')
  })

  test('a cloud instance refuses the password setup of a first admin', async ({ client }) => {
    const response = await client.post('/api/setup/init-admin').json({})
    response.assertStatus(409)
  })

  test('a local account is linked only when the cloud email is verified', async ({ assert }) => {
    const local = await createUser('existing@example.com')
    await assert.rejects(() =>
      completeCloudLogin(
        profile({ subject: 'cloud_existing', email: 'existing@example.com', emailVerified: false })
      )
    )
    const linked = await completeCloudLogin(
      profile({ subject: 'cloud_existing', email: 'existing@example.com', emailVerified: true })
    )
    assert.equal(linked.id, local.id)
  })

  test('a deactivated account cannot log in', async ({ assert }) => {
    const user = await completeCloudLogin(
      profile({ subject: 'cloud_gone', email: 'gone@example.com' })
    )
    user.deletedAt = DateTime.now()
    await user.save()
    await assert.rejects(() =>
      completeCloudLogin(profile({ subject: 'cloud_gone', email: 'gone@example.com' }))
    )
  })

  test('a login code works once, before expiry, with the right verifier', async ({ assert }) => {
    const user = await createUser('code@example.com')
    const code = await issueLoginCode(user, challengeOf(VERIFIER))
    await assert.rejects(() => redeemLoginCode(code, 'w'.repeat(50)))
    const redeemed = await redeemLoginCode(code, VERIFIER)
    assert.equal(redeemed.id, user.id)
    await assert.rejects(() => redeemLoginCode(code, VERIFIER))

    const expired = await issueLoginCode(user, challengeOf(VERIFIER))
    await LoginCode.query().update({ expires_at: DateTime.now().minus({ minutes: 1 }).toSQL() })
    await assert.rejects(() => redeemLoginCode(expired, VERIFIER))
  })

  test('the login route redirects to the cloud with PKCE and validates its input', async ({
    client,
    assert,
  }) => {
    const challenge = challengeOf(VERIFIER)
    const bad = await client
      .get(`/auth/cloud/login?port=80&state=abc12345&code_challenge=${challenge}`)
      .redirects(0)
    bad.assertStatus(422)

    const response = await client
      .get(`/auth/cloud/login?port=54321&state=abc12345&code_challenge=${challenge}`)
      .redirects(0)
    response.assertStatus(302)
    const location = new URL(response.header('location')!)
    assert.equal(location.pathname, '/api/auth/oauth2/authorize')
    assert.equal(location.searchParams.get('client_id'), 'client_test')
    assert.equal(
      location.searchParams.get('redirect_uri'),
      'https://instance.test/auth/cloud/callback'
    )
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256')
    assert.isString(location.searchParams.get('code_challenge'))
    assert.notEqual(location.searchParams.get('code_challenge'), challenge)
  })

  test('the callback needs the CLI request and sends refusals back to the CLI only', async ({
    client,
    assert,
  }) => {
    const missing = await client.get('/auth/cloud/callback?code=x&state=y').redirects(0)
    missing.assertStatus(400)

    const cli = { port: 54321, state: 'abc12345', codeChallenge: challengeOf(VERIFIER) }
    const mismatch = await client
      .get('/auth/cloud/callback?code=x&state=forged')
      .withEncryptedCookie('gitgone_cli_login', cli)
      .redirects(0)
    mismatch.assertStatus(302)
    const location = new URL(mismatch.header('location')!)
    assert.equal(location.origin, 'http://127.0.0.1:54321')
    assert.equal(location.searchParams.get('error'), 'access_denied')
    assert.equal(location.searchParams.get('state'), 'abc12345')
    assert.isNull(location.searchParams.get('code'))
  })

  test('cloud login is advertised only when the instance has its client', async ({
    client,
    assert,
  }) => {
    const enabled = await client.get('/api/capabilities')
    assert.includeMembers(enabled.body().features, ['cloud', 'cloud-login'])
    disableCloud()
    const disabled = await client.get('/api/capabilities')
    assert.notInclude(disabled.body().features, 'cloud-login')
  })

  test('linking matches the email whatever its case', async ({ assert }) => {
    const local = await createUser('Mixed.Case@example.com')
    const linked = await completeCloudLogin(
      profile({ subject: 'cloud_case', email: 'mixed.case@example.com', emailVerified: true })
    )
    assert.equal(linked.id, local.id)
  })

  test('the login route does not exist on a self-hosted instance', async ({ client }) => {
    disableCloud()
    const response = await client
      .get(`/auth/cloud/login?port=54321&state=abc12345&code_challenge=${challengeOf(VERIFIER)}`)
      .redirects(0)
    response.assertStatus(404)
  })

  test('the CLI exchanges a login code for a session', async ({ client, assert }) => {
    const user = await createUser('exchange@example.com')
    const code = await issueLoginCode(user, challengeOf(VERIFIER))
    const response = await client
      .post('/api/auth/cloud/exchange')
      .json({ code, codeVerifier: VERIFIER })
    response.assertStatus(200)
    assert.equal(response.body().user.email, 'exchange@example.com')
    assert.isString(response.body().token.token)
    const replay = await client
      .post('/api/auth/cloud/exchange')
      .json({ code, codeVerifier: VERIFIER })
    replay.assertStatus(400)
  })

  test('an SSO account sets its unlock phrase vault once', async ({ client, assert }) => {
    const user = await completeCloudLogin(
      profile({ subject: 'cloud_vault', email: 'vault@example.com' })
    )
    const kdf = { algo: 'scrypt', salt: 'c2FsdHNhbHRzYWx0c2FsdA==', N: 131072, r: 8, p: 1 }
    const upload = await client
      .post('/api/keys/upload-public-key')
      .loginAs(user)
      .json({ publicKey: 'pub', encryptedPrivateKey: 'vault', kdf })
    upload.assertStatus(200)
    const stored = await User.findOrFail(user.id)
    assert.equal(stored.cryptoVersion, 2)
    assert.deepEqual(stored.kdfParams, kdf)

    const again = await client
      .post('/api/keys/upload-public-key')
      .loginAs(user)
      .json({ publicKey: 'pub2', encryptedPrivateKey: 'vault2', kdf })
    again.assertStatus(409)
  })
})
