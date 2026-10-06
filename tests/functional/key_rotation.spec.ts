import { test } from '@japa/runner'
import { grantRole } from '#tests/helpers/rbac'
import env from '#start/env'
import User from '#models/user'
import Team from '#models/team'
import Project from '#models/project'
import ProjectKey from '#models/project_key'
import ProjectToken from '#models/project_token'
import SecretSnapshot from '#models/secret_snapshot'

const ENCRYPTED = { ciphertext: 'c', iv: 'i', authTag: 't' }

async function setupTeam() {
  const suffix = Math.random().toString(36).slice(2)
  const owner = await User.create({
    email: `owner_${suffix}@example.com`,
    password: 'password123',
    fullName: 'Owner',
    publicKey: 'owner_pub',
  })
  const member = await User.create({
    email: `member_${suffix}@example.com`,
    password: 'password123',
    fullName: 'Member',
    publicKey: 'member_pub',
  })

  const team = await Team.create({ name: 'Rotation Team' })
  await grantRole(owner, 'maintainer', { team })
  await grantRole(member, 'developer', { team })

  const project = await Project.create({ name: 'Rotation Project', teamId: team.id })
  await ProjectKey.createMany([
    { projectId: project.id, userId: owner.id, encryptedKey: 'old_owner' },
    { projectId: project.id, userId: member.id, encryptedKey: 'old_member' },
  ])

  const snapshot = await SecretSnapshot.create({
    projectId: project.id,
    environment: 'production',
    version: 1,
    ...ENCRYPTED,
    createdBy: owner.id,
  })

  return { owner, member, team, project, snapshot }
}

test.group('Snapshots v2 push', (group) => {
  group.each.teardown(() => {
    env.set('ALLOW_LEGACY_CLIENTS', true)
  })

  test('accepts the next version under the current key', async ({ client, assert }) => {
    const { owner, project } = await setupTeam()

    const response = await client.post('/api/secrets').loginAs(owner).json({
      projectId: project.id,
      environment: 'production',
      cryptoVersion: 2,
      version: 2,
      keyVersion: 1,
      encryptedData: ENCRYPTED,
    })

    response.assertStatus(201)
    assert.equal(response.body().cryptoVersion, 2)
    assert.equal(response.body().version, 2)

    const latest = await client
      .get(`/api/secrets/latest?projectId=${project.id}&env=production`)
      .loginAs(owner)
    latest.assertBodyContains({ version: 2, cryptoVersion: 2, environment: 'production' })
  })

  test('rejects a version that is not the next one', async ({ client }) => {
    const { owner, project } = await setupTeam()

    const response = await client.post('/api/secrets').loginAs(owner).json({
      projectId: project.id,
      environment: 'production',
      cryptoVersion: 2,
      version: 1,
      keyVersion: 1,
      encryptedData: ENCRYPTED,
    })

    response.assertStatus(409)
  })

  test('rejects a push made with a rotated key', async ({ client }) => {
    const { owner, project } = await setupTeam()
    project.keyVersion = 2
    await project.save()

    const response = await client.post('/api/secrets').loginAs(owner).json({
      projectId: project.id,
      environment: 'production',
      cryptoVersion: 2,
      version: 2,
      keyVersion: 1,
      encryptedData: ENCRYPTED,
    })

    response.assertStatus(409)
  })

  test('legacy pushes and logins are refused once legacy clients are disabled', async ({
    client,
  }) => {
    const { owner, project } = await setupTeam()
    env.set('ALLOW_LEGACY_CLIENTS', false)

    const push = await client.post('/api/secrets').loginAs(owner).json({
      projectId: project.id,
      environment: 'production',
      encryptedData: ENCRYPTED,
    })
    push.assertStatus(403)

    const login = await client
      .post('/api/auth/login')
      .json({ email: owner.email, password: 'password123' })
    login.assertStatus(403)
  })
})

