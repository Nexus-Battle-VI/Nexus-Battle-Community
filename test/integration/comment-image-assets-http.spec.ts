import 'reflect-metadata'

import { createHash } from 'node:crypto'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import type { InMemoryCommentImageStorageAdapter } from '../../src/adapters/outbound/storage/InMemoryCommentImageStorageAdapter'
import { COMMENT_IMAGE_STORAGE } from '../../src/application/ports/CommentImageStoragePort'

/**
 * API de imagenes de comentario (HU-40.1, EN-028), sobre la aplicacion
 * NestJS real con `AUTH_MODE=disabled` (identidad anonima), igual que el
 * resto de la suite de integracion por defecto de Community. El driver de
 * almacenamiento es `memory`: no toca S3 real.
 */
describe('API de imagenes de comentario', () => {
  let app: INestApplication

  const createPngBuffer = (): Buffer => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const ihdrData = Buffer.alloc(13)
    ihdrData.writeUInt32BE(512, 0)
    ihdrData.writeUInt32BE(512, 4)
    ihdrData[8] = 8
    ihdrData[9] = 6
    const ihdrChunk = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
      Buffer.from('IHDR', 'ascii'),
      ihdrData,
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
    ])
    const iendChunk = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('IEND', 'ascii'),
      Buffer.from([0xae, 0x42, 0x60, 0x82]),
    ])
    return Buffer.concat([signature, ihdrChunk, iendChunk])
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

  const createUpload = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/comment-image-assets/uploads').send(body)

  it('crea una intencion de carga con el formulario firmado', async () => {
    const buffer = createPngBuffer()

    const response = await createUpload({
      contentType: 'image/png',
      contentLength: buffer.length,
      checksumSha256: createHash('sha256').update(buffer).digest('hex'),
    })

    expect(response.status).toBe(201)
    expect(response.body.upload.method).toBe('POST')
    expect(response.body.upload.fields.key).toContain('staging/comments/')
    expect(typeof response.body.assetId).toBe('string')
  })

  it('rechaza un tipo MIME no admitido con 400 (validacion de forma del DTO)', async () => {
    const response = await createUpload({
      contentType: 'image/gif',
      contentLength: 100,
      checksumSha256: 'hash',
    })

    expect(response.status).toBe(400)
  })

  it('finaliza la imagen tras la carga directa simulada y queda lista para servirse', async () => {
    const buffer = createPngBuffer()
    const checksum = createHash('sha256').update(buffer).digest('hex')

    const intent = await createUpload({
      contentType: 'image/png',
      contentLength: buffer.length,
      checksumSha256: checksum,
    })

    // El driver `memory` no tiene un endpoint real de carga: se inyecta el
    // objeto directamente en el adaptador para simular lo que en produccion
    // hace el navegador contra S3.
    const storage = app.get<InMemoryCommentImageStorageAdapter>(COMMENT_IMAGE_STORAGE)
    storage.putObjectDirectly(intent.body.upload.fields.key as string, buffer, 'image/png')

    const finalized = await request(app.getHttpServer())
      .post(`/api/comment-image-assets/${intent.body.assetId as string}/finalization`)
      .send({})

    expect(finalized.status).toBe(200)
    expect(finalized.body.status).toBe('READY')
    expect(finalized.body.imageUrl).toContain(
      `/comment-image-assets/${intent.body.assetId as string}/content`,
    )

    const content = await request(app.getHttpServer())
      .get(`/api/comment-image-assets/${intent.body.assetId as string}/content`)
      .redirects(0)

    expect(content.status).toBe(307)
    expect(content.headers.location).toContain('presigned-mock')
  })

  it('un assetId inexistente responde 404 al finalizar y al servir contenido', async () => {
    const inexistente = '00000000-0000-4000-8000-000000000000'

    await request(app.getHttpServer())
      .post(`/api/comment-image-assets/${inexistente}/finalization`)
      .send({})
      .expect(404)

    await request(app.getHttpServer())
      .get(`/api/comment-image-assets/${inexistente}/content`)
      .expect(404)
  })
})
