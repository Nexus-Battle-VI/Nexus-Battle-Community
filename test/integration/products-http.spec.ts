import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { DEMO_PRODUCT_IDS } from '../../src/adapters/outbound/existence/LocalProductCatalog'

/**
 * Pruebas de integracion sobre la aplicacion NestJS real, con
 * `AUTH_MODE=disabled` (identidad anonima) como el resto de la suite por
 * defecto de Community.
 */
describe('API de comentarios y calificaciones de producto', () => {
  let app: INestApplication

  const PRODUCTO = DEMO_PRODUCT_IDS[0]
  const OTRO_PRODUCTO = DEMO_PRODUCT_IDS[1]

  if (PRODUCTO === undefined || OTRO_PRODUCTO === undefined) {
    throw new Error('LocalProductCatalog necesita al menos dos productos de demostracion.')
  }

  // UUID con formato valido pero ausente de DEMO_PRODUCT_IDS: distingue "mal
  // formado" (400) de "bien formado pero inexistente en el catalogo" (404).
  const PRODUCTO_INEXISTENTE = '00000000-0000-4000-8000-000000000000'

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

  const publish = (productId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/products/${productId}/comments`).send(body)

  const rate = (productId: string, rating: number) =>
    request(app.getHttpServer()).post(`/api/products/${productId}/reviews`).send({ rating })

  it('publica un comentario asociado a un producto existente', async () => {
    const response = await publish(PRODUCTO, { content: 'Excelente calidad de materiales.' })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      productId: PRODUCTO,
      authorId: 'anonymous',
      content: 'Excelente calidad de materiales.',
      images: [],
    })
  })

  it('acepta imagenes opcionales validas', async () => {
    const response = await publish(PRODUCTO, {
      content: 'Con fotos del producto recibido.',
      images: ['https://cdn.nexusbattle.example/foto-1.jpg'],
    })

    expect(response.status).toBe(201)
    expect(response.body.images).toEqual(['https://cdn.nexusbattle.example/foto-1.jpg'])
  })

  it('responde 400 con una referencia de imagen invalida', async () => {
    const response = await publish(PRODUCTO, {
      content: 'Con una imagen mal formada.',
      images: ['no-es-una-url'],
    })

    expect(response.status).toBe(400)
  })

  it('responde 400 con mas del maximo de imagenes permitidas', async () => {
    const response = await publish(PRODUCTO, {
      content: 'Demasiadas fotos.',
      images: Array.from({ length: 6 }, (_v, i) => `https://cdn.test/${String(i)}.jpg`),
    })

    expect(response.status).toBe(400)
  })

  it('responde 400 con contenido vacio o excesivo', async () => {
    expect((await publish(PRODUCTO, { content: '   ' })).status).toBe(400)
    expect((await publish(PRODUCTO, { content: 'x'.repeat(2_001) })).status).toBe(400)
  })

  it('responde 404 al comentar un producto inexistente', async () => {
    expect((await publish(PRODUCTO_INEXISTENTE, { content: 'Hola' })).status).toBe(404)
  })

  it('rechaza un intento de declarar el autor en la peticion', async () => {
    const response = await publish(PRODUCTO, { content: 'Un comentario', authorId: 'acc-ajeno' })

    expect(response.status).toBe(400)
  })

  it('no impone limite de comentarios por producto: 25 comentarios se publican sin error', async () => {
    for (let i = 0; i < 25; i += 1) {
      const response = await publish(OTRO_PRODUCTO, { content: `Comentario numero ${String(i)}` })
      expect(response.status).toBe(201)
    }

    const listado = await request(app.getHttpServer()).get(
      `/api/products/${OTRO_PRODUCTO}/comments`,
    )
    expect(listado.body.total).toBe(25)
  })

  it('lista los comentarios de un producto sin testimonio, mas recientes primero', async () => {
    await publish(PRODUCTO, { content: 'Primero cronologicamente' })
    await publish(PRODUCTO, { content: 'Segundo cronologicamente' })

    const response = await request(app.getHttpServer()).get(`/api/products/${PRODUCTO}/comments`)

    expect(response.status).toBe(200)
    expect(response.body.items[0].content).toBe('Segundo cronologicamente')
  })

  it('pagina la lista de comentarios con limit y offset', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/products/${OTRO_PRODUCTO}/comments`)
      .query({ limit: 5, offset: 0 })

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(5)
    expect(response.body.limit).toBe(5)
  })

  it('registra una calificacion valida', async () => {
    const response = await rate(PRODUCTO, 5)

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ productId: PRODUCTO, authorId: 'anonymous', rating: 5 })
  })

  it('responde 400 con una calificacion fuera de la escala 1-5', async () => {
    expect((await rate(OTRO_PRODUCTO, 0)).status).toBe(400)
    expect((await rate(OTRO_PRODUCTO, 6)).status).toBe(400)
  })

  it('responde 404 al calificar un producto inexistente', async () => {
    expect((await rate(PRODUCTO_INEXISTENTE, 3)).status).toBe(404)
  })

  it('actualiza la calificacion promedio del producto', async () => {
    const antes = await request(app.getHttpServer()).get(
      `/api/products/${OTRO_PRODUCTO}/reviews/summary`,
    )
    expect(antes.body).toEqual({ productId: OTRO_PRODUCTO, average: null, count: 0 })

    await rate(OTRO_PRODUCTO, 4)

    const despues = await request(app.getHttpServer()).get(
      `/api/products/${OTRO_PRODUCTO}/reviews/summary`,
    )
    expect(despues.body).toEqual({ productId: OTRO_PRODUCTO, average: 4, count: 1 })
  })

  it('haber calificado un producto no impide seguir comentandolo', async () => {
    // El jugador anonimo ya califico PRODUCTO en 'registra una calificacion
    // valida'; publicar otro comentario sobre el mismo producto debe seguir
    // funcionando sin que esa calificacion previa lo impida.
    const response = await publish(PRODUCTO, { content: 'Sigo comentando tras calificar' })

    expect(response.status).toBe(201)
  })

  it('DENIEGA con 409 una segunda calificacion del mismo jugador sobre el mismo producto', async () => {
    // PRODUCTO ya fue calificado por el jugador anonimo mas arriba. 409, no
    // 400: es un conflicto con el estado actual, no una entrada mal formada
    // -- mismo criterio que CanonicalProductsController en Catalog.
    const response = await rate(PRODUCTO, 3)

    expect(response.status).toBe(409)
  })
})
