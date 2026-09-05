import { createHash } from 'node:crypto'
import {
  CommentImageAsset,
  CommentImageAssetStatus,
  isCommentImageAssetStatus,
} from '../../src/domain/entities/CommentImageAsset'
import { CommentImageContentValidator } from '../../src/domain/services/CommentImageContentValidator'
import {
  CommentImageAssetConflictError,
  CommentImageAssetExpiredError,
  CommentImageAssetNotFoundError,
  CommentImageAssetOwnershipError,
  CommentImageChecksumMismatchError,
  CommentImageInvalidContentError,
  CommentImageLengthMismatchError,
} from '../../src/application/errors/ApplicationError'
import { DomainError } from '../../src/domain/errors/DomainError'
import { InMemoryCommentImageStorageAdapter } from '../../src/adapters/outbound/storage/InMemoryCommentImageStorageAdapter'
import { InMemoryCommentImageAssetRepository } from '../../src/adapters/outbound/persistence/InMemoryCommentImageAssetRepository'
import { CreateCommentImageUploadIntent } from '../../src/application/use-cases/CreateCommentImageUploadIntent'
import { FinalizeCommentImageAsset } from '../../src/application/use-cases/FinalizeCommentImageAsset'
import { GetCommentImageContent } from '../../src/application/use-cases/GetCommentImageContent'
import type { ClockPort } from '../../src/application/ports/ClockPort'
import type { IdGeneratorPort } from '../../src/application/ports/IdGeneratorPort'

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

const createJpegBuffer = (): Buffer => {
  const soi = Buffer.from([0xff, 0xd8])
  const sof0 = Buffer.alloc(19)
  sof0[0] = 0xff
  sof0[1] = 0xc0
  sof0.writeUInt16BE(17, 2)
  sof0[4] = 8
  sof0.writeUInt16BE(512, 5)
  sof0.writeUInt16BE(512, 7)
  sof0[9] = 3
  const eoi = Buffer.from([0xff, 0xd9])
  return Buffer.concat([soi, sof0, eoi])
}

const createWebpBuffer = (): Buffer => {
  const vp8Data = Buffer.alloc(18)
  const vp8Chunk = Buffer.concat([
    Buffer.from('VP8 ', 'ascii'),
    Buffer.from([0x0a, 0x00, 0x00, 0x00]),
    vp8Data,
  ])
  const riffHeader = Buffer.alloc(12)
  riffHeader.write('RIFF', 0, 'ascii')
  riffHeader.writeUInt32LE(vp8Chunk.length + 4, 4)
  riffHeader.write('WEBP', 8, 'ascii')
  return Buffer.concat([riffHeader, vp8Chunk])
}

const hashSha256 = (buffer: Buffer): { hex: string; b64: string } => ({
  hex: createHash('sha256').update(buffer).digest('hex'),
  b64: createHash('sha256').update(buffer).digest('base64'),
})

const AUTHOR = 'acc-jugador-1'
const OTHER_AUTHOR = 'acc-jugador-2'

