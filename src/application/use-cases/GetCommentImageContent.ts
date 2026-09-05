import { CommentImageAssetNotFoundError } from '../errors/ApplicationError'
import type { CommentImageAssetRepositoryPort } from '../ports/CommentImageAssetRepositoryPort'
import type { CommentImageStoragePort } from '../ports/CommentImageStoragePort'

export interface GetCommentImageContentDependencies {
  readonly storage: CommentImageStoragePort
  readonly repository: CommentImageAssetRepositoryPort
}

/**
 * Resuelve la referencia estable de una imagen de comentario a una URL
 * firmada de lectura temporal (HU-40, EN-028). Mismo patron que
 * `GetProductAssetContent` en Catalog: la URL firmada nunca se persiste, y la
 * ruta publica es la unica referencia que sobrevive en el comentario.
 */
export class GetCommentImageContent {
  private static readonly DOWNLOAD_EXPIRY_SECONDS = 300

  constructor(private readonly deps: GetCommentImageContentDependencies) {}

  async execute(assetId: string): Promise<string> {
    const asset = await this.deps.repository.findById(assetId)
    if (!asset || !asset.isReady() || !asset.targetKey) {
      throw new CommentImageAssetNotFoundError(assetId)
    }

    return await this.deps.storage.getPresignedDownloadUrl(
      asset.targetKey,
      GetCommentImageContent.DOWNLOAD_EXPIRY_SECONDS,
    )
  }
}
