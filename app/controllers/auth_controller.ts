import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { loginValidator } from '#validators/auth'

export default class AuthController {


  async login({ request, response }: HttpContext) {
    try {
      const payload = await request.validateUsing(loginValidator)

      const user = await User.verifyCredentials(payload.email, payload.password)

      if (!user) {
        return response.unauthorized('Invalid credentials')
      }

      const token = await User.accessTokens.create(user)

      const responseBody = {
        token: token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.fullName,
          system_role: user.systemRole,
          publicKey: user.publicKey,
          encryptedPrivateKey: user.encryptedPrivateKey,
          keySalt: user.keySalt,
          keyEncryptionAlgo: user.keyEncryptionAlgo,
        },
      };
      return response.ok(responseBody)
    } catch (error) {
      return response.internalServerError({ message: error.message, stack: error.stack });
    }
  }

  async me({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    await user.load('teams')

    const teams = user.teams.map((t) => ({
      id: t.id,
      name: t.name,
      role: t.$extras.pivot_role,
    }))

    return response.ok({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.fullName,
        system_role: user.systemRole,
        publicKey: user.publicKey,
        encryptedPrivateKey: user.encryptedPrivateKey,
        keySalt: user.keySalt,
        keyEncryptionAlgo: user.keyEncryptionAlgo,
      },
      teams,
    })
  }
}
