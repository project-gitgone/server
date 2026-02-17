import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import env from './env.js'
import User from '#models/user'

const ServerController = () => import('#controllers/server_controller')
const AuthController = () => import('#controllers/auth_controller')
const WorkspaceController = () => import('#controllers/workspace_controller')
const SecretsController = () => import('#controllers/secrets_controller')
const UsersController = () => import('#controllers/users_controller')
const ProjectKeysController = () => import('#controllers/project_keys_controller')
const ProjectTokensController = () => import('#controllers/project_tokens_controller')

router.get('/', async ({ request, view }) => {
  const wantsJson =
    request.accepts(['html', 'json']) === 'json' || request.header('accept')?.includes('json')

  const adminCount = await User.query()
    .where('systemRole', 'SUPERADMIN')
    .count('* as total')
    .first()
  const hasAdmin = adminCount?.$extras.total > 0

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
router.post('/api/setup/init-admin', [ServerController, 'initAdmin'])
router.post('/api/auth/login', [AuthController, 'login'])

router
  .group(() => {
    router.get('/api/auth/me', [AuthController, 'me'])
    router.get('/api/users', [UsersController, 'index'])
    router.post('/api/users', [UsersController, 'store'])
    router.patch('/api/users/:id', [UsersController, 'update'])
    router.delete('/api/users/:id', [UsersController, 'destroy'])
    router.post('/api/teams', [WorkspaceController, 'createTeam'])
    router.post('/api/teams/:id/members', [WorkspaceController, 'addMember'])

    router.get('/api/teams/:id/members', [WorkspaceController, 'listMembers'])
    router.post('/api/teams/:id/projects', [WorkspaceController, 'createProject'])
    router.patch('/api/projects/:id', [WorkspaceController, 'updateProject'])
    router.get('/api/projects/:id', [WorkspaceController, 'showProject'])
    router.get('/api/projects', [WorkspaceController, 'listProjects'])

    router.post('/api/keys/upload-public-key', [ProjectKeysController, 'uploadPublicKey'])
    router.get('/api/keys/vault', [ProjectKeysController, 'getVault'])
    router.get('/api/keys/:projectId', [ProjectKeysController, 'getProjectKey'])
    router.get('/api/keys/:projectId/pending', [ProjectKeysController, 'pending'])
    router.post('/api/keys/:projectId/setup', [ProjectKeysController, 'setupProjectKey'])
    router.post('/api/keys/:projectId/share', [ProjectKeysController, 'shareProjectKey'])

    router.get('/api/projects/:projectId/tokens', [ProjectTokensController, 'index'])
    router.post('/api/projects/:projectId/tokens', [ProjectTokensController, 'store'])
    router.delete('/api/projects/tokens/:id', [ProjectTokensController, 'destroy'])

    router.post('/api/secrets', [SecretsController, 'push'])
    router.get('/api/secrets/latest', [SecretsController, 'latest'])
    router.get('/api/secrets/history', [SecretsController, 'history'])
    router.get('/api/secrets/version/:id', [SecretsController, 'getVersion'])
  })
  .use(middleware.auth())

router.get('/api/v1/get-env', [ProjectTokensController, 'getEnv'])
router.get('/api/v1/secrets/token', [ProjectTokensController, 'getEnv']) // Alias
