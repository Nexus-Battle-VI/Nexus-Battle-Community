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

/**
 * Integracion con la autenticacion ACTIVA.
 *
 * Lo que se comprueba es concreto y era el agujero mas grave del servicio:
 * antes, `authorId` y `moderatorId` los declaraba el cliente en el cuerpo de la
 * peticion. Cualquiera podia publicar en nombre de otra persona, ocultar
 * mensajes ajenos o cerrar hilos con solo escribir un identificador.
 */
const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  'token-ana': { subject: 'sujeto-ana', email: null, roles: new Set([Role.Player]) },
  'token-bruno': { subject: 'sujeto-bruno', email: null, roles: new Set([Role.Player]) },
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

describe('API de comunidad con autenticacion activa', () => {
  let app: INestApplication
  let previousEnv: Record<string, string | undefined>

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

  const bearer = (token: string) => `Bearer ${token}`

  let contador = 0
  const abrirHilo = (token: string) => {
    contador += 1

    return request(app.getHttpServer())
      .post('/api/threads')
      .set('Authorization', bearer(token))
      .send({ title: `Hilo de prueba numero ${String(contador)}` })
  }

  describe('La lectura es publica, la escritura no', () => {
    it('lista hilos sin testimonio', async () => {
      expect((await request(app.getHttpServer()).get('/api/threads')).status).toBe(200)
    })

    it('responde 401 al abrir un hilo sin testimonio', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/threads')
        .send({ title: 'Un titulo valido de prueba' })

      expect(response.status).toBe(401)
    })
  })

  describe('El autor sale del testimonio, no de la peticion', () => {
    it('registra como autor el sujeto del testimonio', async () => {
      const response = await abrirHilo('token-ana')

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({ authorId: 'sujeto-ana' })
    })

    /**
     * Esta es la prueba que fija el arreglo. Antes, este mismo cuerpo habria
     * creado un hilo firmado por otra persona. Ahora `authorId` no forma parte
     * del contrato y `forbidNonWhitelisted` lo rechaza.
     */
    it('rechaza un intento de suplantar al autor', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/threads')
        .set('Authorization', bearer('token-bruno'))
        .send({ title: 'Un titulo valido de prueba', authorId: 'sujeto-ana' })

      expect(response.status).toBe(400)
    })

    it('atribuye cada mensaje a quien lo publica', async () => {
      const hilo = await abrirHilo('token-ana')
      const response = await request(app.getHttpServer())
        .post(`/api/threads/${(hilo.body as { id: string }).id}/posts`)
        .set('Authorization', bearer('token-bruno'))
        .send({ content: 'Un mensaje de Bruno.' })

      expect(response.status).toBe(201)
      expect((response.body as { posts: { authorId: string }[] }).posts[0]).toMatchObject({
        authorId: 'sujeto-bruno',
      })
    })
  })

  describe('La moderacion exige rol de moderacion', () => {
    let threadId: string
    let postId: string

    beforeEach(async () => {
      const hilo = await abrirHilo('token-ana')
      threadId = (hilo.body as { id: string }).id

      const conMensaje = await request(app.getHttpServer())
        .post(`/api/threads/${threadId}/posts`)
        .set('Authorization', bearer('token-bruno'))
        .send({ content: 'Contenido a moderar.' })

      postId = (conMensaje.body as { posts: { id: string }[] }).posts[0]!.id
    })

    it('responde 403 cuando un jugador intenta ocultar un mensaje', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/threads/${threadId}/posts/${postId}/hiding`)
        .set('Authorization', bearer('token-ana'))

      expect(response.status).toBe(403)
    })

    it('responde 403 cuando un jugador intenta cerrar un hilo', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/threads/${threadId}/closure`)
        .set('Authorization', bearer('token-bruno'))

      expect(response.status).toBe(403)
    })

    it('permite ocultar un mensaje a un moderador', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/threads/${threadId}/posts/${postId}/hiding`)
        .set('Authorization', bearer('token-moderador'))

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ postCount: 0 })
    })

    /**
     * Ni siquiera el autor del hilo puede moderarlo si no tiene el rol: la
     * autoridad de moderacion no se hereda de haber abierto la conversacion.
     */
    it('no concede moderacion al autor del hilo', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/threads/${threadId}/closure`)
        .set('Authorization', bearer('token-ana'))

      expect(response.status).toBe(403)
    })
  })
})
