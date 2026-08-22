import type { Thread } from '../../domain/entities/Thread'
import type { ThreadId } from '../../domain/value-objects/community-values'

/**
 * Puerto de persistencia del agregado Thread.
 *
 * Community es propietario exclusivo de sus datos. Ningun otro servicio accede
 * a este almacen, ni directamente ni mediante claves foraneas.
 *
 * El adaptador definitivo sobre PostgreSQL queda sujeto a ADR-005.
 */
export interface ThreadRepositoryPort {
  save(thread: Thread): Promise<void>
  findById(id: ThreadId): Promise<Thread | null>
  list(): Promise<readonly Thread[]>
}

export const THREAD_REPOSITORY = Symbol('ThreadRepositoryPort')
