import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import env from './env.js'

const ServerController = () => import('#controllers/server_controller')
const AuthController = () => import('#controllers/auth_controller')
const WorkspaceController = () => import('#controllers/workspace_controller')
const SecretsController = () => import('#controllers/secrets_controller')
const UsersController = () => import('#controllers/users_controller')
const ProjectKeysController = () => import('#controllers/project_keys_controller')

router.get('/', async () => {
  return {
    status: 'ok',
    instance: env.get('INSTANCE_NAME') || 'default',
  }
})

router.get('/healthcheck', [ServerController, 'health'])
router.post('/api/setup/init-admin', [ServerController, 'initAdmin'])
router.post('/api/auth/login', [AuthController, 'login'])


router.group(() => {
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

  router.post('/api/secrets', [SecretsController, 'push'])
  router.get('/api/secrets/latest', [SecretsController, 'latest'])
  router.get('/api/secrets/history', [SecretsController, 'history'])
  router.get('/api/secrets/version/:id', [SecretsController, 'getVersion'])
}).use(middleware.auth())
