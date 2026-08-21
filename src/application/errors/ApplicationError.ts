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
