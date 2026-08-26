import type { Thread } from '../../domain/entities/Thread'
import type { ThreadId } from '../../domain/value-objects/community-values'

/**
 * Puerto de persistencia del agregado Thread.
 *
 * Community es propietario exclusivo de sus datos. Ningun otro servicio accede
 * a este almacen, ni directamente ni mediante claves foraneas.
 *
 * Hay dos adaptadores, y `PERSISTENCE_DRIVER` elige cual opera:
 * `PostgresThreadRepository` sobre PostgreSQL (ADR-012) y el de memoria.
 *
 * El de memoria NO es un resto del andamiaje: es el que permite que las pruebas
 * del dominio y de los casos de uso corran sin Docker. Ambos cumplen el mismo
 * contrato, incluido el de no filtrar al almacen una mutacion sin guardar.
 */
export interface ThreadRepositoryPort {
  save(thread: Thread): Promise<void>
  findById(id: ThreadId): Promise<Thread | null>
  list(): Promise<readonly Thread[]>
}

export const THREAD_REPOSITORY = Symbol('ThreadRepositoryPort')
