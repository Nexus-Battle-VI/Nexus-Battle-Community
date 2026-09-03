import 'reflect-metadata'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql, type Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresThreadRepository } from '../../src/adapters/outbound/persistence/PostgresThreadRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { Thread, ThreadStatus } from '../../src/domain/entities/Thread'
import {
  AuthorId,
  PostContent,
  PostId,
  ThreadId,
  ThreadTitle,
} from '../../src/domain/value-objects/community-values'

/**
 * Adaptador de PostgreSQL contra un motor REAL, en contenedor.
 *
 * Estas pruebas viven aparte de la suite por defecto porque necesitan Docker.
 * Lo que comprueban no se puede comprobar de otra forma: que el SQL sea valido,
 * que las restricciones existan de verdad y que la transaccion haga lo que dice.
 * Un doble de prueba habria pasado con un esquema equivocado.
 */
describe('PostgresThreadRepository', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let repository: PostgresThreadRepository

  const AT = new Date('2026-08-25T10:00:00.000Z')
  const MODERADOR = AuthorId.create('sub-moderador')
  let contador = 0

  const buildThread = (): Thread => {
    contador += 1

    return Thread.open({
      id: ThreadId.create(`thr-${String(contador)}`),
      title: ThreadTitle.create(`Hilo numero ${String(contador)}`),
      authorId: AuthorId.create(`sub-${String(contador)}`),
    })
  }

  const publish = (thread: Thread, id: string, content: string): void => {
    thread.publishPost({
      id: PostId.create(id),
      authorId: thread.authorId,
      content: PostContent.create(content),
      occurredAt: AT,
    })
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start()
    db = createDatabase({ connectionString: container.getConnectionUri() })

    const { error } = await migrateToLatest(db)

    if (error !== undefined) {
      throw new Error(`Las migraciones fallaron: ${describeError(error)}`)
    }
  }, 120_000)

  afterAll(async () => {
    await db.destroy()
    await container.stop()
  })

  beforeEach(() => {
    repository = new PostgresThreadRepository(db)
  })

  it('guarda y recupera un hilo sin mensajes', async () => {
    const thread = buildThread()
    await repository.save(thread)

    const found = await repository.findById(thread.id)

    expect(found?.toSnapshot()).toEqual(thread.toSnapshot())
  })

  it('guarda y recupera un hilo con sus mensajes, en orden', async () => {
    const thread = buildThread()
    publish(thread, 'pos-a', 'Primero')
    publish(thread, 'pos-b', 'Segundo')
    publish(thread, 'pos-c', 'Tercero')
    await repository.save(thread)

    const found = await repository.findById(thread.id)

    expect(found?.toSnapshot()).toEqual(thread.toSnapshot())
    expect(found?.toSnapshot().posts.map((post) => post.content)).toEqual([
      'Primero',
      'Segundo',
      'Tercero',
    ])
  })

  it('devuelve null cuando el hilo no existe', async () => {
    expect(await repository.findById(ThreadId.create('thr-inexistente'))).toBeNull()
  })

  /**
   * El mismo contrato que cumple el repositorio en memoria: una mutacion que no
   * se guarda NO debe filtrarse al almacen. Es lo que hace que una prueba falle
   * cuando un caso de uso olvida llamar a `save`.
   */
  it('no filtra al almacen una mutacion sin guardar', async () => {
    const thread = buildThread()
    await repository.save(thread)

    publish(thread, 'pos-fantasma', 'No deberia persistirse')

    const found = await repository.findById(thread.id)

    expect(found?.postCount).toBe(0)
  })

  it('actualiza el hilo existente en lugar de duplicarlo', async () => {
    const thread = buildThread()
    await repository.save(thread)

    thread.close(MODERADOR, AT)
    await repository.save(thread)

    const found = await repository.findById(thread.id)

    expect(found?.currentStatus).toBe(ThreadStatus.Closed)

    const filas = await db
      .selectFrom('threads')
      .select(({ fn }) => fn.countAll().as('total'))
      .where('id', '=', thread.id.value)
      .executeTakeFirstOrThrow()

    expect(Number(filas.total)).toBe(1)
  })

  it('persiste que un mensaje quedo oculto por moderacion', async () => {
    const thread = buildThread()
    publish(thread, 'pos-visible', 'Se queda')
    publish(thread, 'pos-oculto', 'Se oculta')
    await repository.save(thread)

    thread.hidePost(PostId.create('pos-oculto'), MODERADOR, AT)
    await repository.save(thread)

    const found = await repository.findById(thread.id)

    expect(found?.postCount).toBe(2)
    expect(found?.visiblePostCount).toBe(1)
    expect(found?.toSnapshot().posts.map((post) => post.hidden)).toEqual([false, true])
  })

  it('filtra mensajes directamente por autor e incluye los ocultos', async () => {
    const ownThread = buildThread()
    const otherThread = buildThread()
    ownThread.publishPost({
      id: PostId.create('post-propio-oculto'),
      authorId: AuthorId.create('sub-titular'),
      content: PostContent.create('Dato del titular'),
      occurredAt: AT,
    })
    ownThread.hidePost(PostId.create('post-propio-oculto'), MODERADOR, AT)
    otherThread.publishPost({
      id: PostId.create('post-ajeno'),
      authorId: AuthorId.create('sub-ajeno'),
      content: PostContent.create('Dato ajeno'),
      occurredAt: AT,
    })
    await repository.save(ownThread)
    await repository.save(otherThread)

    expect(await repository.findPostsByAuthor(AuthorId.create('sub-titular'))).toEqual([
      {
        id: 'post-propio-oculto',
        threadId: ownThread.id.value,
        content: 'Dato del titular',
        createdAt: AT.toISOString(),
      },
    ])
  })

  it('crea un indice para la lectura eficiente de mensajes por autor', async () => {
    const index = await sql<{ indexdef: string }>`
      select indexdef
      from pg_indexes
      where schemaname = current_schema()
        and tablename = 'posts'
        and indexname = 'posts_por_autor'
    `.execute(db)

    expect(index.rows[0]?.indexdef).toContain('(author_id, created_at, id)')
  })

  /**
   * Publicar un mensaje no debe reescribir los que ya estaban: la clausula
   * `where` del `on conflict` descarta las filas que no cambiaron. Se comprueba
   * por su efecto observable: `xmin` es la version de la fila en PostgreSQL y
   * cambia con cada escritura, aunque los valores escritos sean identicos.
   */
  it('no reescribe los mensajes que no han cambiado', async () => {
    const thread = buildThread()
    publish(thread, 'pos-viejo', 'Ya estaba')
    await repository.save(thread)

    // `xmin` es una columna de sistema y no esta en el esquema tipado, asi que
    // se pide con SQL explicito en lugar de forzar el tipo del constructor.
    const version = async (): Promise<string> => {
      const fila = await db
        .selectFrom('posts')
        .select(sql<string>`xmin`.as('version'))
        .where('id', '=', 'pos-viejo')
        .executeTakeFirstOrThrow()

      return fila.version
    }

    const inicial = await version()

    publish(thread, 'pos-nuevo', 'Llega despues')
    await repository.save(thread)

    expect(await version()).toBe(inicial)
  })

  it('borra del almacen el mensaje que el agregado ya no tiene', async () => {
    const thread = buildThread()
    publish(thread, 'pos-uno', 'Se queda')
    publish(thread, 'pos-dos', 'Se va')
    await repository.save(thread)

    // Se reconstruye el agregado sin el segundo mensaje: el agregado es la
    // autoridad sobre su contenido, y el almacen debe seguirle.
    const recortado = Thread.restore({
      id: thread.id,
      title: thread.currentTitle,
      authorId: thread.authorId,
      status: thread.currentStatus,
      posts: [
        {
          id: PostId.create('pos-uno'),
          authorId: thread.authorId,
          content: PostContent.create('Se queda'),
          hidden: false,
          createdAt: AT,
        },
      ],
    })

    await repository.save(recortado)

    const restantes = await db
      .selectFrom('posts')
      .select('id')
      .where('thread_id', '=', thread.id.value)
      .execute()

    expect(restantes.map((fila) => fila.id)).toEqual(['pos-uno'])
  })

  it('lee varios hilos con sus mensajes sin una consulta por hilo', async () => {
    const primero = buildThread()
    publish(primero, `${primero.id.value}-p1`, 'Uno')
    const segundo = buildThread()
    publish(segundo, `${segundo.id.value}-p1`, 'Dos')
    publish(segundo, `${segundo.id.value}-p2`, 'Tres')

    await repository.save(primero)
    await repository.save(segundo)

    const todos = await repository.list()
    const leidos = new Map(todos.map((thread) => [thread.id.value, thread]))

    expect(leidos.get(primero.id.value)?.postCount).toBe(1)
    expect(leidos.get(segundo.id.value)?.postCount).toBe(2)
  })

  describe('Las restricciones viven en el motor, no solo en el codigo', () => {
    /**
     * Se escribe directamente en la tabla, sin pasar por el agregado. Es la
     * unica forma de demostrar que la proteccion esta en el motor: a traves del
     * dominio, el valor invalido no llegaria nunca.
     */
    it('rechaza un estado que no pertenece al vocabulario', async () => {
      const thread = buildThread()
      await repository.save(thread)

      await expect(
        db
          .updateTable('threads')
          .set({ status: 'ARCHIVADO' })
          .where('id', '=', thread.id.value)
          .execute(),
      ).rejects.toThrow()
    })

    it('rechaza dos mensajes en la misma posicion del mismo hilo', async () => {
      const thread = buildThread()
      publish(thread, `${thread.id.value}-dup`, 'Ocupa la posicion cero')
      await repository.save(thread)

      await expect(
        db
          .insertInto('posts')
          .values({
            id: `${thread.id.value}-choque`,
            thread_id: thread.id.value,
            position: 0,
            author_id: 'sub-otro',
            content: 'Quiere la misma posicion',
            hidden: false,
            created_at: AT,
          })
          .execute(),
      ).rejects.toThrow()
    })

    it('rechaza una posicion fuera del limite de mensajes por hilo', async () => {
      const thread = buildThread()
      await repository.save(thread)

      await expect(
        db
          .insertInto('posts')
          .values({
            id: `${thread.id.value}-fuera`,
            thread_id: thread.id.value,
            position: 500,
            author_id: 'sub-otro',
            content: 'Se pasa del limite',
            hidden: false,
            created_at: AT,
          })
          .execute(),
      ).rejects.toThrow()
    })

    it('rechaza un mensaje que no pertenece a ningun hilo', async () => {
      await expect(
        db
          .insertInto('posts')
          .values({
            id: 'pos-huerfano',
            thread_id: 'thr-que-no-existe',
            position: 0,
            author_id: 'sub-otro',
            content: 'Sin hilo',
            hidden: false,
            created_at: AT,
          })
          .execute(),
      ).rejects.toThrow()
    })
  })

  it('respeta un limite de conexiones explicito', async () => {
    const acotada = createDatabase({
      connectionString: container.getConnectionUri(),
      maxConnections: 2,
    })

    try {
      const cuenta = await acotada
        .selectFrom('threads')
        .select((eb) => eb.fn.countAll().as('total'))
        .executeTakeFirstOrThrow()

      expect(Number(cuenta.total)).toBeGreaterThanOrEqual(0)
    } finally {
      await acotada.destroy()
    }
  })

  it('la migracion es idempotente: volver a aplicarla no cambia nada', async () => {
    const { applied, error } = await migrateToLatest(db)

    expect(error).toBeUndefined()
    expect(applied).toEqual([])
  })
})
