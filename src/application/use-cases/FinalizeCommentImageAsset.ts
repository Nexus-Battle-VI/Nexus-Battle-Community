import { CommentImageContentValidator } from '../../domain/services/CommentImageContentValidator'
import {
  CommentImageAssetConflictError,
  CommentImageAssetExpiredError,
  CommentImageAssetNotFoundError,
  CommentImageAssetOwnershipError,
} from '../errors/ApplicationError'
import type { ClockPort } from '../ports/ClockPort'
import type { CommentImageAssetRepositoryPort } from '../ports/CommentImageAssetRepositoryPort'
import type { CommentImageStoragePort } from '../ports/CommentImageStoragePort'

export interface FinalizedCommentImageDto {
  readonly assetId: string
  readonly status: string
  readonly contentType: string
  readonly contentLength: number
  readonly checksumSha256: string
  readonly imageUrl: string
}

export interface FinalizeCommentImageAssetDependencies {
  readonly storage: CommentImageStoragePort
  readonly repository: CommentImageAssetRepositoryPort
  readonly clock: ClockPort
}

/**
 * Verifica el contenido cargado y promueve la imagen a su clave inmutable
 * (HU-40.1, EN-028). Mismo flujo que `FinalizeProductAsset` en Catalog, sin
 * dimensiones ni deteccion de animacion: EN-028 aprobo un contrato mas simple
 * para comentarios.
 */
export class FinalizeCommentImageAsset {
  constructor(private readonly deps: FinalizeCommentImageAssetDependencies) {}

  async execute(assetId: string, authorId: string): Promise<FinalizedCommentImageDto> {
    const asset = await this.deps.repository.findById(assetId)
    if (!asset) {
      throw new CommentImageAssetNotFoundError(assetId)
    }

    if (asset.authorId !== authorId) {
      throw new CommentImageAssetOwnershipError(assetId)
    }

    if (asset.isReady()) {
      return {
        assetId: asset.assetId,
        status: asset.status,
        contentType: asset.contentType,
        contentLength: asset.contentLength,
        checksumSha256: asset.checksumSha256,
        imageUrl: asset.imageUrl,
      }
    }

    const now = this.deps.clock.now()

    if (asset.isExpired(now)) {
      asset.markExpired()
      await this.deps.repository.update(asset)
      throw new CommentImageAssetExpiredError(assetId)
    }

    if (asset.status !== 'PENDING') {
      throw new CommentImageAssetConflictError(
        `La imagen "${assetId}" se encuentra en estado "${asset.status}".`,
      )
    }

    const buffer = await this.deps.storage.getObject(asset.stagingKey)
    if (buffer.length === 0) {
      throw new CommentImageAssetNotFoundError(
        `No se encontro el archivo cargado en "${asset.stagingKey}".`,
      )
    }

    const validated = CommentImageContentValidator.validate({
      buffer,
      declaredContentType: asset.contentType,
      declaredContentLength: asset.contentLength,
      declaredChecksumSha256: asset.checksumSha256,
    })

    const ext = validated.format === 'jpeg' ? 'jpg' : validated.format
    const targetKey = `assets/comments/${asset.assetId}/${validated.sha256Hex}.${ext}`

    await this.deps.storage.promoteObject(asset.stagingKey, targetKey)

    asset.markFinalized({ targetKey, finalizedAt: now })

    await this.deps.repository.update(asset)

    return {
      assetId: asset.assetId,
      status: asset.status,
      contentType: asset.contentType,
      contentLength: asset.contentLength,
      checksumSha256: asset.checksumSha256,
      imageUrl: asset.imageUrl,
    }
  }
}
