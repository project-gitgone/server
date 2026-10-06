import { audit } from '#services/audit'
import type { HttpContext } from '@adonisjs/core/http'
import Project from '#models/project'
import User, { V2_KEY_ENCRYPTION_ALGO } from '#models/user'
import { projectKeyring, saveUserKey } from '#services/keyring'
import { permit } from '#abilities/main'
import { ANY_ENVIRONMENT } from '#services/rbac/resolve'
import { setupProjectKeyValidator, uploadPublicKeyValidator } from '#validators/key'

export default class ProjectKeysController {
  async uploadPublicKey({ request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const payload = await request.validateUsing(uploadPublicKeyValidator)

    const keys =
      payload.encryptedPrivateKey && payload.kdf
        ? {
            encrypted_private_key: payload.encryptedPrivateKey,
            key_salt: null,
            key_encryption_algo: V2_KEY_ENCRYPTION_ALGO,
            crypto_version: 2,
            kdf_params: JSON.stringify(payload.kdf),
          }
        : payload.encryptedPrivateKey
          ? {
              encrypted_private_key: payload.encryptedPrivateKey,
              key_salt: payload.keySalt || null,
              key_encryption_algo: payload.keyEncryptionAlgo || 'aes-256-gcm',
            }
          : {}

    const updated = await User.query()
      .where('id', user.id)
      .whereNull('public_key')
      .update({ public_key: payload.publicKey, ...keys })
    if (!Number(updated[0] ?? 0)) {
      return response.conflict({ message: 'Keys are already set for this account' })
    }

    return response.ok({ message: 'Keys updated successfully' })
  }

  async getVault({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    if (!user.encryptedPrivateKey) {
      return response.notFound({ message: 'No private key vault found for this user.' })
    }

    return response.ok({
      encryptedPrivateKey: user.encryptedPrivateKey,
      keySalt: user.keySalt,
      keyEncryptionAlgo: user.keyEncryptionAlgo,
      cryptoVersion: user.cryptoVersion,
      kdfParams: user.kdfParams,
    })
  }

  async setupProjectKey({ request, params, auth, bouncer, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const project = await Project.findOrFail(params.projectId)

    if (await bouncer.denies(permit, 'env.read', { project, environment: ANY_ENVIRONMENT })) {
      return response.forbidden({ message: 'Access denied' })
    }

    const payload = await request.validateUsing(setupProjectKeyValidator)

    await saveUserKey(projectKeyring(project), user.id, payload.encryptedKey)

    await audit({ auth, request }, 'keys.setup', { projectId: project.id })
    return response.ok({ message: 'Project Key set for you' })
  }
}
