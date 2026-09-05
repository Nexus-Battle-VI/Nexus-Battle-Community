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
 * Integracion de la moderacion de comentarios (HU-41), con autenticacion
 * ACTIVA: las cinco acciones y la cola exigen rol de moderacion, y eso solo
 * se puede comprobar con `AUTH_MODE=jwt` de verdad -- mismo arnes que
 * `auth-http.spec.ts` usa para Thread.
 */
const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  'token-jugador': { subject: 'sujeto-jugador', email: null, roles: new Set([Role.Player]) },
  'token-moderador': {
    subject: 'sujeto-moderador',
    email: null,
    roles: new Set([Role.Player, Role.Moderator]),
  },
  'token-administrador': {
    subject: 'sujeto-administrador',
    email: null,
    roles: new Set([Role.Player, Role.Administrator]),
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

describe('API de moderacion de comentarios (HU-41)', () => {
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
    }

    process.env.AUTH_MODE = 'jwt'
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pruebas'
    process.env.COGNITO_CLIENT_ID = 'cliente-de-pruebas'

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

  describe('Cola de moderacion (HU-41.1)', () => {
    it('responde 401 sin testimonio', async () => {
      expect(
        (await request(app.getHttpServer()).get('/api/comments/moderation-queue')).status,
      ).toBe(401)
    })

    it('responde 403 para un jugador sin rol de moderacion', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/comments/moderation-queue')
        .set('Authorization', bearer('token-jugador'))

      expect(response.status).toBe(403)
    })

    it('devuelve solo comentarios reportados, con su conteo de reportes', async () => {
      const reportado = await publishComment('Comentario que sera reportado.')
      await publishComment('Comentario que nunca se reporta.')

      await request(app.getHttpServer())
        .post(`/api/comments/${reportado}/reports`)
        .set('Authorization', bearer('token-jugador'))
        .send({ category: 'SPAM' })

      const response = await request(app.getHttpServer())
        .get('/api/comments/moderation-queue')
        .set('Authorization', bearer('token-moderador'))

      expect(response.status).toBe(200)
      const entrada = (
        response.body.items as { comment: { id: string }; reportCount: number }[]
      ).find((item) => item.comment.id === reportado)

      expect(entrada).toBeDefined()
      expect(entrada?.reportCount).toBe(1)
    })
  })

  describe('Las cinco acciones de moderacion (HU-41.2)', () => {
    it.each([
      ['approval', { reason: 'Motivo valido.' }],
      ['hiding', { reason: 'Motivo valido.' }],
      ['deletion', { reason: 'Motivo valido.' }],
      ['edits', { reason: 'Motivo valido.', content: 'Contenido editado.' }],
      ['marks', { reason: 'Motivo valido.' }],
    ])('responde 403 cuando un jugador intenta %s', async (subresource, body) => {
      const commentId = await publishComment('Comentario a moderar.')

      const response = await request(app.getHttpServer())
        .post(`/api/comments/${commentId}/${subresource}`)
        .set('Authorization', bearer('token-jugador'))
        .send(body)

      expect(response.status).toBe(403)
    })

    it.each([
      ['approval', { reason: 'Cumple las normas.' }, 'APPROVED'],
      ['hiding', { reason: 'Contenido ofensivo.' }, 'HIDDEN'],
      ['deletion', { reason: 'Infringe los terminos.' }, 'DELETED'],
      ['edits', { reason: 'Se retiro un enlace.', content: 'Contenido editado.' }, 'EDITED'],
      ['marks', { reason: 'Requiere seguimiento.' }, 'MARKED'],
    ])(
      'un moderador puede %s y el comentario refleja el nuevo estado',
      async (subresource, body, estadoEsperado) => {
        const commentId = await publishComment('Comentario a moderar.')

        const response = await request(app.getHttpServer())
          .post(`/api/comments/${commentId}/${subresource}`)
          .set('Authorization', bearer('token-moderador'))
          .send(body)

        expect(response.status).toBe(200)
        expect(response.body.moderationStatus).toBe(estadoEsperado)
      },
    )

    it('un administrador tambien puede moderar', async () => {
      const commentId = await publishComment('Comentario a moderar.')

      const response = await request(app.getHttpServer())
        .post(`/api/comments/${commentId}/approval`)
        .set('Authorization', bearer('token-administrador'))
        .send({ reason: 'Cumple las normas.' })

      expect(response.status).toBe(200)
      expect(response.body.moderationStatus).toBe('APPROVED')
    })

    it('responde 404 al moderar un comentario inexistente', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/comments/comentario-inexistente/approval')
        .set('Authorization', bearer('token-moderador'))
        .send({ reason: 'Motivo valido.' })

      expect(response.status).toBe(404)
    })

    it('responde 400 cuando el motivo esta vacio', async () => {
      const commentId = await publishComment('Comentario a moderar.')

      const response = await request(app.getHttpServer())
        .post(`/api/comments/${commentId}/hiding`)
        .set('Authorization', bearer('token-moderador'))
        .send({ reason: '' })

      expect(response.status).toBe(400)
    })

    it('rechaza editar sin contenido', async () => {
      const commentId = await publishComment('Comentario a moderar.')

      const response = await request(app.getHttpServer())
        .post(`/api/comments/${commentId}/edits`)
        .set('Authorization', bearer('token-moderador'))
        .send({ reason: 'Motivo valido.' })

      expect(response.status).toBe(400)
    })

    it('el comentario editado devuelve el contenido nuevo en una lectura posterior', async () => {
      const commentId = await publishComment('Comentario original.')

      await request(app.getHttpServer())
        .post(`/api/comments/${commentId}/edits`)
        .set('Authorization', bearer('token-moderador'))
        .send({ reason: 'Se corrigio contenido.', content: 'Comentario editado por moderacion.' })

      const lista = await request(app.getHttpServer()).get(`/api/products/${PRODUCTO}/comments`)
      const editado = (lista.body.items as { id: string; content: string }[]).find(
        (item) => item.id === commentId,
      )

      expect(editado?.content).toBe('Comentario editado por moderacion.')
    })

    /**
     * HU-41.9 (Management#29): "eliminar" es borrado FISICO -el PDF fuente
     * exige "remover permanentemente el comentario del sistema"-, no logico.
     * La respuesta del endpoint sigue devolviendo `DELETED` (contrato HTTP
     * sin cambios), pero una lectura posterior ya no debe encontrar la fila.
     */
    it('el comentario eliminado no reaparece en una lectura posterior (borrado fisico)', async () => {
      const commentId = await publishComment('Comentario que sera eliminado permanentemente.')

      const response = await request(app.getHttpServer())
        .post(`/api/comments/${commentId}/deletion`)
        .set('Authorization', bearer('token-moderador'))
        .send({ reason: 'Infringe los terminos de uso.' })

      expect(response.status).toBe(200)
      expect(response.body.moderationStatus).toBe('DELETED')

      const lista = await request(app.getHttpServer()).get(`/api/products/${PRODUCTO}/comments`)
      const eliminado = (lista.body.items as { id: string }[]).find((item) => item.id === commentId)

      expect(eliminado).toBeUndefined()
    })
  })
})