describe('CommentImageContentValidator (HU-40, EN-028)', () => {
  it('acepta un PNG valido y devuelve su formato y hash', () => {
    const buffer = createPngBuffer()
    const { hex } = hashSha256(buffer)

    const result = CommentImageContentValidator.validate({
      buffer,
      declaredContentType: 'image/png',
      declaredContentLength: buffer.length,
      declaredChecksumSha256: hex,
    })

    expect(result.format).toBe('png')
    expect(result.sha256Hex).toBe(hex)
  })

  it('NO exige dimensiones minimas -- a diferencia de ADR-016 en Catalog', () => {
    // Un PNG de 1x1 seria rechazado en Catalog (< 256px). EN-028 aprobo
    // explicitamente que HU-40 no tenga ese requisito.
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const ihdrData = Buffer.alloc(13)
    ihdrData.writeUInt32BE(1, 0)
    ihdrData.writeUInt32BE(1, 4)
    const ihdrChunk = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
      Buffer.from('IHDR', 'ascii'),
      ihdrData,
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
    ])
    const buffer = Buffer.concat([signature, ihdrChunk])
    const { hex } = hashSha256(buffer)

    expect(() =>
      CommentImageContentValidator.validate({
        buffer,
        declaredContentType: 'image/png',
        declaredContentLength: buffer.length,
        declaredChecksumSha256: hex,
      }),
    ).not.toThrow()
  })

  it('rechaza el checksum incorrecto', () => {
    const buffer = createPngBuffer()

    expect(() =>
      CommentImageContentValidator.validate({
        buffer,
        declaredContentType: 'image/png',
        declaredContentLength: buffer.length,
        declaredChecksumSha256: 'checksum-equivocado',
      }),
    ).toThrow(CommentImageChecksumMismatchError)
  })

  it('rechaza la longitud declarada distinta de la real', () => {
    const buffer = createPngBuffer()
    const { hex } = hashSha256(buffer)

    expect(() =>
      CommentImageContentValidator.validate({
        buffer,
        declaredContentType: 'image/png',
        declaredContentLength: buffer.length + 10,
        declaredChecksumSha256: hex,
      }),
    ).toThrow(CommentImageLengthMismatchError)
  })

  it('rechaza SVG por motivos de seguridad', () => {
    const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const { hex } = hashSha256(buffer)

    expect(() =>
      CommentImageContentValidator.validate({
        buffer,
        declaredContentType: 'image/png',
        declaredContentLength: buffer.length,
        declaredChecksumSha256: hex,
      }),
    ).toThrow(CommentImageInvalidContentError)
  })

  it('rechaza magic bytes que no corresponden al MIME declarado', () => {
    const buffer = Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), Buffer.alloc(20)])
    const { hex } = hashSha256(buffer)

    expect(() =>
      CommentImageContentValidator.validate({
        buffer,
        declaredContentType: 'image/jpeg',
        declaredContentLength: buffer.length,
        declaredChecksumSha256: hex,
      }),
    ).toThrow(CommentImageInvalidContentError)
  })

  it('acepta un JPEG valido', () => {
    const buffer = createJpegBuffer()
    const { hex } = hashSha256(buffer)

    const result = CommentImageContentValidator.validate({
      buffer,
      declaredContentType: 'image/jpeg',
      declaredContentLength: buffer.length,
      declaredChecksumSha256: hex,
    })

    expect(result.format).toBe('jpeg')
  })

  it('acepta un WebP valido', () => {
    const buffer = createWebpBuffer()
    const { hex } = hashSha256(buffer)

    const result = CommentImageContentValidator.validate({
      buffer,
      declaredContentType: 'image/webp',
      declaredContentLength: buffer.length,
      declaredChecksumSha256: hex,
    })

    expect(result.format).toBe('webp')
  })

  it('acepta el checksum en formato b64:', () => {
    const buffer = createPngBuffer()
    const { b64 } = hashSha256(buffer)

    expect(() =>
      CommentImageContentValidator.validate({
        buffer,
        declaredContentType: 'image/png',
        declaredContentLength: buffer.length,
        declaredChecksumSha256: `b64:${b64}`,
      }),
    ).not.toThrow()
  })

  it('rechaza un tipo de contenido no admitido', () => {
    const buffer = createPngBuffer()
    const { hex } = hashSha256(buffer)

    expect(() =>
      CommentImageContentValidator.validate({
        buffer,
        declaredContentType: 'image/gif',
        declaredContentLength: buffer.length,
        declaredChecksumSha256: hex,
      }),
    ).toThrow(CommentImageInvalidContentError)
  })

  it('rechaza un archivo demasiado pequeno para ser una imagen valida', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const { hex } = hashSha256(buffer)

    expect(() =>
      CommentImageContentValidator.validate({
        buffer,
        declaredContentType: 'image/png',
        declaredContentLength: buffer.length,
        declaredChecksumSha256: hex,
      }),
    ).toThrow(CommentImageInvalidContentError)
  })
})

