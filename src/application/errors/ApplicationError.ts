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
