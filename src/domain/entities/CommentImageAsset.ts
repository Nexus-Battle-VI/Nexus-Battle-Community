import { DomainError } from '../errors/DomainError'

/**
 * Imagen adjunta a un comentario de producto (HU-40, CA-01; EN-028).
 *
 * Mismo patron de dos fases que `ProductAsset` en Catalog (ADR-016): una
 * intencion `PENDING` con una clave de `staging/`, y una promocion a
 * `assets/` inmutable tras validar el contenido real. La diferencia
 * deliberada es el alcance: EN-028 aprobo un contrato mas simple para
 * comentarios -sin deteccion de animacion ni limites de dimension-, asi que
 * esta entidad no rastrea ancho/alto ni proposito: una imagen de comentario
 * tiene un unico uso posible.
 */
export const CommentImageAssetStatus = {
  Pending: 'PENDING',
  Ready: 'READY',
  Rejected: 'REJECTED',
  Expired: 'EXPIRED',
} as const

export type CommentImageAssetStatus =
  (typeof CommentImageAssetStatus)[keyof typeof CommentImageAssetStatus]

const ALL_COMMENT_IMAGE_ASSET_STATUSES: readonly CommentImageAssetStatus[] = [
  CommentImageAssetStatus.Pending,
  CommentImageAssetStatus.Ready,
  CommentImageAssetStatus.Rejected,
  CommentImageAssetStatus.Expired,
]

export const isCommentImageAssetStatus = (value: string): value is CommentImageAssetStatus =>
  (ALL_COMMENT_IMAGE_ASSET_STATUSES as readonly string[]).includes(value)

const MAX_CONTENT_LENGTH = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export interface CommentImageAssetSnapshot {
  readonly assetId: string
  readonly authorId: string
  readonly status: CommentImageAssetStatus
  readonly contentType: string
  readonly contentLength: number
  readonly checksumSha256: string
  readonly stagingKey: string
  readonly targetKey?: string
  readonly imageUrl: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly finalizedAt?: Date
}

export class CommentImageAsset {
  readonly assetId: string
  /**
   * Autor que solicito la intencion de carga. Finalizar exige el mismo
   * autor: sin esto, cualquier jugador podria finalizar una intencion ajena
   * y adjuntar la imagen de otro a su propio comentario.
   */
  readonly authorId: string
  private _status: CommentImageAssetStatus
  readonly contentType: string
  readonly contentLength: number
  readonly checksumSha256: string
  readonly stagingKey: string
  private _targetKey?: string
  readonly imageUrl: string
  readonly createdAt: Date
  readonly expiresAt: Date
  private _finalizedAt?: Date

  private constructor(params: CommentImageAssetSnapshot) {
    this.assetId = params.assetId
    this.authorId = params.authorId
    this._status = params.status
    this.contentType = params.contentType
    this.contentLength = params.contentLength
    this.checksumSha256 = params.checksumSha256
    this.stagingKey = params.stagingKey
    this._targetKey = params.targetKey
    this.imageUrl = params.imageUrl
    this.createdAt = params.createdAt
    this.expiresAt = params.expiresAt
    this._finalizedAt = params.finalizedAt
  }

  static createPending(params: {
    assetId: string
    authorId: string
    contentType: string
    contentLength: number
    checksumSha256: string
    stagingKey: string
    imageUrl: string
    createdAt: Date
    expiresAt: Date
  }): CommentImageAsset {
    if (params.contentLength <= 0 || params.contentLength > MAX_CONTENT_LENGTH) {
      throw new DomainError('El tamano de la imagen debe estar entre 1 byte y 5 MiB.')
    }

    if (!ALLOWED_MIME_TYPES.includes(params.contentType)) {
      throw new DomainError(
        `Tipo MIME no permitido: "${params.contentType}". Se admiten: ${ALLOWED_MIME_TYPES.join(', ')}.`,
      )
    }

    return new CommentImageAsset({ ...params, status: CommentImageAssetStatus.Pending })
  }

  static fromSnapshot(snapshot: CommentImageAssetSnapshot): CommentImageAsset {
    return new CommentImageAsset(snapshot)
  }

  get status(): CommentImageAssetStatus {
    return this._status
  }

  get targetKey(): string | undefined {
    return this._targetKey
  }

  get finalizedAt(): Date | undefined {
    return this._finalizedAt
  }

  isReady(): boolean {
    return this._status === CommentImageAssetStatus.Ready
  }

  isExpired(now: Date): boolean {
    return (
      this._status === CommentImageAssetStatus.Expired ||
      (this._status === CommentImageAssetStatus.Pending &&
        this.expiresAt.getTime() <= now.getTime())
    )
  }

  markFinalized(params: { targetKey: string; finalizedAt: Date }): void {
    if (this._status === CommentImageAssetStatus.Ready) {
      return
    }

    this._status = CommentImageAssetStatus.Ready
    this._targetKey = params.targetKey
    this._finalizedAt = params.finalizedAt
  }

  markExpired(): void {
    if (this._status === CommentImageAssetStatus.Pending) {
      this._status = CommentImageAssetStatus.Expired
    }
  }

  toSnapshot(): CommentImageAssetSnapshot {
    return {
      assetId: this.assetId,
      authorId: this.authorId,
      status: this._status,
      contentType: this.contentType,
      contentLength: this.contentLength,
      checksumSha256: this.checksumSha256,
      stagingKey: this.stagingKey,
      targetKey: this._targetKey,
      imageUrl: this.imageUrl,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      finalizedAt: this._finalizedAt,
    }
  }
}
