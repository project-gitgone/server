import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import env from './env.js'
import RoleAssignment from '#models/role_assignment'
import { defaultRoleId } from '#services/rbac/default_roles'

const ServerController = () => import('#controllers/server_controller')
const AuthController = () => import('#controllers/auth_controller')
const CloudLoginController = () => import('#controllers/cloud_login_controller')
const WorkspaceController = () => import('#controllers/workspace_controller')
const SecretsController = () => import('#controllers/secrets_controller')
const UsersController = () => import('#controllers/users_controller')
const ProjectKeysController = () => import('#controllers/project_keys_controller')
const KeyringController = () => import('#controllers/keyring_controller')
const ProjectTokensController = () => import('#controllers/project_tokens_controller')
const RolesController = () => import('#controllers/roles_controller')
const MembersController = () => import('#controllers/members_controller')
const EnvironmentsController = () => import('#controllers/environments_controller')
const AuditController = () => import('#controllers/audit_controller')
const CloudServiceController = () => import('#controllers/cloud_service_controller')

router.get('/', async ({ request, view }) => {
  const wantsJson =
    request.accepts(['html', 'json']) === 'json' || request.header('accept')?.includes('json')

  const hasAdmin = !!(await RoleAssignment.query()
    .where('role_id', defaultRoleId('owner'))
    .whereHas('user', (user) => user.whereNull('deleted_at'))
    .first())

  const instanceName = env.get('INSTANCE_NAME') || 'default'

  if (wantsJson) {
    return {
      status: 'ok',
      instance: instanceName,
    }
  }

  return view.render('welcome', {
    hasAdmin,
    instanceName,
  })
})

router.get('/healthcheck', [ServerController, 'health'])
router.get('/api/capabilities', [ServerController, 'capabilities'])
router.post('/api/setup/init-admin', [ServerController, 'initAdmin'])
router.post('/api/auth/prelogin', [AuthController, 'prelogin'])
router.post('/api/auth/login', [AuthController, 'login'])
router.post('/api/auth/activate', [AuthController, 'activate'])

router
  .group(() => {
    router.get('/auth/cloud/login', [CloudLoginController, 'login'])
    router.get('/auth/cloud/callback', [CloudLoginController, 'callback'])
    router.post('/api/auth/cloud/exchange', [CloudLoginController, 'exchange'])
  })
  .use(middleware.cloudOnly())

function manageableRoutes() {
  router.get('/auth/me', [AuthController, 'me'])
  router.get('/users', [UsersController, 'index'])
  router.post('/users', [UsersController, 'store'])
  router.patch('/users/:id', [UsersController, 'update'])
  router.delete('/users/:id', [UsersController, 'destroy'])
  router.post('/users/:id/reset-credentials', [UsersController, 'resetCredentials'])
  router.put('/users/:id/role', [MembersController, 'setInstanceRole'])
  router.get('/permissions', [RolesController, 'permissions'])
  router.get('/roles', [RolesController, 'index'])
  router.post('/roles', [RolesController, 'store'])
  router.patch('/roles/:id', [RolesController, 'update'])
  router.delete('/roles/:id', [RolesController, 'destroy'])
  router.get('/audit', [AuditController, 'index'])
  router.get('/teams', [WorkspaceController, 'listTeams'])
  router.post('/teams', [WorkspaceController, 'createTeam'])
  router.get('/teams/:id/members', [WorkspaceController, 'listMembers'])
  router.post('/teams/:id/members', [WorkspaceController, 'addMember'])
  router.patch('/teams/:id/members/:userId', [MembersController, 'setTeamRole'])
  router.delete('/teams/:id/members/:userId', [WorkspaceController, 'removeMember'])
  router.post('/teams/:id/projects', [WorkspaceController, 'createProject'])
  router.get('/projects', [WorkspaceController, 'listProjects'])
  router.get('/projects/:id', [WorkspaceController, 'showProject'])
  router.get('/projects/:id/permissions', [WorkspaceController, 'projectPermissions'])
  router.patch('/projects/:id', [WorkspaceController, 'updateProject'])
  router.get('/projects/:id/members', [MembersController, 'listProjectMembers'])
  router.put('/projects/:id/members', [MembersController, 'setProjectRole'])
  router.delete('/projects/:id/members/:userId', [MembersController, 'removeProjectRole'])
  router.get('/projects/:id/environments', [EnvironmentsController, 'index'])
  router.post('/projects/:id/environments', [EnvironmentsController, 'store'])
  router.patch('/projects/:id/environments/:environmentId', [EnvironmentsController, 'update'])
  router.get('/keys/:projectId/pending', [KeyringController, 'pending'])
  router.get('/projects/:projectId/environments/:environment/key/pending', [KeyringController, 'pending'])
  router.get('/projects/:projectId/tokens', [ProjectTokensController, 'index'])
  router.delete('/projects/tokens/:id', [ProjectTokensController, 'destroy'])
  router.get('/secrets/history', [SecretsController, 'history'])
}

router
  .group(() => {
    manageableRoutes()
    router.post('/auth/upgrade', [AuthController, 'upgrade'])
    router.post('/auth/password', [AuthController, 'changePassword'])

    router.post('/keys/upload-public-key', [ProjectKeysController, 'uploadPublicKey'])
    router.get('/keys/vault', [ProjectKeysController, 'getVault'])
    router.post('/keys/:projectId/setup', [ProjectKeysController, 'setupProjectKey'])
    for (const base of ['/keys/:projectId', '/projects/:projectId/environments/:environment/key']) {
      router.get(base, [KeyringController, 'show'])
      router.post(`${base}/share`, [KeyringController, 'share'])
      router.get(`${base}/recipients`, [KeyringController, 'recipients'])
      router.get(`${base}/snapshots`, [KeyringController, 'snapshots'])
      router.post(`${base}/rotate`, [KeyringController, 'rotate'])
    }

    router.post('/projects/:projectId/tokens', [ProjectTokensController, 'store'])

    router.post('/secrets', [SecretsController, 'push'])
    router.get('/secrets/latest', [SecretsController, 'latest'])
    router.get('/secrets/version/:id', [SecretsController, 'getVersion'])
  })
  .prefix('/api')
  .use(middleware.auth())

router
  .group(() => {
    router.post('/identities/:subject/disable', [CloudServiceController, 'disable'])
    router.post('/identities/:subject/enable', [CloudServiceController, 'enable'])
    router.post('/identities/:subject/link', [CloudServiceController, 'link'])
  })
  .prefix('/api/manage/v1/service')
  .use([middleware.cloudOnly(), middleware.cloudService({ scope: 'membership.sync' })])

router
  .group(() => manageableRoutes())
  .prefix('/api/manage/v1')
  .use([middleware.cloudOnly(), middleware.auth({ guards: ['cloud'] })])

router.get('/api/secrets/token', [ProjectTokensController, 'getEnv'])