test.group('Project key rotation', () => {
  const rotation = (ctx: Awaited<ReturnType<typeof setupTeam>>) => ({
    expectedKeyVersion: 1,
    keys: [
      { userId: ctx.owner.id, encryptedKey: 'new_owner' },
      { userId: ctx.member.id, encryptedKey: 'new_member' },
    ],
    snapshots: [{ id: ctx.snapshot.id, ciphertext: 'c2', iv: 'i2', authTag: 't2' }],
  })

  test('replaces keys and snapshots atomically and revokes tokens', async ({ client, assert }) => {
    const ctx = await setupTeam()
    await ProjectToken.create({
      name: 'CI',
      token: 'hash',
      cryptoVersion: 2,
      projectId: ctx.project.id,
      environment: 'production',
      encryptedProjectKey: 'wrapped_old',
      createdBy: ctx.owner.id,
    })

    const response = await client
      .post(`/api/keys/${ctx.project.id}/rotate`)
      .loginAs(ctx.owner)
      .json(rotation(ctx))

    response.assertStatus(200)
    assert.deepEqual(response.body(), { keyVersion: 2, revokedTokens: 1 })

    await ctx.project.refresh()
    await ctx.snapshot.refresh()
    assert.equal(ctx.project.keyVersion, 2)
    assert.equal(ctx.snapshot.ciphertext, 'c2')
    assert.equal(ctx.snapshot.cryptoVersion, 2)
    assert.equal(ctx.snapshot.keyVersion, 2)

    const keys = await ProjectKey.query().where('project_id', ctx.project.id).orderBy('user_id')
    assert.sameMembers(
      keys.map((k) => k.encryptedKey),
      ['new_owner', 'new_member']
    )

    const key = await client.get(`/api/keys/${ctx.project.id}`).loginAs(ctx.member)
    key.assertBodyContains({ encryptedKey: 'new_member', keyVersion: 2 })
  })

  test('refuses a rotation that leaves out a member', async ({ client, assert }) => {
    const ctx = await setupTeam()
    const payload = rotation(ctx)
    payload.keys = payload.keys.slice(0, 1)

    const response = await client
      .post(`/api/keys/${ctx.project.id}/rotate`)
      .loginAs(ctx.owner)
      .json(payload)

    response.assertStatus(422)
    await ctx.project.refresh()
    assert.equal(ctx.project.keyVersion, 1)
  })

  test('refuses a rotation that includes an outsider', async ({ client }) => {
    const ctx = await setupTeam()
    const outsider = await User.create({
      email: `outsider_${Math.random()}@example.com`,
      password: 'password123',
      fullName: 'Outsider',
      publicKey: 'outsider_pub',
    })
    const payload = rotation(ctx)
    payload.keys.push({ userId: outsider.id, encryptedKey: 'new_outsider' })

    const response = await client
      .post(`/api/keys/${ctx.project.id}/rotate`)
      .loginAs(ctx.owner)
      .json(payload)

    response.assertStatus(422)
  })

  test('refuses a rotation that misses a snapshot pushed meanwhile', async ({ client, assert }) => {
    const ctx = await setupTeam()
    await SecretSnapshot.create({
      projectId: ctx.project.id,
      environment: 'production',
      version: 2,
      ...ENCRYPTED,
      createdBy: ctx.owner.id,
    })

    const response = await client
      .post(`/api/keys/${ctx.project.id}/rotate`)
      .loginAs(ctx.owner)
      .json(rotation(ctx))

    response.assertStatus(409)
    const keys = await ProjectKey.query().where('project_id', ctx.project.id)
    assert.sameMembers(
      keys.map((k) => k.encryptedKey),
      ['old_owner', 'old_member']
    )
  })

  test('refuses a stale rotation', async ({ client }) => {
    const ctx = await setupTeam()
    ctx.project.keyVersion = 3
    await ctx.project.save()

    const response = await client
      .post(`/api/keys/${ctx.project.id}/rotate`)
      .loginAs(ctx.owner)
      .json(rotation(ctx))

    response.assertStatus(409)
  })

  test('only owners can rotate or export snapshots', async ({ client }) => {
    const ctx = await setupTeam()

    const rotate = await client
      .post(`/api/keys/${ctx.project.id}/rotate`)
      .loginAs(ctx.member)
      .json(rotation(ctx))
    rotate.assertStatus(403)

    const exported = await client.get(`/api/keys/${ctx.project.id}/snapshots`).loginAs(ctx.member)
    exported.assertStatus(403)
  })

  test('exports snapshots and recipients for the rotating owner', async ({ client, assert }) => {
    const ctx = await setupTeam()

    const exported = await client.get(`/api/keys/${ctx.project.id}/snapshots`).loginAs(ctx.owner)
    exported.assertStatus(200)
    assert.equal(exported.body().keyVersion, 1)
    assert.lengthOf(exported.body().snapshots, 1)
    assert.equal(exported.body().snapshots[0].tag, 't')

    const recipients = await client
      .get(`/api/keys/${ctx.project.id}/recipients`)
      .loginAs(ctx.owner)
    recipients.assertStatus(200)
    assert.sameMembers(
      recipients.body().map((u: any) => u.id),
      [ctx.owner.id, ctx.member.id]
    )
  })

  test('share is refused with a stale key version', async ({ client }) => {
    const ctx = await setupTeam()
    ctx.project.keyVersion = 2
    await ctx.project.save()

    const response = await client
      .post(`/api/keys/${ctx.project.id}/share`)
      .loginAs(ctx.owner)
      .json({ targetUserId: ctx.member.id, encryptedKey: 'stale', keyVersion: 1 })

    response.assertStatus(409)
  })
})

test.group('Team member removal', () => {
  test('removes the member, their project keys, and lists projects to rotate', async ({
    client,
    assert,
  }) => {
    const ctx = await setupTeam()

    const response = await client
      .delete(`/api/teams/${ctx.team.id}/members/${ctx.member.id}`)
      .loginAs(ctx.owner)

    response.assertStatus(200)
    assert.deepEqual(response.body().projectsToRotate, [
      { id: ctx.project.id, name: 'Rotation Project', keyVersion: 1 },
    ])
    assert.isNull(await ProjectKey.query().where('user_id', ctx.member.id).first())

    const access = await client.get(`/api/projects/${ctx.project.id}`).loginAs(ctx.member)
    access.assertStatus(403)
  })

  test('cannot remove the last owner', async ({ client }) => {
    const ctx = await setupTeam()

    const response = await client
      .delete(`/api/teams/${ctx.team.id}/members/${ctx.owner.id}`)
      .loginAs(ctx.owner)

    response.assertStatus(422)
    response.assertBodyContains({ message: 'The team must keep at least one member able to manage it' })
  })

  test('members cannot remove other members', async ({ client }) => {
    const ctx = await setupTeam()

    const response = await client
      .delete(`/api/teams/${ctx.team.id}/members/${ctx.owner.id}`)
      .loginAs(ctx.member)

    response.assertStatus(403)
  })
})
