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
import {
  MFA_EVIDENCE_VERIFIER,
  MfaEvidenceOutcome,
  SecondFactorMethod,
  type SecondFactorMethod as SecondFactorMethodValue,
  type MfaEvidenceVerifierPort,
} from '../../src/application/ports/MfaEvidenceVerifierPort'

/**
 * La evidencia de segundo factor sobre las mutaciones de moderacion.
 *
 * Lo que se comprueba es concreto: antes de esto, un testimonio con rol
 * MODERATOR bastaba para ocultar un mensaje o cerrar un hilo, sin que nada
 * distinguiera un token nacido tras el segundo factor de otro nacido sin el.
 */
const AUTOR: VerifiedIdentity = {
  subject: 'sujeto-autor',
  email: null,
  roles: new Set([Role.Player]),
  jti: 'jti-autor',
  expiresAt: new Date(Date.now() + 900_000),
}

const MODERADOR: VerifiedIdentity = {
  subject: 'sujeto-moderador',
  email: null,
  roles: new Set([Role.Player, Role.Moderator]),
  jti: 'jti-con-evidencia',
  expiresAt: new Date(Date.now() + 900_000),
}

const MODERADOR_OTRO_TESTIMONIO: VerifiedIdentity = { ...MODERADOR, jti: 'jti-sin-evidencia' }
const MODERADOR_SIN_JTI: VerifiedIdentity = { ...MODERADOR, jti: null }
const JUGADOR: VerifiedIdentity = {
  subject: 'sujeto-jugador',
  email: null,
  roles: new Set([Role.Player]),
  jti: 'jti-jugador',
  expiresAt: new Date(Date.now() + 900_000),
}

const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  'token-autor': AUTOR,
  'token-moderador': MODERADOR,
  'token-moderador-otro-jti': MODERADOR_OTRO_TESTIMONIO,
  'token-moderador-sin-jti': MODERADOR_SIN_JTI,
  'token-jugador': JUGADOR,
}

const stubVerifier: TokenVerifierPort = {
  verify: (token: string): Promise<VerifiedIdentity> => {
    const identity = IDENTITIES[token]

    return identity === undefined
      ? Promise.reject(new TokenVerificationError())
      : Promise.resolve(identity)
  },
}

/** Registra cada consulta para poder afirmar que NO se hace en rutas publicas. */
const consultas: { subject: string; jti: string; method: SecondFactorMethodValue }[] = []
let resultado: MfaEvidenceOutcome = MfaEvidenceOutcome.Valid

const stubEvidence: MfaEvidenceVerifierPort = {
  verify: (
    subject: string,
    jti: string,
    method: SecondFactorMethodValue,
  ): Promise<MfaEvidenceOutcome> => {
    consultas.push({ subject, jti, method })

    // Solo el testimonio con evidencia sembrada la tiene.
    if (jti !== MODERADOR.jti) {
      return Promise.resolve(MfaEvidenceOutcome.Absent)
    }

    return Promise.resolve(resultado)
  },
}

