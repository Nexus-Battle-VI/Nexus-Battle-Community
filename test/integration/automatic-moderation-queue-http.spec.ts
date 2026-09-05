import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
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
import { DEMO_PRODUCT_IDS } from '../../src/adapters/outbound/existence/LocalProductCatalog'

/**
 * Cola de moderacion combinada (HU-41.1, Management#29): reportes de
 * jugador (HU-46) Y detecciones del filtro automatico de contenido
 * (HU-41.7), a traves de la API real -no del caso de uso en aislamiento,
 * eso ya lo cubre `automatic-content-moderation-application.spec.ts`-.
 *
 * `forbidden-test-term` es vocabulario ARTIFICIAL de prueba (asi lo exige
 * Management#29 explicitamente): no representa ninguna regla de negocio.
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

describe('Cola de moderacion combinada: reportes + filtro automatico (HU-41.7)', () => {
  let app: INestApplication
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
      COMMENT_MODERATION_FORBIDDEN_TERMS: process.env.COMMENT_MODERATION_FORBIDDEN_TERMS,
    }

    process.env.AUTH_MODE = 'jwt'
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pruebas'
    process.env.COGNITO_CLIENT_ID = 'cliente-de-pruebas'
    process.env.COMMENT_MODERATION_FORBIDDEN_TERMS = 'forbidden-test-term'

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(stubVerifier)
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )

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

  const queue = async (): Promise<{
    items: {
      comment: { id: string }
      reportCount: number
      automaticFlagCount: number
      sources: string[]
    }[]
  }> => {
    const response = await request(app.getHttpServer())
      .get('/api/comments/moderation-queue')
      .set('Authorization', bearer('token-moderador'))

    return response.body as {
      items: {
        comment: { id: string }
        reportCount: number
        automaticFlagCount: number
        sources: string[]
      }[]
    }
  }

  it('un comentario reportado aparece en la cola con origen USER_REPORT', async () => {
    const reportado = await publishComment('Comentario perfectamente normal, sera reportado.')

    await request(app.getHttpServer())
      .post(`/api/comments/${reportado}/reports`)
      .set('Authorization', bearer('token-jugador'))
      .send({ category: 'SPAM' })

    const entrada = (await queue()).items.find((item) => item.comment.id === reportado)

    expect(entrada).toBeDefined()
    expect(entrada?.reportCount).toBe(1)
    expect(entrada?.sources).toEqual(['USER_REPORT'])
  })

  it('un comentario detectado por el filtro automatico aparece en la cola con origen AUTOMATIC_FILTER', async () => {
    const detectado = await publishComment('Este comentario tiene forbidden-test-term dentro.')

    const entrada = (await queue()).items.find((item) => item.comment.id === detectado)

    expect(entrada).toBeDefined()
    expect(entrada?.reportCount).toBe(0)
    expect(entrada?.automaticFlagCount).toBeGreaterThanOrEqual(1)
    expect(entrada?.sources).toEqual(['AUTOMATIC_FILTER'])
  })

  it('un comentario reportado Y detectado aparece una sola vez, con ambos origenes', async () => {
    const ambos = await publishComment('Contiene forbidden-test-term y ademas sera reportado.')

    await request(app.getHttpServer())
      .post(`/api/comments/${ambos}/reports`)
      .set('Authorization', bearer('token-jugador'))
      .send({ category: 'OFFENSIVE_CONTENT' })

    const items = (await queue()).items.filter((item) => item.comment.id === ambos)

    expect(items).toHaveLength(1)
    expect(items[0]?.sources.sort()).toEqual(['AUTOMATIC_FILTER', 'USER_REPORT'])
  })

  it('un comentario sin reporte ni deteccion no aparece en la cola', async () => {
    const limpio = await publishComment('Comentario sin ningun problema.')

    const entrada = (await queue()).items.find((item) => item.comment.id === limpio)

    expect(entrada).toBeUndefined()
  })

  it('la paginacion sigue funcionando con la cola combinada', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/comments/moderation-queue')
      .query({ limit: 1, offset: 0 })
      .set('Authorization', bearer('token-moderador'))

    expect(response.status).toBe(200)
    expect((response.body.items as unknown[]).length).toBeLessThanOrEqual(1)
    expect(response.body.limit).toBe(1)
    expect(response.body.offset).toBe(0)
  })
})