describe('isCommentImageAssetStatus', () => {
  it('reconoce los cuatro estados validos y rechaza cualquier otro valor', () => {
    for (const status of ['PENDING', 'READY', 'REJECTED', 'EXPIRED']) {
      expect(isCommentImageAssetStatus(status)).toBe(true)
    }
    expect(isCommentImageAssetStatus('DESCONOCIDO')).toBe(false)
  })
})

describe('CommentImageAsset (dominio)', () => {
  it('rechaza un tipo MIME no admitido al crear la intencion', () => {
    expect(() =>
      CommentImageAsset.createPending({
        assetId: 'asset-1',
        authorId: AUTHOR,
        contentType: 'image/gif',
        contentLength: 100,
        checksumSha256: 'hash',
        stagingKey: 'staging/comments/asset-1',
        imageUrl: 'https://api.test/comment-image-assets/asset-1/content',
        createdAt: new Date(),
        expiresAt: new Date(),
      }),
    ).toThrow(DomainError)
  })

  it('rechaza un tamano fuera de 1 byte a 5 MiB', () => {
    expect(() =>
      CommentImageAsset.createPending({
        assetId: 'asset-1',
        authorId: AUTHOR,
        contentType: 'image/png',
        contentLength: 6 * 1024 * 1024,
        checksumSha256: 'hash',
        stagingKey: 'staging/comments/asset-1',
        imageUrl: 'https://api.test/comment-image-assets/asset-1/content',
        createdAt: new Date(),
        expiresAt: new Date(),
      }),
    ).toThrow(DomainError)
  })

  it('markFinalized es idempotente: una segunda llamada no cambia targetKey ni finalizedAt', () => {
    const original = CommentImageAsset.createPending({
      assetId: 'asset-1',
      authorId: AUTHOR,
      contentType: 'image/png',
      contentLength: 100,
      checksumSha256: 'hash',
      stagingKey: 'staging/comments/asset-1',
      imageUrl: 'https://api.test/comment-image-assets/asset-1/content',
      createdAt: new Date('2026-09-04T00:00:00.000Z'),
      expiresAt: new Date('2026-09-04T00:10:00.000Z'),
    })

    original.markFinalized({
      targetKey: 'assets/comments/asset-1/hash.png',
      finalizedAt: new Date('2026-09-04T00:05:00.000Z'),
    })
    original.markFinalized({
      targetKey: 'assets/comments/asset-1/otro.png',
      finalizedAt: new Date('2026-09-04T00:06:00.000Z'),
    })

    expect(original.targetKey).toBe('assets/comments/asset-1/hash.png')
    expect(original.finalizedAt).toEqual(new Date('2026-09-04T00:05:00.000Z'))
  })
})

