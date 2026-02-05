import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import Project from '#models/project'
import ProjectKey from '#models/project_key'
import ProjectPolicy from '#policies/project_policy'
import {
    setupProjectKeyValidator,
    shareProjectKeyValidator,
    uploadPublicKeyValidator,
} from '#validators/key'

export default class ProjectKeysController {

    async uploadPublicKey({ request, auth, response }: HttpContext) {
        const user = auth.getUserOrFail()

        const payload = await request.validateUsing(uploadPublicKeyValidator)

        user.publicKey = payload.publicKey

        if (payload.encryptedPrivateKey) {
            user.encryptedPrivateKey = payload.encryptedPrivateKey
            user.keySalt = payload.keySalt || null
            user.keyEncryptionAlgo = payload.keyEncryptionAlgo || 'aes-256-gcm'
        }

        await user.save()

        return response.ok({ message: 'Keys updated successfully' })
    }


    async getVault({ auth, response }: HttpContext) {
        const user = auth.getUserOrFail()

        if (!user.encryptedPrivateKey) {
            return response.notFound('No private key vault found for this user.')
        }

        return response.ok({
            encryptedPrivateKey: user.encryptedPrivateKey,
            keySalt: user.keySalt,
            keyEncryptionAlgo: user.keyEncryptionAlgo
        })
    }


    async getProjectKey({ params, auth, bouncer, response }: HttpContext) {
        const user = auth.getUserOrFail()
        const project = await Project.findOrFail(params.projectId)

        if (await bouncer.with(ProjectPolicy).denies('view', project)) {
            return response.forbidden('Access denied to this project')
        }

        const keyEntry = await ProjectKey.query()
            .where('project_id', project.id)
            .andWhere('user_id', user.id)
            .first()

        if (!keyEntry) {
            return response.notFound('No project key found for you. Ask the admin to re-invite you or rotate keys.')
        }

        return response.ok({
            encryptedKey: keyEntry.encryptedKey
        })
    }


    async pending({ params, bouncer, response }: HttpContext) {
        const project = await Project.findOrFail(params.projectId)

        if (await bouncer.with(ProjectPolicy).denies('edit', project)) {
            return response.forbidden('Access denied')
        }

        await project.load('team')

        const pendingUsers = await User.query()
            .whereNotNull('public_key')
            .whereIn('id', (subQuery) => {
                subQuery
                    .select('user_id')
                    .from('team_members')
                    .where('team_id', project.teamId)
            })
            .whereNotIn('id', (subQuery) => {
                subQuery
                    .select('user_id')
                    .from('project_keys')
                    .where('project_id', project.id)
            })
            .select('id', 'email', 'full_name', 'public_key')

        return response.ok(pendingUsers)
    }

    async setupProjectKey({ request, params, auth, bouncer, response }: HttpContext) {
        const user = auth.getUserOrFail()
        const project = await Project.findOrFail(params.projectId)

        if (await bouncer.with(ProjectPolicy).denies('edit', project)) {
            return response.forbidden('Access denied')
        }

        const payload = await request.validateUsing(setupProjectKeyValidator)

        await ProjectKey.updateOrCreate({
            projectId: project.id,
            userId: user.id
        }, {
            encryptedKey: payload.encryptedKey
        })

        return response.ok({ message: 'Project Key set for you' })
    }

    async shareProjectKey({ request, params, bouncer, response }: HttpContext) {
        const project = await Project.findOrFail(params.projectId)

        if (await bouncer.with(ProjectPolicy).denies('edit', project)) {
            return response.forbidden('Access denied')
        }

        const payload = await request.validateUsing(shareProjectKeyValidator)

        await ProjectKey.updateOrCreate({
            projectId: project.id,
            userId: payload.targetUserId
        }, {
            encryptedKey: payload.encryptedKey
        })

        return response.ok({ message: 'Key shared successfully' })
    }
}
