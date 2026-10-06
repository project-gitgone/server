import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Team from '#models/team'
import Project from '#models/project'
import Environment from '#models/environment'
import EnvironmentKey from '#models/environment_key'
import AuditEvent from '#models/audit_event'
import User from '#models/user'
import UserIdentity from '#models/user_identity'
import { createUser, grantRole } from '#tests/helpers/rbac'
import { disableCloud, enableCloud, signCloudToken, stopCloud } from '#tests/helpers/cloud'

const service = (scope: string | undefined = 'membership.sync') =>
  `Bearer ${signCloudToken({ sub: 'cloud:service', ...(scope ? { scope } : {}) })}`

test.group('Cloud membership sync', (group) => {
  group.each.teardown(() => disableCloud())
  group.teardown(() => stopCloud())

  test('disabling a member removes their access, enabling restores the account', async ({
    client,
    assert,
  }) => {
    await enableCloud()
    const team = await Team.create({ name: 'Synced team' })
    const project = await Project.create({ name: 'Synced project', teamId: team.id })
    const user = await createUser('synced@example.com')
    await grantRole(user, 'developer', { team })
    await UserIdentity.create({
      provider: 'gitgone-cloud',
      subject: 'cloud_member',
      userId: user.id,
    })
    const qa = await Environment.create({
      projectId: project.id,
      name: 'qa',
      protected: false,
      keyVersion: 1,
    })
    await EnvironmentKey.create({ environmentId: qa.id, userId: user.id, encryptedKey: 'k' })
    await User.accessTokens.create(user)

    const disabled = await client
      .post('/api/manage/v1/service/identities/cloud_member/disable')
      .header('Authorization', service())
    disabled.assertStatus(200)
    await user.refresh()
    assert.isNotNull(user.deletedAt)
    assert.lengthOf(await User.accessTokens.all(user), 0)
    assert.isNull(await EnvironmentKey.query().where('user_id', user.id).first())
    await qa.refresh()
    assert.isTrue(qa.rotationRequired)
    const event = await AuditEvent.query().where('action', 'users.delete').firstOrFail()
    assert.include(event.serialize(), {
      actorType: 'token',
      actorId: 'cloud:service',
      actorLabel: 'GitGone Cloud',
    })

    const enabled = await client
      .post('/api/manage/v1/service/identities/cloud_member/enable')
      .header('Authorization', service())
    enabled.assertStatus(200)
    await user.refresh()
    assert.isNull(user.deletedAt)
  })

  test('only a service token with the membership.sync scope may sync', async ({ client }) => {
    await enableCloud()
    const user = await createUser('sync-guard@example.com')
    await UserIdentity.create({
      provider: 'gitgone-cloud',
      subject: 'cloud_guarded',
      userId: user.id,
    })
    const url = '/api/manage/v1/service/identities/cloud_guarded/disable'

    const noScope = await client.post(url).header('Authorization', service(''))
    noScope.assertStatus(403)
    const userToken = await client
      .post(url)
      .header(
        'Authorization',
        `Bearer ${signCloudToken({ sub: 'cloud_guarded', scope: 'membership.sync' })}`
      )
    userToken.assertStatus(403)
    const unknown = await client
      .post('/api/manage/v1/service/identities/cloud_nobody/disable')
      .header('Authorization', service())
    unknown.assertStatus(404)
  })

  test('the sync endpoints do not exist on a self-hosted instance', async ({ client }) => {
    const response = await client
      .post('/api/manage/v1/service/identities/anyone/disable')
      .header('Authorization', service())
    response.assertStatus(404)
  })

  test('the last active owner cannot be disabled, and enable only restores cloud-disabled accounts', async ({
    client,
    assert,
  }) => {
    await enableCloud()
    const owner = await createUser('only-owner@example.com')
    await grantRole(owner, 'owner')
    await UserIdentity.create({
      provider: 'gitgone-cloud',
      subject: 'cloud_owner',
      userId: owner.id,
    })
    const refused = await client
      .post('/api/manage/v1/service/identities/cloud_owner/disable')
      .header('Authorization', service())
    refused.assertStatus(422)

    const banned = await createUser('banned@example.com')
    await UserIdentity.create({
      provider: 'gitgone-cloud',
      subject: 'cloud_banned',
      userId: banned.id,
    })
    banned.deletedAt = DateTime.now()
    await banned.save()
    const restored = await client
      .post('/api/manage/v1/service/identities/cloud_banned/enable')
      .header('Authorization', service())
    restored.assertStatus(409)
    await banned.refresh()
    assert.isNotNull(banned.deletedAt)
  })

  test('linking creates the instance account of a member once, with the login rules', async ({
    client,
    assert,
  }) => {
    await enableCloud()
    const url = '/api/manage/v1/service/identities/cloud_console/link'
    const body = {
      email: 'console@example.com',
      name: 'Console',
      emailVerified: true,
      role: 'member',
    }

    const created = await client.post(url).header('Authorization', service()).json(body)
    created.assertStatus(200)
    const again = await client.post(url).header('Authorization', service()).json(body)
    assert.equal(again.body().userId, created.body().userId)
    assert.lengthOf(
      await AuditEvent.query()
        .where('action', 'users.create')
        .where('target_id', created.body().userId),
      1
    )

    const parallel = await Promise.all(
      ['a', 'b', 'c'].map(() =>
        client
          .post('/api/manage/v1/service/identities/cloud_parallel/link')
          .header('Authorization', service())
          .json({ ...body, email: 'parallel@example.com' })
      )
    )
    parallel.forEach((response) => response.assertStatus(200))
    assert.lengthOf(new Set(parallel.map((response) => response.body().userId)), 1)

    await createUser('taken@example.com')
    const takeover = await client
      .post('/api/manage/v1/service/identities/cloud_taker/link')
      .header('Authorization', service())
      .json({ ...body, email: 'taken@example.com', emailVerified: false })
    takeover.assertStatus(403)

    const userToken = await client
      .post(url)
      .header('Authorization', `Bearer ${signCloudToken({ sub: 'cloud_console' })}`)
      .json(body)
    userToken.assertStatus(403)
  })
})