describe('El flujo de carga real de imagenes de comentario (HU-40.1, EN-028)', () => {
  let clock: ClockPort
  let idGenerator: IdGeneratorPort
  let currentTime: Date
  let nextId: string

  const build = (): {
    storage: InMemoryCommentImageStorageAdapter
    repository: InMemoryCommentImageAssetRepository
    createUploadIntent: CreateCommentImageUploadIntent
    finalizeAsset: FinalizeCommentImageAsset
    getContent: GetCommentImageContent
  } => {
    const storage = new InMemoryCommentImageStorageAdapter()
    const repository = new InMemoryCommentImageAssetRepository()

    return {
      storage,
      repository,
      createUploadIntent: new CreateCommentImageUploadIntent({
        storage,
        repository,
        idGenerator,
        clock,
        apiBaseUrl: 'https://api.test.com',
      }),
      finalizeAsset: new FinalizeCommentImageAsset({ storage, repository, clock }),
      getContent: new GetCommentImageContent({ storage, repository }),
    }
  }

  beforeEach(() => {
    currentTime = new Date('2026-09-04T20:00:00.000Z')
    nextId = 'f293ce6b-98e9-41da-99ef-0ad4e3a95120'
    clock = { now: (): Date => currentTime }
    idGenerator = { generate: (): string => nextId }
  })

  it('crea una intencion de carga con vigencia de 10 minutos, con clave anidada bajo comments/', async () => {
    const { createUploadIntent, repository } = build()
    const buffer = createPngBuffer()
    const { hex } = hashSha256(buffer)

    const response = await createUploadIntent.execute({
      authorId: AUTHOR,
      contentType: 'image/png',
      contentLength: buffer.length,
      checksumSha256: `b64:${hex}`,
    })

    expect(response.assetId).toBe(nextId)
    expect(response.upload.method).toBe('POST')
    expect(response.upload.fields.key).toBe(`staging/comments/${nextId}`)
    expect(response.upload.expiresAt).toBe('2026-09-04T20:10:00.000Z')

    const saved = await repository.findById(nextId)
    expect(saved?.status).toBe(CommentImageAssetStatus.Pending)
    expect(saved?.authorId).toBe(AUTHOR)
    expect(saved?.imageUrl).toBe(`https://api.test.com/api/comment-image-assets/${nextId}/content`)
  })

  it('finaliza exitosamente, promueve el archivo a assets/comments/ y lo deja READY', async () => {
    const { createUploadIntent, finalizeAsset, storage } = build()
    const buffer = createPngBuffer()
    const hash = hashSha256(buffer)

    const intent = await createUploadIntent.execute({
      authorId: AUTHOR,
      contentType: 'image/png',
      contentLength: buffer.length,
      checksumSha256: hash.hex,
    })

    storage.putObjectDirectly(intent.upload.fields.key ?? '', buffer, 'image/png')

    const finalized = await finalizeAsset.execute(intent.assetId, AUTHOR)

    expect(finalized.status).toBe(CommentImageAssetStatus.Ready)
    expect(storage.hasObject(`staging/comments/${intent.assetId}`)).toBe(false)
    expect(storage.hasObject(`assets/comments/${intent.assetId}/${hash.hex}.png`)).toBe(true)

    // Idempotencia: una segunda finalizacion no falla ni reprocesa.
    const second = await finalizeAsset.execute(intent.assetId, AUTHOR)
    expect(second.status).toBe(CommentImageAssetStatus.Ready)
  })

  it('rechaza finalizar una imagen de otro autor (403)', async () => {
    const { createUploadIntent, finalizeAsset, storage } = build()
    const buffer = createPngBuffer()

    const intent = await createUploadIntent.execute({
      authorId: AUTHOR,
      contentType: 'image/png',
      contentLength: buffer.length,
      checksumSha256: hashSha256(buffer).hex,
    })
    storage.putObjectDirectly(intent.upload.fields.key ?? '', buffer, 'image/png')

    await expect(finalizeAsset.execute(intent.assetId, OTHER_AUTHOR)).rejects.toBeInstanceOf(
      CommentImageAssetOwnershipError,
    )
  })

  it('rechaza la finalizacion si la intencion expiro (> 10 min)', async () => {
    const { createUploadIntent, finalizeAsset, storage } = build()
    const buffer = createPngBuffer()

    const intent = await createUploadIntent.execute({
      authorId: AUTHOR,
      contentType: 'image/png',
      contentLength: buffer.length,
      checksumSha256: hashSha256(buffer).hex,
    })
    storage.putObjectDirectly(intent.upload.fields.key ?? '', buffer, 'image/png')

    currentTime = new Date(currentTime.getTime() + 11 * 60 * 1000)

    await expect(finalizeAsset.execute(intent.assetId, AUTHOR)).rejects.toBeInstanceOf(
      CommentImageAssetExpiredError,
    )
  })

  it('un assetId inexistente es 404, no 422', async () => {
    const { finalizeAsset } = build()

    await expect(finalizeAsset.execute('no-existe', AUTHOR)).rejects.toBeInstanceOf(
      CommentImageAssetNotFoundError,
    )
  })

  it('GetCommentImageContent devuelve la URL firmada solo si la imagen esta READY', async () => {
    const { createUploadIntent, finalizeAsset, getContent, storage } = build()
    const buffer = createPngBuffer()

    const intent = await createUploadIntent.execute({
      authorId: AUTHOR,
      contentType: 'image/png',
      contentLength: buffer.length,
      checksumSha256: hashSha256(buffer).hex,
    })

    await expect(getContent.execute(intent.assetId)).rejects.toBeInstanceOf(
      CommentImageAssetNotFoundError,
    )

    storage.putObjectDirectly(intent.upload.fields.key ?? '', buffer, 'image/png')
    await finalizeAsset.execute(intent.assetId, AUTHOR)

    const url = await getContent.execute(intent.assetId)
    expect(url).toContain(`assets/comments/${intent.assetId}`)
  })

  it('rechaza finalizar una imagen que ya fue rechazada (ni PENDING ni READY)', async () => {
    const { finalizeAsset, repository } = build()

    const rejected = CommentImageAsset.fromSnapshot({
      assetId: 'asset-rechazado',
      authorId: AUTHOR,
      status: 'REJECTED',
      contentType: 'image/png',
      contentLength: 100,
      checksumSha256: 'hash',
      stagingKey: 'staging/comments/asset-rechazado',
      imageUrl: 'https://api.test/comment-image-assets/asset-rechazado/content',
      createdAt: currentTime,
      expiresAt: new Date(currentTime.getTime() + 600_000),
    })
    await repository.save(rejected)

    await expect(finalizeAsset.execute('asset-rechazado', AUTHOR)).rejects.toBeInstanceOf(
      CommentImageAssetConflictError,
    )
  })

  it('rechaza si el archivo en staging esta vacio (nunca llego a subirse)', async () => {
    const { createUploadIntent, finalizeAsset, storage } = build()
    const buffer = createPngBuffer()

    const intent = await createUploadIntent.execute({
      authorId: AUTHOR,
      contentType: 'image/png',
      contentLength: buffer.length,
      checksumSha256: hashSha256(buffer).hex,
    })
    storage.putObjectDirectly(intent.upload.fields.key ?? '', Buffer.alloc(0), 'image/png')

    await expect(finalizeAsset.execute(intent.assetId, AUTHOR)).rejects.toBeInstanceOf(
      CommentImageAssetNotFoundError,
    )
  })
})

describe('InMemoryCommentImageStorageAdapter', () => {
  it('rechaza getObject sobre una clave que no existe', async () => {
    const storage = new InMemoryCommentImageStorageAdapter()

    await expect(storage.getObject('staging/comments/no-existe')).rejects.toThrow()
  })

  it('rechaza promoteObject si el objeto de staging no existe', async () => {
    const storage = new InMemoryCommentImageStorageAdapter()

    await expect(
      storage.promoteObject('staging/comments/no-existe', 'assets/comments/no-existe/hash.png'),
    ).rejects.toThrow()
  })

  it('rechaza getPresignedDownloadUrl sobre una clave que no existe', async () => {
    const storage = new InMemoryCommentImageStorageAdapter()

    await expect(
      storage.getPresignedDownloadUrl('assets/comments/no-existe/hash.png'),
    ).rejects.toThrow()
  })

  it('deleteObject sobre una clave inexistente no falla', async () => {
    const storage = new InMemoryCommentImageStorageAdapter()

    await expect(storage.deleteObject('staging/comments/no-existe')).resolves.toBeUndefined()
  })
})
