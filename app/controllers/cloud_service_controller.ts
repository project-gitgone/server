import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { audit } from '#services/audit'
import { deactivateUser, restoreCloudUser, userOfCloudSubject } from '#services/accounts'
import { cloudConfig } from '#services/cloud'
import { completeCloudLogin } from '#services/cloud_login'
import { cloudIdentityValidator } from '#validators/cloud'

const CLOUD_ACTOR = { type: 'token' as const, id: 'cloud:service', label: 'GitGone Cloud' }

export default class CloudServiceController {
  async disable({ params, request, auth, response }: HttpContext) {
    const user = await userOfCloudSubject(params.subject)
    if (!user) return response.notFound({ message: 'Unknown identity' })

    await deactivateUser(user, { by: 'cloud', revokeKeys: true })
    await audit({ auth, request }, 'users.delete', {
      actor: CLOUD_ACTOR,
      targetType: 'user',
      targetId: user.id,
      details: { reason: 'removed from the cloud organization' },
    })
    return response.ok({ userId: user.id, disabled: true })
  }

  async enable({ params, request, auth, response }: HttpContext) {
    const user = await userOfCloudSubject(params.subject)
    if (!user) return response.notFound({ message: 'Unknown identity' })

    await restoreCloudUser(user)
    await audit({ auth, request }, 'users.update', {
      actor: CLOUD_ACTOR,
      targetType: 'user',
      targetId: user.id,
      details: { fields: ['deletedAt'], reason: 'back in the cloud organization' },
    })
    return response.ok({ userId: user.id, disabled: false })
  }

  async link({ params, request, auth, response }: HttpContext) {
    const profile = await request.validateUsing(cloudIdentityValidator)
    const known = await userOfCloudSubject(params.subject)
    const local = await User.query().whereRaw('lower(email) = ?', [profile.email.toLowerCase()]).first()
    const user = await completeCloudLogin({
      subject: params.subject,
      email: profile.email,
      name: profile.name ?? null,
      emailVerified: profile.emailVerified,
      organization: cloudConfig()!.instanceId,
      role: profile.role,
    })
    if (!known) {
      await audit({ auth, request }, local ? 'users.update' : 'users.create', {
        actor: CLOUD_ACTOR,
        targetType: 'user',
        targetId: user.id,
        details: { reason: 'linked to a cloud organization member' },
      })
    }
    return response.ok({ userId: user.id })
  }
}
