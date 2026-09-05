export interface CommentImageUploadIntentResult {
  readonly uploadUrl: string
  readonly fields: Record<string, string>
  readonly expiresAt: Date
  readonly stagingKey: string
}

/**
 * Puerto de almacenamiento de imagenes de comentario (HU-40, EN-028).
 *
 * Mismo contrato minimo que `ProductAssetStoragePort` en Catalog, sin los
 * metodos que solo sirven a la reconciliacion (`listObjectsWithPrefix`) ni a
 * la lectura de metadatos crudos (`getObjectMetadata`): esta primera entrega
 * no incluye reconciliacion de huerfanos, igual que Catalog la dejo fuera de
 * su primer Task de carga real.
 */
export interface CommentImageStoragePort {
  /** Genera el formulario firmado para carga directa a S3 (10 min de vigencia). */
  createUploadIntent(params: {
    assetId: string
    contentType: string
    contentLength: number
    checksumSha256: string
    expiresInSeconds: number
  }): Promise<CommentImageUploadIntentResult>

  /** Obtiene el contenido binario del objeto desde el almacenamiento. */
  getObject(key: string): Promise<Buffer>

  /** Promociona el objeto de staging/ a assets/ de forma inmutable y elimina staging. */
  promoteObject(stagingKey: string, targetKey: string): Promise<void>

  /** Elimina un objeto del almacenamiento (staging huerfano o compensacion). */
  deleteObject(key: string): Promise<void>

  /** Genera una URL firmada de descarga temporal (maximo 5 minutos). */
  getPresignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>
}

export const COMMENT_IMAGE_STORAGE = Symbol('CommentImageStoragePort')
