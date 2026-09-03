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
