import { test } from '@japa/runner'
import { DEFAULT_ROLES, type DefaultRoleKey } from '#services/rbac/default_roles'
import { defaultProtection } from '#services/rbac/environments'
import {
  allows,
  ANY_ENVIRONMENT,
  canSee,
  type AssignmentGrants,
  type ScopeType,
} from '#services/rbac/resolve'

const role = (
  key: DefaultRoleKey,
  scopeType: ScopeType,
  scopeId: string | null = null
): AssignmentGrants => ({
  scopeType,
  scopeId,
  grants: DEFAULT_ROLES[key].grants,
})
const env = (name: string) => ({ name, protected: defaultProtection(name) })
const project = { id: 'prj_1', teamId: 'team_1' }
const otherProject = { id: 'prj_2', teamId: 'team_2' }

test.group('RBAC resolution', () => {
  test('a team developer writes development but not production', ({ assert }) => {
    const user = [role('member', 'instance'), role('developer', 'team', 'team_1')]
    assert.isTrue(allows(user, 'env.write', { project, environment: env('development') }))
    assert.isFalse(allows(user, 'env.write', { project, environment: env('production') }))
    assert.isTrue(allows(user, 'env.read', { project, environment: env('production') }))
    assert.isFalse(
      allows(user, 'env.read', { project: otherProject, environment: env('development') })
    )
  })

  test('env permissions need an environment, ANY_ENVIRONMENT matches any grant', ({ assert }) => {
    const viewer = [role('viewer', 'project', 'prj_1')]
    assert.isFalse(allows(viewer, 'env.read', { project }))
    assert.isTrue(allows(viewer, 'env.read', { project, environment: ANY_ENVIRONMENT }))
    assert.isFalse(allows(viewer, 'env.read', { project, environment: env('prod') }))
  })

  test('a project role applies to that project only, never to its team', ({ assert }) => {
    const user = [role('maintainer', 'project', 'prj_1')]
    assert.isTrue(allows(user, 'project.manage', { project }))
    assert.isFalse(allows(user, 'team.members.manage', { teamId: 'team_1' }))
    assert.isFalse(allows(user, 'project.manage', { project: { id: 'prj_3', teamId: 'team_1' } }))
  })

  test('instance roles manage everything but never read secrets', ({ assert }) => {
    const owner = [role('owner', 'instance')]
    assert.isTrue(allows(owner, 'project.manage', { project }))
    assert.isTrue(allows(owner, 'team.members.manage', { teamId: 'team_9' }))
    assert.isTrue(allows(owner, 'instance.users.manage'))
    assert.isFalse(allows(owner, 'env.read', { project, environment: env('development') }))
  })

  test('rights from several roles add up', ({ assert }) => {
    const user = [role('viewer', 'team', 'team_1'), role('developer', 'project', 'prj_1')]
    assert.isTrue(allows(user, 'env.write', { project, environment: env('staging') }))
  })

  test('visibility', ({ assert }) => {
    assert.isTrue(canSee([role('viewer', 'team', 'team_1')], { project }))
    assert.isTrue(canSee([role('viewer', 'project', 'prj_1')], { project }))
    assert.isFalse(canSee([role('viewer', 'project', 'prj_1')], { teamId: 'team_1' }))
    assert.isTrue(canSee([role('owner', 'instance')], { teamId: 'team_9' }))
    assert.isFalse(canSee([role('member', 'instance')], { project }))
  })

  test('list filters ignore case', ({ assert }) => {
    const user: AssignmentGrants[] = [
      {
        scopeType: 'project',
        scopeId: 'prj_1',
        grants: [{ permission: 'env.write', environments: { type: 'list', names: ['Staging'] } }],
      },
    ]
    assert.isTrue(
      allows(user, 'env.write', { project, environment: { name: 'staging', protected: false } })
    )
  })
})
