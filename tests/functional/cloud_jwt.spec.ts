import { test } from '@japa/runner'
import { verifyCloudToken } from '#services/cloud_jwt'
import { disableCloud, enableCloud, signCloudToken, stopCloud } from '#tests/helpers/cloud'

test.group('Cloud trust', (group) => {
  group.each.teardown(() => disableCloud())
  group.teardown(() => stopCloud())

  test('capabilities announce cloud only when configured', async ({ client, assert }) => {
    const selfHosted = await client.get('/api/capabilities')
    selfHosted.assertStatus(200)
    assert.includeMembers(selfHosted.body().features, [
      'rbac',
      'environments',
      'audit',
      'environment-keys',
    ])
    assert.notInclude(selfHosted.body().features, 'cloud')
    assert.isString(selfHosted.body().version)

    await enableCloud()
    const cloud = await client.get('/api/capabilities')
    assert.include(cloud.body().features, 'cloud')
  })

  test('a valid token is accepted', async ({ assert }) => {
    await enableCloud()
    const payload = await verifyCloudToken(signCloudToken({ sub: 'cloud_user_42' }))
    assert.equal(payload.sub, 'cloud_user_42')
  })

  test('invalid tokens are refused', async ({ assert }) => {
    await enableCloud()
    const now = Math.floor(Date.now() / 1000)
    const invalid = [
      signCloudToken({ exp: now - 120 }),
      signCloudToken({ aud: 'another_instance' }),
      signCloudToken({ iss: 'https://evil.test' }),
      signCloudToken({}, { key: 'stray', kid: 'unknown-key' }),
      signCloudToken({}, { key: 'stray' }),
      signCloudToken({ exp: now + 3600 }),
      signCloudToken({ nbf: now + 120 }),
      signCloudToken({}, { tamper: true }),
      signCloudToken({ token_use: undefined }),
      signCloudToken({ token_use: 'id_token' }),
      signCloudToken({ iat: undefined }),
      signCloudToken({ iat: now - 3000, exp: now + 100 }),
      signCloudToken({ aud: ['org_test', 'another_instance'] }),
      'not.a.token',
    ]
    const accepted: number[] = []
    for (const [index, token] of invalid.entries()) {
      try {
        await verifyCloudToken(token)
        accepted.push(index)
      } catch {}
    }
    assert.deepEqual(accepted, [])
  })
})
