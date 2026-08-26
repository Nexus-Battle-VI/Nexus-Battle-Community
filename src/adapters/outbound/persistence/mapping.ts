import { ThreadStatus } from '../../../domain/entities/Thread'
import type { PostSnapshot, ThreadSnapshot } from '../../../domain/entities/Thread'

/**
 * Traduccion entre filas de PostgreSQL y la instantanea del agregado.
 *
 * Vive aparte del repositorio y es **puro** a proposito: es la parte del
 * adaptador donde de verdad se puede equivocar uno, y sacarla del repositorio
 * permite probarla sin base de datos ni contenedor.
 */

export class PersistenceMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersistenceMappingError'
  }
}

export interface ThreadRow {
  readonly id: string
  readonly title: string
  readonly author_id: string
  readonly status: string
}

export interface PostRow {
  readonly id: string
  readonly thread_id: string
  readonly position: number
  readonly author_id: string
  readonly content: string
  readonly hidden: boolean
  readonly created_at: Date
}

const STATUSES: readonly string[] = Object.values(ThreadStatus)

/**
 * Construye la instantanea a partir de la fila del hilo y sus mensajes.
 *
 * Valida lo que lee en lugar de confiar en la columna. Puede parecer excesivo
 * —la base de datos tiene sus propias restricciones— pero una fila escrita por
 * una version anterior del esquema, o por una migracion a medias, llegaria aqui
 * sin que nada la detuviera. Fallar al leerla es preferible a construir un
 * agregado con un estado que el dominio no reconoce.
 *
 * Los mensajes se ordenan por posicion aqui y no solo en la consulta: el orden
 * es parte del agregado, y depender de que quien consulte se acuerde de pedirlo
 * es depender de que nadie se olvide.
 */
export const toSnapshot = (row: ThreadRow, posts: readonly PostRow[]): ThreadSnapshot => {
  if (!STATUSES.includes(row.status)) {
    throw new PersistenceMappingError(
      `El hilo ${row.id} tiene un estado desconocido: "${row.status}".`,
    )
  }

  const ordered = [...posts].sort((a, b) => a.position - b.position)

  return {
    id: row.id,
    title: row.title,
    authorId: row.author_id,
    status: row.status as ThreadStatus,
    posts: ordered.map(toPostSnapshot),
  }
}

const toPostSnapshot = (post: PostRow): PostSnapshot => ({
  id: post.id,
  authorId: post.author_id,
  content: post.content,
  hidden: post.hidden,
  createdAt: post.created_at.toISOString(),
})

/** Descompone la instantanea en la fila de `threads`. */
export const toThreadRow = (snapshot: ThreadSnapshot): ThreadRow => ({
  id: snapshot.id,
  title: snapshot.title,
  author_id: snapshot.authorId,
  status: snapshot.status,
})

/**
 * Descompone los mensajes en filas, asignando la posicion por su lugar en el
 * agregado. El agregado es la autoridad sobre el orden; la columna solo lo
 * conserva.
 */
export const toPostRows = (snapshot: ThreadSnapshot): readonly PostRow[] =>
  snapshot.posts.map((post, index) => {
    const createdAt = new Date(post.createdAt)

    if (Number.isNaN(createdAt.getTime())) {
      throw new PersistenceMappingError(
        `El mensaje ${post.id} del hilo ${snapshot.id} tiene una fecha invalida: "${post.createdAt}".`,
      )
    }

    return {
      id: post.id,
      thread_id: snapshot.id,
      position: index,
      author_id: post.authorId,
      content: post.content,
      hidden: post.hidden,
      created_at: createdAt,
    }
  })