describe('Evidencia de segundo factor en las mutaciones de moderacion', () => {
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
      .overrideProvider(MFA_EVIDENCE_VERIFIER)
      .useValue(stubEvidence)
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
    process.env = { ...process.env, ...previousEnv }
  })

  beforeEach(() => {
    consultas.length = 0
    resultado = MfaEvidenceOutcome.Valid
  })

  const abrirHilo = async (titulo: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/api/threads')
      .set('Authorization', 'Bearer token-autor')
      .send({ title: titulo })

    return String(response.body.id)
  }

  const publicar = (threadId: string): Promise<request.Response> =>
    request(app.getHttpServer())
      .post(`/api/threads/${threadId}/posts`)
      .set('Authorization', 'Bearer token-autor')
      .send({ content: 'Contenido de prueba para moderar.' })

  it('permite ocultar un mensaje con rol de moderacion y evidencia valida', async () => {
    const threadId = await abrirHilo('Hilo con evidencia valida')
    const post = await publicar(threadId)
    const postId = String(post.body.posts[0].id)

    const response = await request(app.getHttpServer())
      .post(`/api/threads/${threadId}/posts/${postId}/hiding`)
      .set('Authorization', 'Bearer token-moderador')

    expect(response.status).toBe(200)
    expect(consultas).toEqual([
      {
        subject: 'sujeto-moderador',
        jti: 'jti-con-evidencia',
        method: SecondFactorMethod.AuthenticatorApp,
      },
    ])
  })

  /**
   * El caso que motiva todo el cambio: mismo rol, mismo sujeto, testimonio sin
   * evidencia. Antes esto ocultaba el mensaje.
   */
  it('DENIEGA ocultar si el testimonio no tiene evidencia', async () => {
    const threadId = await abrirHilo('Hilo sin evidencia')
    const post = await publicar(threadId)
    const postId = String(post.body.posts[0].id)

    const response = await request(app.getHttpServer())
      .post(`/api/threads/${threadId}/posts/${postId}/hiding`)
      .set('Authorization', 'Bearer token-moderador-otro-jti')

    expect(response.status).toBe(403)
    // El mensaje SIGUE visible: la comprobacion ocurrio antes de cualquier efecto.
    const lectura = await request(app.getHttpServer()).get(`/api/threads/${threadId}`)
    expect(lectura.body.posts).toHaveLength(1)
  })

  /**
   * La evidencia se liga al testimonio, no a la persona. El mismo sujeto con
   * otro `jti` no hereda la prueba del anterior.
   */
  it('DENIEGA al mismo sujeto con un jti distinto', async () => {
    const threadId = await abrirHilo('Hilo con jti distinto')
    const post = await publicar(threadId)
    const postId = String(post.body.posts[0].id)

    const response = await request(app.getHttpServer())
      .post(`/api/threads/${threadId}/posts/${postId}/hiding`)
      .set('Authorization', 'Bearer token-moderador-otro-jti')

    expect(response.status).toBe(403)
    expect(consultas).toEqual([
      {
        subject: 'sujeto-moderador',
        jti: 'jti-sin-evidencia',
        method: SecondFactorMethod.AuthenticatorApp,
      },
    ])
  })

  it('DENIEGA si el testimonio no trae identificador', async () => {
    const threadId = await abrirHilo('Hilo con testimonio sin jti')
    const post = await publicar(threadId)
    const postId = String(post.body.posts[0].id)

    const response = await request(app.getHttpServer())
      .post(`/api/threads/${threadId}/posts/${postId}/hiding`)
      .set('Authorization', 'Bearer token-moderador-sin-jti')

    expect(response.status).toBe(403)
    // Ni siquiera se pregunta: sin `jti` no hay nada que consultar.
    expect(consultas).toEqual([])
  })

  /**
   * FALLO CERRADO. Un tiempo de espera agotado NO puede convertirse en «adelante».
   * Y responde 503, no 403: el sistema no pudo comprobarlo, y culpar a la
   * persona seria mentir sobre la causa y mandar a depurar al sitio equivocado.
   */
  it('falla CERRADO con 503 cuando la evidencia no se puede comprobar', async () => {
    resultado = MfaEvidenceOutcome.Unavailable

    const threadId = await abrirHilo('Hilo con Account indisponible')
    const post = await publicar(threadId)
    const postId = String(post.body.posts[0].id)

    const response = await request(app.getHttpServer())
      .post(`/api/threads/${threadId}/posts/${postId}/hiding`)
      .set('Authorization', 'Bearer token-moderador')

    expect(response.status).toBe(503)
    const lectura = await request(app.getHttpServer()).get(`/api/threads/${threadId}`)
    expect(lectura.body.posts).toHaveLength(1)
  })

  it('distingue 403 de 503: denegado no es lo mismo que no verificable', async () => {
    const threadId = await abrirHilo('Hilo para distinguir 403 de 503')
    const post = await publicar(threadId)
    const postId = String(post.body.posts[0].id)

    resultado = MfaEvidenceOutcome.Unavailable
    const indisponible = await request(app.getHttpServer())
      .post(`/api/threads/${threadId}/posts/${postId}/hiding`)
      .set('Authorization', 'Bearer token-moderador')

    resultado = MfaEvidenceOutcome.Valid
    const denegado = await request(app.getHttpServer())
      .post(`/api/threads/${threadId}/posts/${postId}/hiding`)
      .set('Authorization', 'Bearer token-moderador-otro-jti')

    expect(indisponible.status).toBe(503)
    expect(denegado.status).toBe(403)
  })

  it('protege tambien el cierre de hilo', async () => {
    const threadId = await abrirHilo('Hilo protegido en el cierre')

    const response = await request(app.getHttpServer())
      .post(`/api/threads/${threadId}/closure`)
      .set('Authorization', 'Bearer token-moderador-otro-jti')

    expect(response.status).toBe(403)
  })

  it('permite cerrar un hilo con evidencia valida', async () => {
    const threadId = await abrirHilo('Hilo cerrado con evidencia')

    const response = await request(app.getHttpServer())
      .post(`/api/threads/${threadId}/closure`)
      .set('Authorization', 'Bearer token-moderador')

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('CLOSED')
  })

  /**
   * RBAC sigue actuando ANTES. Sin rol suficiente se rechaza sin llegar a
   * consultar la evidencia: no se gasta una llamada de red por cada intento sin
   * permiso.
   */
  it('un jugador sigue rechazado por rol, sin consultar la evidencia', async () => {
    const threadId = await abrirHilo('Hilo protegido de un jugador')
    const post = await publicar(threadId)
    const postId = String(post.body.posts[0].id)

    const response = await request(app.getHttpServer())
      .post(`/api/threads/${threadId}/posts/${postId}/hiding`)
      .set('Authorization', 'Bearer token-jugador')

    expect(response.status).toBe(403)
    expect(consultas).toEqual([])
  })

  /**
   * CONTROL de todo lo anterior: las rutas publicas NO dependen de Account. Sin
   * esta prueba, «las mutaciones consultan la evidencia» pasaria igual con una
   * implementacion que consultara en TODAS las rutas y dejara la lectura
   * publica caida cuando Account lo estuviera.
   */
  it('las lecturas publicas NO consultan a Account', async () => {
    const listado = await request(app.getHttpServer()).get('/api/threads')

    expect(listado.status).toBe(200)
    expect(consultas).toEqual([])
  })

  it('abrir un hilo y publicar un mensaje tampoco dependen de Account', async () => {
    resultado = MfaEvidenceOutcome.Unavailable

    const threadId = await abrirHilo('Hilo sin dependencia de Account')
    const post = await publicar(threadId)

    expect(post.status).toBe(201)
    expect(consultas).toEqual([])
  })
})
