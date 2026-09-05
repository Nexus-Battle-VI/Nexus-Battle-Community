/**
 * Errores de la capa de aplicacion. Describen el resultado del caso de uso sin
 * conocer el protocolo: la traduccion a HTTP ocurre en el adaptador de entrada.
 */
export class ThreadNotFoundError extends Error {
  constructor(id: string) {
    super(`No existe un hilo identificado por "${id}".`)
    this.name = 'ThreadNotFoundError'
  }
}

export class ProductNotFoundError extends Error {
  constructor(productId: string) {
    super(`No existe un producto identificado por "${productId}".`)
    this.name = 'ProductNotFoundError'
  }
}

/**
 * Un jugador ya registro una calificacion sobre ese producto.
 *
 * La restriccion es de la combinacion jugador + producto, no del jugador ni
 * del producto por separado: el mismo jugador puede calificar productos
 * distintos, y el mismo producto puede recibir calificaciones de jugadores
 * distintos.
 */
export class DuplicateProductReviewError extends Error {
  constructor(productId: string) {
    super(`Ya existe una calificacion de este jugador para el producto "${productId}".`)
    this.name = 'DuplicateProductReviewError'
  }
}

export class CommentNotFoundError extends Error {
  constructor(commentId: string) {
    super(`No existe un comentario identificado por "${commentId}".`)
    this.name = 'CommentNotFoundError'
  }
}

/**
 * El jugador excedio el limite de reportes permitido dentro de la ventana de
 * tiempo vigente (HU-46.3). No es un dato mal formado ni un conflicto de
 * unicidad: es una limitacion de tasa, y se traduce a 429 en el adaptador de
 * entrada.
 */
export class ReportLimitExceededError extends Error {
  constructor(authorId: string, limit: number, windowHours: number) {
    super(
      `El jugador "${authorId}" alcanzo el limite de ${String(limit)} reportes en las ultimas ${String(windowHours)} horas.`,
    )
    this.name = 'ReportLimitExceededError'
  }
}

/**
 * Errores de la imagen adjunta a un comentario (HU-40, EN-028). Mismo criterio
 * de traduccion HTTP que sus equivalentes de Catalog (ADR-016): un dato
 * rechazado es 404/409/422, nunca 500.
 */
export class CommentImageAssetNotFoundError extends Error {
  constructor(assetId: string) {
    super(`No existe una imagen identificada por "${assetId}".`)
    this.name = 'CommentImageAssetNotFoundError'
  }
}

export class CommentImageAssetExpiredError extends Error {
  constructor(assetId: string) {
    super(`La intencion de carga de la imagen "${assetId}" ha expirado.`)
    this.name = 'CommentImageAssetExpiredError'
  }
}

export class CommentImageAssetConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommentImageAssetConflictError'
  }
}

/** El autor que finaliza no es el mismo que solicito la intencion de carga. */
export class CommentImageAssetOwnershipError extends Error {
  constructor(assetId: string) {
    super(`La imagen "${assetId}" no pertenece al jugador que intenta finalizarla.`)
    this.name = 'CommentImageAssetOwnershipError'
  }
}

export class CommentImageInvalidContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommentImageInvalidContentError'
  }
}

export class CommentImageChecksumMismatchError extends Error {
  constructor() {
    super('Checksum SHA-256 no coincide con el archivo cargado.')
    this.name = 'CommentImageChecksumMismatchError'
  }
}

export class CommentImageLengthMismatchError extends Error {
  constructor(actual: number, declared: number) {
    super(
      `La longitud del archivo (${String(actual)}) no coincide con la longitud declarada (${String(declared)}).`,
    )
    this.name = 'CommentImageLengthMismatchError'
  }
}

export class CommentImageStorageUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommentImageStorageUnavailableError'
  }
}
