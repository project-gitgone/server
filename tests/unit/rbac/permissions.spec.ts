import { test } from '@japa/runner'
import { InvalidGrantsError, normalizeGrants } from '#services/rbac/permissions'
import { defaultProtection, environmentInScope } from '#services/rbac/environments'
import { DEFAULT_ROLES, defaultRoleId } from '#services/rbac/default_roles'

test.group('RBAC catalogue', () => {
  test('environment protection ignores case and spaces', ({ assert }) => {
    for (const name of ['production', 'Production', ' prod ', 'PROD']) {
      assert.isTrue(defaultProtection(name), name)
    }
    for (const name of ['staging', 'development', 'preprod', 'production-eu']) {
      assert.isFalse(defaultProtection(name), name)
    }
  })

  test('environment scopes', ({ assert }) => {
    assert.isTrue(environmentInScope({ type: 'all' }, { name: 'production', protected: defaultProtection('production') }))
    assert.isFalse(environmentInScope({ type: 'unprotected' }, { name: 'production', protected: defaultProtection('production') }))
    assert.isTrue(environmentInScope({ type: 'unprotected' }, { name: 'staging', protected: defaultProtection('staging') }))
    assert.isTrue(environmentInScope({ type: 'list', names: ['staging'] }, { name: 'staging', protected: defaultProtection('staging') }))
    assert.isFalse(environmentInScope({ type: 'list', names: ['staging'] }, { name: 'development', protected: defaultProtection('development') }))
  })

  test('env permissions default to all environments', ({ assert }) => {
    assert.deepEqual(normalizeGrants('workspace', [{ permission: 'env.read' }]), [
      { permission: 'env.read', environments: { type: 'all' } },
    ])
  })

  test('list scopes are trimmed and deduplicated', ({ assert }) => {
    const [grant] = normalizeGrants('workspace', [
      {
        permission: 'env.write',
        environments: { type: 'list', names: [' staging', 'staging', 'qa'] },
      },
    ])
    assert.deepEqual(grant.environments, { type: 'list', names: ['staging', 'qa'] })
  })

  test('invalid grants are rejected', ({ assert }) => {
    const cases: [string, unknown][] = [
      ['instance', [{ permission: 'env.read' }]],
      ['workspace', [{ permission: 'instance.users.manage' }]],
      ['workspace', [{ permission: 'env.fly' }]],
      ['workspace', [{ permission: 'project.manage', environments: { type: 'all' } }]],
      ['workspace', [{ permission: 'env.read' }, { permission: 'env.read' }]],
      ['workspace', [{ permission: 'env.read', environments: { type: 'list', names: [] } }]],
      ['workspace', [{ permission: 'env.read', environments: { type: 'some' } }]],
      ['workspace', 'env.read'],
    ]
    for (const [scope, input] of cases) {
      assert.throws(
        () => normalizeGrants(scope as 'instance' | 'workspace', input),
        InvalidGrantsError as any
      )
    }
  })

  test('default roles are valid for their scope and never let instance roles read secrets', ({
    assert,
  }) => {
    for (const role of Object.values(DEFAULT_ROLES)) {
      assert.deepEqual(normalizeGrants(role.scope, role.grants), role.grants, role.key)
      assert.equal(defaultRoleId(role.key), `role_${role.key}`)
      if (role.scope === 'instance') {
        assert.isFalse(
          role.grants.some((g) => g.permission.startsWith('env.')),
          role.key
        )
      }
    }
  })
})
