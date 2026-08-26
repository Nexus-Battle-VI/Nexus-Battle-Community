import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'

/**
 * Pruebas de integracion sobre la aplicacion NestJS real: se levanta el modulo
 * completo, con su raiz de composicion, sus tuberias de validacion y sus
 * controladores. No se sustituye ningun adaptador.
 */
describe('API de comunidad', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )

    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  /**
   * Ninguna peticion declara autor ni moderador: salen del testimonio. Con
   * AUTH_MODE=disabled ese testimonio es la identidad anonima, y el sujeto que
   * queda registrado es literalmente `anonymous`.
   */
  const ANONYMOUS = 'anonymous'

  const openThread = (title = 'Estrategias para el jefe final') =>
    request(app.getHttpServer()).post('/api/threads').send({ title })

  const publish = (threadId: string, content = 'Un mensaje valido.') =>
    request(app.getHttpServer()).post(`/api/threads/${threadId}/posts`).send({ content })

  it('POST /api/threads abre un hilo y responde 201', async () => {
    const response = await openThread()

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      title: 'Estrategias para el jefe final',
      authorId: ANONYMOUS,
      status: 'OPEN',
      postCount: 0,
      posts: [],
    })
  })

  it('POST /api/threads responde 400 con un titulo demasiado corto', async () => {
    expect((await openThread('Ab')).status).toBe(400)
  })

  it('POST /api/threads rechaza campos no declarados en el contrato', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/threads')
      .send({ title: 'Titulo valido de prueba', status: 'CLOSED' })

    expect(response.status).toBe(400)
  })

  /**
   * `authorId` salio del contrato al pasar a derivarse del testimonio. Enviarlo
   * ya no lo respeta el servicio: lo rechaza. Es la diferencia entre ignorar un
   * intento de suplantacion y rechazarlo de forma ruidosa.
   */
  it('rechaza un intento de declarar el autor en la peticion', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/threads')
      .send({ title: 'Titulo valido de prueba', authorId: 'acc-de-otra-persona' })

    expect(response.status).toBe(400)
  })

  it('publica un mensaje y aparece en la lectura del hilo', async () => {
    const thread = await openThread('Hilo con mensajes de prueba')

    const response = await publish(String(thread.body.id), 'Conviene abrir con el escudo.')

    expect(response.status).toBe(201)
    expect(response.body.postCount).toBe(1)
    expect(response.body.posts[0]).toMatchObject({
      authorId: ANONYMOUS,
      content: 'Conviene abrir con el escudo.',
    })
  })

  it('responde 404 al publicar en un hilo inexistente', async () => {
    expect((await publish('inexistente')).status).toBe(404)
  })

  it('responde 400 con contenido vacio o excesivo', async () => {
    const thread = await openThread('Hilo para validar contenido')
    const id = String(thread.body.id)

    expect((await publish(id, '   ')).status).toBe(400)
    expect((await publish(id, 'x'.repeat(2_001))).status).toBe(400)
  })

  it('un mensaje ocultado deja de ser visible pero se conserva', async () => {
    const thread = await openThread('Hilo para moderar mensajes')
    const id = String(thread.body.id)
    const withPost = await publish(id, 'Contenido inapropiado')
    const postId = String(withPost.body.posts[0].id)

    const hide = await request(app.getHttpServer()).post(
      `/api/threads/${id}/posts/${postId}/hiding`,
    )

    expect(hide.status).toBe(200)
    expect(hide.body.postCount).toBe(0)
    expect(hide.body.posts).toEqual([])

    const read = await request(app.getHttpServer()).get(`/api/threads/${id}`)
    expect(read.body.posts).toEqual([])
  })

  it('responde 400 al ocultar un mensaje inexistente y 404 si el hilo no existe', async () => {
    const thread = await openThread('Hilo para moderacion fallida')
    const id = String(thread.body.id)

    expect(
      (await request(app.getHttpServer()).post(`/api/threads/${id}/posts/inexistente/hiding`))
        .status,
    ).toBe(400)

    expect(
      (await request(app.getHttpServer()).post('/api/threads/inexistente/posts/p/hiding')).status,
    ).toBe(404)
  })

  it('un hilo cerrado no admite mensajes nuevos pero sigue siendo legible', async () => {
    const thread = await openThread('Hilo que sera cerrado')
    const id = String(thread.body.id)
    await publish(id, 'Mensaje anterior al cierre')

    const close = await request(app.getHttpServer()).post(`/api/threads/${id}/closure`)

    expect(close.status).toBe(200)
    expect(close.body.status).toBe('CLOSED')

    expect((await publish(id, 'Mensaje posterior')).status).toBe(400)

    const read = await request(app.getHttpServer()).get(`/api/threads/${id}`)
    expect(read.status).toBe(200)
    expect(read.body.postCount).toBe(1)
  })

  it('responde 400 al cerrar dos veces y 404 si el hilo no existe', async () => {
    const thread = await openThread('Hilo de doble cierre')
    const id = String(thread.body.id)
    await request(app.getHttpServer()).post(`/api/threads/${id}/closure`)

    expect((await request(app.getHttpServer()).post(`/api/threads/${id}/closure`)).status).toBe(400)

    expect(
      (await request(app.getHttpServer()).post('/api/threads/inexistente/closure')).status,
    ).toBe(404)
  })

  it('GET /api/threads/:id responde 404 si el hilo no existe', async () => {
    expect((await request(app.getHttpServer()).get('/api/threads/inexistente')).status).toBe(404)
  })

  it('GET /api/threads lista los hilos con su recuento visible', async () => {
    const response = await request(app.getHttpServer()).get('/api/threads')

    expect(response.status).toBe(200)
    expect(Array.isArray(response.body)).toBe(true)
    expect(response.body.length).toBeGreaterThan(0)
    expect(response.body[0]).toHaveProperty('postCount')
  })
})

describe('Sondas de salud', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /api/health/live responde 200', async () => {
    expect((await request(app.getHttpServer()).get('/api/health/live')).body).toEqual({
      status: 'ok',
      checks: {},
    })
  })

  it('GET /api/health/ready evalua las dependencias reales', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', checks: { 'threads-repository': 'ok' } })
  })

  it('GET /api/version expone servicio, version y entorno', async () => {
    expect((await request(app.getHttpServer()).get('/api/version')).body).toMatchObject({
      service: 'nexus-battle-community',
    })
  })
})
