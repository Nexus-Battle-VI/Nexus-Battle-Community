import 'reflect-metadata'

import { ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import {
  Role,
  TOKEN_VERIFIER,
  TokenVerificationError,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'
import { COMMENT_MODERATION_ACTION_REPOSITORY } from '../../src/application/ports/CommentModerationActionRepositoryPort'
import type { CommentModerationActionRepositoryPort } from '../../src/application/ports/CommentModerationActionRepositoryPort'
import { ProductCommentId } from '../../src/domain/value-objects/product-review-values'
import { DEMO_PRODUCT_IDS } from '../../src/adapters/outbound/existence/LocalProductCatalog'

/**
 * IP de origen de una accion de moderacion (HU-41.8, PDF fuente 7.3.5), a
 * traves de la API real: se resuelve del servidor (`trust proxy`, un unico
 * salto detras de Caddy -ver `main.ts`-), nunca del cuerpo enviado por Web.
 */
const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  'token-jugador': { subject: 'sujeto-jugador', email: null, roles: new Set([Role.Player]) },
  'token-moderador': {
    subject: 'sujeto-moderador',
    email: null,
    roles: new Set([Role.Player, Role.Moderator]),
  },
}

const stubVerifier: TokenVerifierPort = {
  verify: (token: string): Promise<VerifiedIdentity> => {
    const identity = IDENTITIES[token]

    return identity === undefined
      ? Promise.reject(new TokenVerificationError())
      : Promise.resolve(identity)
  },
}

describe('IP de origen de la moderacion de comentarios (HU-41.8)', () => {
  let app: NestExpressApplication
  let actions: CommentModerationActionRepositoryPort
  let previousEnv: Record<string, string | undefined>

  const PRODUCTO = DEMO_PRODUCT_IDS[0]

  if (PRODUCTO === undefined) {
    throw new Error('LocalProductCatalog necesita al menos un producto de demostracion.')
  }

  beforeAll(async () => {
    previousEnv = {
      AUTH_MODE: process.env.AUTH_MODE,
      COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
      COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
    }

    process.env.AUTH_MODE = 'jwt'
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pruebas'
    process.env.COGNITO_CLIENT_ID = 'cliente-de-pruebas'

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(stubVerifier)
      .compile()

    app = moduleRef.createNestApplication<NestExpressApplication>()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    // Mismo ajuste que `main.ts`: un unico salto de proxy confiable.
    app.set('trust proxy', 1)

    actions = moduleRef.get(COMMENT_MODERATION_ACTION_REPOSITORY)

    await app.init()
  })

  afterAll(async () => {
    await app.close()

    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  const bearer = (token: string): string => `Bearer ${token}`

  const publishComment = async (content: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post(`/api/products/${PRODUCTO}/comments`)
      .set('Authorization', bearer('token-jugador'))
      .send({ content })

    return String(response.body.id)
  }

  it('captura la IP resuelta por el servidor desde X-Forwarded-For (un unico salto confiable)', async () => {
    const commentId = await publishComment('Comentario a moderar con IP real.')

    const response = await request(app.getHttpServer())
      .post(`/api/comments/${commentId}/hiding`)
      .set('Authorization', bearer('token-moderador'))
      .set('X-Forwarded-For', '198.51.100.55')
      .send({ reason: 'Motivo valido.' })

    expect(response.status).toBe(200)

    const history = await actions.listByComment(ProductCommentId.create(commentId))
    expect(history[0]?.ipAddress?.value).toBe('198.51.100.55')
  })

  it('una IP enviada en el body es rechazada (400), nunca aceptada como fuente de verdad', async () => {
    const commentId = await publishComment('Comentario a moderar, IP falsa en el body.')

    const response = await request(app.getHttpServer())
      .post(`/api/comments/${commentId}/hiding`)
      .set('Authorization', bearer('token-moderador'))
      .set('X-Forwarded-For', '198.51.100.55')
      .send({ reason: 'Motivo valido.', ipAddress: '1.2.3.4' })

    expect(response.status).toBe(400)

    // Ni siquiera se llego a registrar la accion: el rechazo es previo a moderar.
    const history = await actions.listByComment(ProductCommentId.create(commentId))
    expect(history).toHaveLength(0)
  })

  it('las cinco acciones de moderacion capturan la IP de origen', async () => {
    const acciones: readonly [string, Record<string, unknown>][] = [
      ['approval', { reason: 'Motivo valido.' }],
      ['deletion', { reason: 'Motivo valido.' }],
      ['edits', { reason: 'Motivo valido.', content: 'Contenido editado.' }],
      ['marks', { reason: 'Motivo valido.' }],
    ]

    for (const [subresource, body] of acciones) {
      const commentId = await publishComment(`Comentario para ${subresource}.`)

      const response = await request(app.getHttpServer())
        .post(`/api/comments/${commentId}/${subresource}`)
        .set('Authorization', bearer('token-moderador'))
        .set('X-Forwarded-For', '203.0.113.77')
        .send(body)

      expect(response.status).toBe(200)

      const history = await actions.listByComment(ProductCommentId.create(commentId))
      expect(history[0]?.ipAddress?.value).toBe('203.0.113.77')
    }
  })
})
