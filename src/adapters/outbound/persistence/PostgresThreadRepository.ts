import type { Kysely, Transaction } from 'kysely'

import { Thread } from '../../../domain/entities/Thread'
import {
  AuthorId,
  PostContent,
  PostId,
  ThreadId,
  ThreadTitle,
} from '../../../domain/value-objects/community-values'
import type {
  OwnedPostRecord,
  ThreadRepositoryPort,
} from '../../../application/ports/ThreadRepositoryPort'
import type { ThreadSnapshot } from '../../../domain/entities/Thread'
import type { Database } from './schema'
import { toPostRows, toSnapshot, toThreadRow, type PostRow, type ThreadRow } from './mapping'

/**
 * Repositorio del agregado Thread sobre PostgreSQL, con Kysely.
 *
 * Cada consulta esta escrita a la vista. No hay carga perezosa que pueda
 * disparar consultas dentro de un bucle sin que aparezcan en el codigo, que es
 * la razon por la que ADR-012 eligio un constructor de consultas y no un ORM.
 */
export class PostgresThreadRepository implements ThreadRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  /**
   * Guarda el agregado entero, hilo y mensajes, en una sola transaccion.
   *
   * A diferencia de los roles de una cuenta —tres como mucho—, un hilo admite
   * hasta 500 mensajes. Borrarlos e insertarlos de nuevo en cada guardado
   * significaria reescribir 500 filas para publicar UNA, asi que se insertan con
   * `on conflict` y solo se actualiza la fila que de verdad cambio: la clausula
   * `where` compara con `excluded` y descarta las que ya coinciden. Sin ella,
   * PostgreSQL escribiria una version nueva de cada fila igualmente, porque una
   * actualizacion que no cambia nada sigue siendo una escritura.
   *
   * Los mensajes que el agregado ya no tiene se borran: el agregado es la
   * autoridad sobre su contenido.
   */
  async save(thread: Thread): Promise<void> {
    const snapshot = thread.toSnapshot()
    const threadRow = toThreadRow(snapshot)
    const postRows = toPostRows(snapshot)

    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('threads')
        .values(threadRow)
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            title: threadRow.title,
            author_id: threadRow.author_id,
            status: threadRow.status,
            updated_at: new Date(),
          }),
        )
        .execute()

      await PostgresThreadRepository.replacePosts(trx, snapshot.id, postRows)
    })
  }

  private static async replacePosts(
    trx: Transaction<Database>,
    threadId: string,
    rows: readonly PostRow[],
  ): Promise<void> {
    // Primero se retira lo que sobra. Si se insertara antes, un mensaje movido
    // a una posicion que otro aun ocupa chocaria con la restriccion de unicidad.
    let removal = trx.deleteFrom('posts').where('thread_id', '=', threadId)

    if (rows.length > 0) {
      removal = removal.where(
        'id',
        'not in',
        rows.map((row) => row.id),
      )
    }

    await removal.execute()

    if (rows.length === 0) {
      return
    }

    await trx
      .insertInto('posts')
      .values([...rows])
      .onConflict((oc) =>
        oc
          .column('id')
          .doUpdateSet((eb) => ({
            position: eb.ref('excluded.position'),
            content: eb.ref('excluded.content'),
            hidden: eb.ref('excluded.hidden'),
          }))
          // Solo se reescribe la fila que cambio de verdad. `content` entra en
          // la comparacion aunque hoy sea inmutable: si el dominio llegara a
          // permitir editarlo, omitirlo aqui lo descartaria en silencio.
          .where((eb) =>
            eb.or([
              eb('posts.position', '!=', eb.ref('excluded.position')),
              eb('posts.content', '!=', eb.ref('excluded.content')),
              eb('posts.hidden', '!=', eb.ref('excluded.hidden')),
            ]),
          ),
      )
      .execute()
  }

  async findById(id: ThreadId): Promise<Thread | null> {
    const row = await this.db
      .selectFrom('threads')
      .selectAll()
      .where('id', '=', id.value)
      .executeTakeFirst()

    if (row === undefined) {
      return null
    }

    const posts = await this.db
      .selectFrom('posts')
      .selectAll()
      .where('thread_id', '=', id.value)
      .orderBy('position')
      .execute()

    return PostgresThreadRepository.hydrate(row, posts)
  }

  /**
   * Lee todos los hilos con sus mensajes en DOS consultas, no en una por hilo.
   *
   * Lo ingenuo seria recorrer los hilos y pedir los mensajes de cada uno: con
   * cincuenta hilos son cincuenta y una consultas. Se traen todos los mensajes
   * de los hilos leidos de una vez y se agrupan en memoria.
   *
   * No hay paginacion porque el puerto no la ofrece todavia. Es una deuda
   * consciente: cuando el numero de hilos crezca, esto habra que acotarlo, y el
   * cambio sera del puerto y de los casos de uso, no solo del adaptador.
   */
  async list(): Promise<readonly Thread[]> {
    const rows = await this.db.selectFrom('threads').selectAll().orderBy('id').execute()

    if (rows.length === 0) {
      return []
    }

    const posts = await this.db
      .selectFrom('posts')
      .selectAll()
      .where(
        'thread_id',
        'in',
        rows.map((row) => row.id),
      )
      .orderBy('position')
      .execute()

    const byThread = new Map<string, PostRow[]>()

    for (const post of posts) {
      const bucket = byThread.get(post.thread_id)

      if (bucket === undefined) {
        byThread.set(post.thread_id, [post])
      } else {
        bucket.push(post)
      }
    }

    return rows.map((row) => PostgresThreadRepository.hydrate(row, byThread.get(row.id) ?? []))
  }

  async findPostsByAuthor(authorId: AuthorId): Promise<readonly OwnedPostRecord[]> {
    const rows = await this.db
      .selectFrom('posts')
      .select(['id', 'thread_id', 'content', 'created_at'])
      .where('author_id', '=', authorId.value)
      .orderBy('created_at')
      .orderBy('id')
      .execute()

    return rows.map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      content: row.content,
      createdAt: row.created_at.toISOString(),
    }))
  }

  private static hydrate(row: ThreadRow, posts: readonly PostRow[]): Thread {
    const snapshot: ThreadSnapshot = toSnapshot(row, posts)

    return Thread.restore({
      id: ThreadId.create(snapshot.id),
      title: ThreadTitle.create(snapshot.title),
      authorId: AuthorId.create(snapshot.authorId),
      status: snapshot.status,
      posts: snapshot.posts.map((post) => ({
        id: PostId.create(post.id),
        authorId: AuthorId.create(post.authorId),
        content: PostContent.create(post.content),
        hidden: post.hidden,
        createdAt: new Date(post.createdAt),
      })),
    })
  }
}
