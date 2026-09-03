import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { DEMO_PRODUCT_IDS } from '../../src/adapters/outbound/existence/LocalProductCatalog'

/**
 * Pruebas de integracion del reporte de comentarios (HU-46), con
 * `AUTH_MODE=disabled` (identidad anonima), igual que el resto de la suite
 * por defecto de Community.
 */
describe('API de reporte de comentarios', () => {
  let app: INestApplication

  const PRODUCTO = DEMO_PRODUCT_IDS[0]

  if (PRODUCTO === undefined) {
    throw new Error('LocalProductCatalog necesita al menos un producto de demostracion.')
  }

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

  const publishComment = async (content: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post(`/api/products/${PRODUCTO}/comments`)
      .send({ content })

    return String(response.body.id)
  }

  const report = (commentId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/comments/${commentId}/reports`).send(body)

  it('registra un reporte valido sobre un comentario existente', async () => {
    const commentId = await publishComment('Comentario para reportar (flujo principal).')

    const response = await report(commentId, { category: 'SPAM' })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      commentId,
      authorId: 'anonymous',
      category: 'SPAM',
      description: null,
    })
  })

  it('acepta una descripcion opcional', async () => {
    const commentId = await publishComment('Comentario para reportar con descripcion.')

    const response = await report(commentId, {
      category: 'HARASSMENT',
      description: 'Insultos reiterados hacia otro jugador.',
    })

    expect(response.status).toBe(201)
    expect(response.body.description).toBe('Insultos reiterados hacia otro jugador.')
  })

  it('responde 400 con una categoria que no pertenece al vocabulario de RF-46', async () => {
    const commentId = await publishComment('Comentario con categoria invalida.')

    expect((await report(commentId, { category: 'OTHER' })).status).toBe(400)
  })

  it('responde 400 con una descripcion vacia o excesiva', async () => {
    const commentId = await publishComment('Comentario con descripcion invalida.')

    expect((await report(commentId, { category: 'SPAM', description: '' })).status).toBe(400)
    expect(
      (await report(commentId, { category: 'SPAM', description: 'x'.repeat(501) })).status,
    ).toBe(400)
  })

  it('responde 404 al reportar un comentario inexistente', async () => {
    expect((await report('comentario-inexistente', { category: 'SPAM' })).status).toBe(404)
  })

  it('rechaza un intento de declarar el autor en la peticion', async () => {
    const commentId = await publishComment('Comentario para probar suplantacion.')

    const response = await report(commentId, { category: 'SPAM', authorId: 'acc-ajeno' })

    expect(response.status).toBe(400)
  })
})

/**
 * El caso central de HU-46.3, de extremo a extremo: superado el limite
 * configurado, el siguiente reporte se rechaza con 429, no con 400 ni 409 --
 * es una limitacion de tasa, no un dato invalido ni un conflicto de estado.
 *
 * Vive en su propia app, con su propio almacen en memoria y un limite bajo
 * configurado explicitamente: asi el conteo no depende de cuantos reportes
 * ya emitio la identidad anonima en las pruebas de arriba, ni del valor por
 * defecto de COMMENT_REPORT_LIMIT.
 */
describe('Limite de reportes por jugador (HU-46.3)', () => {
  let app: INestApplication
  let previousLimit: string | undefined

  const PRODUCTO = DEMO_PRODUCT_IDS[0]

  if (PRODUCTO === undefined) {
    throw new Error('LocalProductCatalog necesita al menos un producto de demostracion.')
  }

  beforeAll(async () => {
    previousLimit = process.env.COMMENT_REPORT_LIMIT
    process.env.COMMENT_REPORT_LIMIT = '3'

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
    process.env.COMMENT_REPORT_LIMIT = previousLimit
  })

  const publishComment = async (content: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post(`/api/products/${PRODUCTO}/comments`)
      .send({ content })

    return String(response.body.id)
  }

  const report = (commentId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/comments/${commentId}/reports`).send(body)

  it('responde 429 al superar el limite de reportes configurado', async () => {
    const comments = await Promise.all(
      Array.from({ length: 4 }, (_v, i) =>
        publishComment(`Comentario para agotar el limite ${String(i)}`),
      ),
    )

    for (const commentId of comments.slice(0, 3)) {
      const response = await report(commentId, { category: 'SPAM' })
      expect(response.status).toBe(201)
    }

    const response = await report(comments[3]!, { category: 'SPAM' })
    expect(response.status).toBe(429)
  })
})
