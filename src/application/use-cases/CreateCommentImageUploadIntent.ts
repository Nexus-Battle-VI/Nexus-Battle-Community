import { CommentImageAsset } from '../../domain/entities/CommentImageAsset'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { CommentImageAssetRepositoryPort } from '../ports/CommentImageAssetRepositoryPort'
import type { CommentImageStoragePort } from '../ports/CommentImageStoragePort'

export interface CreateCommentImageUploadIntentInput {
  readonly authorId: string
  readonly contentType: string
  readonly contentLength: number
  readonly checksumSha256: string
}

export interface CommentImageUploadIntentDto {
  readonly assetId: string
  readonly upload: {
    readonly method: 'POST'
    readonly url: string
    readonly fields: Record<string, string>
    readonly expiresAt: string
  }
}

export interface CreateCommentImageUploadIntentDependencies {
  readonly storage: CommentImageStoragePort
  readonly repository: CommentImageAssetRepositoryPort
  readonly idGenerator: IdGeneratorPort
  readonly clock: ClockPort
  readonly apiBaseUrl: string
}

/**
 * Crea la intencion de carga directa a S3 para la imagen de un comentario
 * (HU-40.1, EN-028). Mismo flujo de dos fases que
 * `CreateProductAssetUploadIntent` en Catalog: esta Task solo persiste la
 * intencion y devuelve el formulario firmado; el binario nunca pasa por este
 * servicio.
 */
export class CreateCommentImageUploadIntent {
  private static readonly INTENT_EXPIRY_SECONDS = 600

  constructor(private readonly deps: CreateCommentImageUploadIntentDependencies) {}

  async execute(input: CreateCommentImageUploadIntentInput): Promise<CommentImageUploadIntentDto> {
    const assetId = this.deps.idGenerator.generate()
    const now = this.deps.clock.now()
    const expiresAt = new Date(
      now.getTime() + CreateCommentImageUploadIntent.INTENT_EXPIRY_SECONDS * 1000,
    )
    // Prefijo propio bajo el mismo bucket de Catalog (EN-028): `staging/` y
    // `assets/` ya estan autorizados por el rol del nodo compartido, y
    // anidar `comments/` evita cualquier colision con las claves de Catalog.
    const stagingKey = `staging/comments/${assetId}`

    const baseUrl = this.deps.apiBaseUrl.replace(/\/+$/, '')
    const imageUrl = `${baseUrl}/api/comment-image-assets/${assetId}/content`

    const asset = CommentImageAsset.createPending({
      assetId,
      authorId: input.authorId,
      contentType: input.contentType,
      contentLength: input.contentLength,
      checksumSha256: input.checksumSha256,
      stagingKey,
      imageUrl,
      createdAt: now,
      expiresAt,
    })

    const uploadIntent = await this.deps.storage.createUploadIntent({
      assetId,
      contentType: input.contentType,
      contentLength: input.contentLength,
      checksumSha256: input.checksumSha256,
      expiresInSeconds: CreateCommentImageUploadIntent.INTENT_EXPIRY_SECONDS,
    })

    await this.deps.repository.save(asset)

    return {
      assetId,
      upload: {
        method: 'POST',
        url: uploadIntent.uploadUrl,
        fields: uploadIntent.fields,
        expiresAt: expiresAt.toISOString(),
      },
    }
  }
}
