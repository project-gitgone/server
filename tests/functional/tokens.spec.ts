import { test } from '@japa/runner'
import { grantRole } from '#tests/helpers/rbac'
import env from '#start/env'
import User from '#models/user'
import Team from '#models/team'
import Project from '#models/project'
import ProjectToken from '#models/project_token'
import SecretSnapshot from '#models/secret_snapshot'

const VERIFIER = 'a'.repeat(43)

async function setupProject() {
  const owner = await User.create({
    email: `token_owner_${Math.random()}@example.com`,
    password: 'password123',
    fullName: 'Token Owner',
  })

  const team = await Team.create({ name: 'Token Team' })
  await grantRole(owner, 'maintainer', { team })

  const project = await Project.create({ name: 'Token Project', teamId: team.id })

  await SecretSnapshot.create({
    projectId: project.id,
    environment: 'production',
    version: 1,
    ciphertext: 'cipher',
    iv: 'iv',
    authTag: 'tag',
    createdBy: owner.id,
  })

  return { owner, project }
}

test.group('Project Tokens', (group) => {
  group.each.teardown(() => {
    env.set('ALLOW_LEGACY_TOKENS', true)
  })

  test('create a v2 token from a verifier and fetch secrets with it', async ({ client, assert }) => {
    const { owner, project } = await setupProject()

    const createResponse = await client
      .post(`/api/projects/${project.id}/tokens`)
      .loginAs(owner)
      .json({
        name: 'CI',
        environment: 'production',
        authVerifier: VERIFIER,
        encryptedProjectKey: 'wrapped_key',
      })

    createResponse.assertStatus(201)
    assert.equal(createResponse.body().cryptoVersion, 2)
    assert.notProperty(createResponse.body(), 'token')

    const id = createResponse.body().id

    const envResponse = await client
      .get('/api/secrets/token')
      .header('Authorization', `Bearer v2.${id}.${VERIFIER}`)

    envResponse.assertStatus(200)
    envResponse.assertBodyContains({
      cryptoVersion: 2,
      encryptedProjectKey: 'wrapped_key',
      secrets: { ciphertext: 'cipher', iv: 'iv', authTag: 'tag' },
    })
  })

  test('v2 token is rejected when presented in legacy format', async ({ client }) => {
    const { owner, project } = await setupProject()

    const token = await ProjectToken.create({
      name: 'CI',
      token: 'unused',
      cryptoVersion: 2,
      projectId: project.id,
      environment: 'production',
      encryptedProjectKey: 'wrapped_key',
      createdBy: owner.id,
    })

    const response = await client
      .get('/api/secrets/token')
      .header('Authorization', `Bearer ${token.id}.${VERIFIER}`)

    response.assertStatus(401)
  })

  test('wrong verifier is rejected', async ({ client }) => {
    const { owner, project } = await setupProject()

    const createResponse = await client
      .post(`/api/projects/${project.id}/tokens`)
      .loginAs(owner)
      .json({
        name: 'CI',
        environment: 'production',
        authVerifier: VERIFIER,
        encryptedProjectKey: 'wrapped_key',
      })

    const response = await client
      .get('/api/secrets/token')
      .header('Authorization', `Bearer v2.${createResponse.body().id}.${'b'.repeat(43)}`)

    response.assertStatus(401)
  })

  test('legacy token still works while legacy tokens are allowed', async ({ client }) => {
    const { owner, project } = await setupProject()

    const createResponse = await client
      .post(`/api/projects/${project.id}/tokens`)
      .loginAs(owner)
      .json({
        name: 'Legacy',
        environment: 'production',
        tokenSecretHash: 'legacy_secret',
        encryptedProjectKey: 'wrapped_key',
      })

    createResponse.assertStatus(201)
    createResponse.assertBodyContains({ cryptoVersion: 1 })

    const response = await client
      .get('/api/secrets/token')
      .header('Authorization', `Bearer ${createResponse.body().id}.legacy_secret`)

    response.assertStatus(200)
    response.assertBodyContains({ cryptoVersion: 1 })
  })

  test('legacy tokens are refused when disabled', async ({ client }) => {
    const { owner, project } = await setupProject()

    const createResponse = await client
      .post(`/api/projects/${project.id}/tokens`)
      .loginAs(owner)
      .json({
        name: 'Legacy',
        environment: 'production',
        tokenSecretHash: 'legacy_secret',
        encryptedProjectKey: 'wrapped_key',
      })

    env.set('ALLOW_LEGACY_TOKENS', false)

    const fetchResponse = await client
      .get('/api/secrets/token')
      .header('Authorization', `Bearer ${createResponse.body().id}.legacy_secret`)

    fetchResponse.assertStatus(401)

    const createAgain = await client
      .post(`/api/projects/${project.id}/tokens`)
      .loginAs(owner)
      .json({
        name: 'Legacy 2',
        environment: 'production',
        tokenSecretHash: 'legacy_secret',
        encryptedProjectKey: 'wrapped_key',
      })

    createAgain.assertStatus(422)
  })
})
