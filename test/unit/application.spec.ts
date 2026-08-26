import {
  CloseThread,
  GetThread,
  HidePost,
  ListThreads,
  OpenThread,
  PublishPost,
} from '../../src/application/use-cases/ThreadUseCases'
import { ThreadNotFoundError } from '../../src/application/errors/ApplicationError'
import { InMemoryThreadRepository } from '../../src/adapters/outbound/persistence/InMemoryThreadRepository'
import { Thread, ThreadStatus } from '../../src/domain/entities/Thread'
import {
  AuthorId,
  PostContent,
  PostId,
  ThreadId,
  ThreadTitle,
} from '../../src/domain/value-objects/community-values'
import { DomainError } from '../../src/domain/errors/DomainError'
import { ConfigurationError, loadConfig } from '../../src/infrastructure/config/env'
import { createLogger } from '../../src/infrastructure/observability/logger'
import { buildLiveness, buildReadiness, buildVersion } from '../../src/infrastructure/health/health'
import { SystemClock } from '../../src/adapters/outbound/system/SystemClock'
import { UuidGenerator } from '../../src/adapters/outbound/system/UuidGenerator'

const FIXED_NOW = new Date('2026-08-21T10:00:00.000Z')

interface Harness {
  threads: InMemoryThreadRepository
  open: OpenThread
  publish: PublishPost
  hide: HidePost
  close: CloseThread
  get: GetThread
  list: ListThreads
}

const sequence = (prefix: string): (() => string) => {
  let counter = 0

  return (): string => {
    counter += 1

    return `${prefix}-${String(counter)}`
  }
}

const buildHarness = (): Harness => {
  const threads = new InMemoryThreadRepository()
  const deps = {
    threads,
    clock: { now: (): Date => FIXED_NOW },
    ids: { generate: sequence('id') },
  }

  return {
    threads,
    open: new OpenThread(deps),
    publish: new PublishPost(deps),
    hide: new HidePost(deps),
    close: new CloseThread(deps),
    get: new GetThread(threads),
    list: new ListThreads(threads),
  }
}

const openCommand = { title: 'Estrategias para el jefe final', authorId: 'acc-1' }

describe('OpenThread', () => {
  it('abre un hilo vacio y lo persiste', async () => {
    const harness = buildHarness()

    const result = await harness.open.execute(openCommand)

    expect(result).toMatchObject({
      title: 'Estrategias para el jefe final',
      authorId: 'acc-1',
      status: ThreadStatus.Open,
      postCount: 0,
      posts: [],
    })
    expect(harness.threads.size).toBe(1)
  })

  it('normaliza el titulo', async () => {
    const harness = buildHarness()

    const result = await harness.open.execute({
      ...openCommand,
      title: '  Estrategias   para   el   jefe ',
    })

    expect(result.title).toBe('Estrategias para el jefe')
  })

  it.each([
    ['titulo demasiado corto', { title: 'Ab' }],
    ['autor vacio', { authorId: '   ' }],
  ])('rechaza una peticion con %s', async (_caso, override) => {
    const harness = buildHarness()

    await expect(harness.open.execute({ ...openCommand, ...override })).rejects.toBeInstanceOf(
      DomainError,
    )
  })
})

describe('PublishPost', () => {
  it('publica y persiste el mensaje', async () => {
    const harness = buildHarness()
    const thread = await harness.open.execute(openCommand)

    const result = await harness.publish.execute({
      threadId: thread.id,
      authorId: 'acc-2',
      content: 'Conviene abrir con el escudo.',
    })

    expect(result.postCount).toBe(1)
    expect(result.posts[0]).toMatchObject({
      authorId: 'acc-2',
      content: 'Conviene abrir con el escudo.',
    })
    // Se relee del repositorio para confirmar que quedo persistido.
    expect((await harness.get.execute(thread.id)).postCount).toBe(1)
  })

  it('falla cuando el hilo no existe', async () => {
    const harness = buildHarness()

    await expect(
      harness.publish.execute({ threadId: 'inexistente', authorId: 'acc-2', content: 'Hola' }),
    ).rejects.toBeInstanceOf(ThreadNotFoundError)
  })

  it('propaga el rechazo de un hilo cerrado', async () => {
    const harness = buildHarness()
    const thread = await harness.open.execute(openCommand)
    await harness.close.execute(thread.id, 'acc-mod')

    await expect(
      harness.publish.execute({ threadId: thread.id, authorId: 'acc-2', content: 'Hola' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('rechaza contenido vacio o excesivo', async () => {
    const harness = buildHarness()
    const thread = await harness.open.execute(openCommand)

    await expect(
      harness.publish.execute({ threadId: thread.id, authorId: 'acc-2', content: '   ' }),
    ).rejects.toBeInstanceOf(DomainError)
    await expect(
      harness.publish.execute({
        threadId: thread.id,
        authorId: 'acc-2',
        content: 'x'.repeat(2_001),
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

describe('HidePost', () => {
  it('oculta el mensaje y lo retira de la lectura publica', async () => {
    const harness = buildHarness()
    const thread = await harness.open.execute(openCommand)
    const withPost = await harness.publish.execute({
      threadId: thread.id,
      authorId: 'acc-2',
      content: 'Contenido inapropiado',
    })
    const postId = withPost.posts[0]?.id ?? ''

    const result = await harness.hide.execute({
      threadId: thread.id,
      postId,
      moderatorId: 'acc-mod',
    })

    expect(result.postCount).toBe(0)
    expect(result.posts).toEqual([])

    // El contenido sigue en el almacen: ocultar es reversible.
    const stored = await harness.threads.findById(ThreadId.create(thread.id))
    expect(stored?.toSnapshot().posts[0]).toMatchObject({
      hidden: true,
      content: 'Contenido inapropiado',
    })
  })

  it('falla cuando el hilo no existe', async () => {
    const harness = buildHarness()

    await expect(
      harness.hide.execute({ threadId: 'inexistente', postId: 'p', moderatorId: 'acc-mod' }),
    ).rejects.toBeInstanceOf(ThreadNotFoundError)
  })

  it('propaga el rechazo de un mensaje inexistente', async () => {
    const harness = buildHarness()
    const thread = await harness.open.execute(openCommand)

    await expect(
      harness.hide.execute({ threadId: thread.id, postId: 'inexistente', moderatorId: 'acc-mod' }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

describe('CloseThread', () => {
  it('cierra el hilo y lo persiste', async () => {
    const harness = buildHarness()
    const thread = await harness.open.execute(openCommand)

    const result = await harness.close.execute(thread.id, 'acc-mod')

    expect(result.status).toBe(ThreadStatus.Closed)
    expect((await harness.get.execute(thread.id)).status).toBe(ThreadStatus.Closed)
  })

  it('falla cuando el hilo no existe', async () => {
    const harness = buildHarness()

    await expect(harness.close.execute('inexistente', 'acc-mod')).rejects.toBeInstanceOf(
      ThreadNotFoundError,
    )
  })

  it('propaga el rechazo del doble cierre', async () => {
    const harness = buildHarness()
    const thread = await harness.open.execute(openCommand)
    await harness.close.execute(thread.id, 'acc-mod')

    await expect(harness.close.execute(thread.id, 'acc-mod')).rejects.toBeInstanceOf(DomainError)
  })
})

describe('GetThread y ListThreads', () => {
  it('recupera un hilo existente y falla con uno inexistente', async () => {
    const harness = buildHarness()
    const thread = await harness.open.execute(openCommand)

    expect((await harness.get.execute(thread.id)).id).toBe(thread.id)
    await expect(harness.get.execute('inexistente')).rejects.toBeInstanceOf(ThreadNotFoundError)
    await expect(harness.get.execute('   ')).rejects.toBeInstanceOf(DomainError)
  })

  it('lista los hilos con su recuento de mensajes visibles', async () => {
    const harness = buildHarness()
    const first = await harness.open.execute(openCommand)
    await harness.open.execute({ ...openCommand, title: 'Segundo hilo de prueba' })

    const withPost = await harness.publish.execute({
      threadId: first.id,
      authorId: 'acc-2',
      content: 'Mensaje visible',
    })
    await harness.publish.execute({
      threadId: first.id,
      authorId: 'acc-3',
      content: 'Mensaje que sera ocultado',
    })
    await harness.hide.execute({
      threadId: first.id,
      postId: withPost.posts[0]?.id ?? '',
      moderatorId: 'acc-mod',
    })

    const result = await harness.list.execute()

    expect(result).toHaveLength(2)
    expect(result.find((thread) => thread.id === first.id)?.postCount).toBe(1)
  })

  it('devuelve una lista vacia cuando no hay hilos', async () => {
    expect(await buildHarness().list.execute()).toEqual([])
  })
})

describe('InMemoryThreadRepository', () => {
  const buildThread = (): Thread =>
    Thread.open({
      id: ThreadId.create('thread-1'),
      title: ThreadTitle.create('Hilo de prueba tecnica'),
      authorId: AuthorId.create('acc-1'),
    })

  it('almacena instantaneas, no referencias vivas al agregado', async () => {
    const repository = new InMemoryThreadRepository()
    const thread = buildThread()
    await repository.save(thread)

    // Se muta el agregado sin volver a guardarlo.
    thread.publishPost({
      id: PostId.create('post-1'),
      authorId: AuthorId.create('acc-2'),
      content: PostContent.create('Mensaje'),
      occurredAt: FIXED_NOW,
    })

    const stored = await repository.findById(ThreadId.create('thread-1'))

    expect(stored?.postCount).toBe(0)
    expect(thread.postCount).toBe(1)
  })

  it('reconstituye los mensajes ocultos al releer', async () => {
    const repository = new InMemoryThreadRepository()
    const thread = buildThread()
    thread.publishPost({
      id: PostId.create('post-1'),
      authorId: AuthorId.create('acc-2'),
      content: PostContent.create('Mensaje'),
      occurredAt: FIXED_NOW,
    })
    thread.hidePost(PostId.create('post-1'), AuthorId.create('acc-mod'), FIXED_NOW)
    await repository.save(thread)

    const stored = await repository.findById(ThreadId.create('thread-1'))

    expect(stored?.postCount).toBe(1)
    expect(stored?.visiblePostCount).toBe(0)
  })

  it('devuelve null para un hilo desconocido y permite vaciarse', async () => {
    const repository = new InMemoryThreadRepository()

    expect(await repository.findById(ThreadId.create('nada'))).toBeNull()
    expect(await repository.list()).toEqual([])

    await repository.save(buildThread())
    expect(repository.size).toBe(1)

    repository.clear()
    expect(repository.size).toBe(0)
  })
})

describe('loadConfig', () => {
  it('aplica valores por defecto seguros para el entorno local', () => {
    expect(loadConfig({})).toMatchObject({
      nodeEnv: 'development',
      serviceName: 'nexus-battle-community',
      port: 3004,
      persistenceDriver: 'memory',
      swaggerEnabled: true,
    })
  })

  it('exige la cadena de conexion cuando el driver es postgres', () => {
    expect(() => loadConfig({ PERSISTENCE_DRIVER: 'postgres' })).toThrow(
      /DATABASE_URL es obligatorio/,
    )
  })

  it('acepta una configuracion postgres completa', () => {
    expect(
      loadConfig({
        PERSISTENCE_DRIVER: 'postgres',
        DATABASE_URL: 'postgres://usuario@localhost:5432/community',
      }).persistenceDriver,
    ).toBe('postgres')
  })

  it('deshabilita la documentacion interactiva en produccion por defecto', () => {
    // Produccion exige autenticacion configurada: `loadConfig` se niega a
    // arrancar sin ella. Se aporta aqui porque el objeto de esta prueba es la
    // documentacion interactiva, no la autenticacion.
    expect(
      loadConfig({
        NODE_ENV: 'production',
        AUTH_MODE: 'jwt',
        COGNITO_USER_POOL_ID: 'us-east-1_abc',
        COGNITO_CLIENT_ID: 'cliente',
      }).swaggerEnabled,
    ).toBe(false)
  })

  it('trata una variable vacia como ausente', () => {
    expect(loadConfig({ LOG_LEVEL: '', PORT: '' })).toMatchObject({ logLevel: 'info', port: 3004 })
  })

  it.each([
    ['un valor fuera del catalogo', { LOG_LEVEL: 'verbose' }],
    ['un entero mal formado', { PORT: 'abc' }],
    ['un puerto fuera de rango', { PORT: '99999' }],
    ['un booleano invalido', { SWAGGER_ENABLED: 'si' }],
  ])('rechaza %s', (_caso, env) => {
    expect(() => loadConfig(env)).toThrow(ConfigurationError)
  })
})

describe('observabilidad, salud y utilidades', () => {
  it('el registro es JSON estructurado y respeta el umbral', () => {
    const lines: string[] = []
    const logger = createLogger({
      level: 'warn',
      service: 'community',
      version: '0.1.0',
      sink: (line) => lines.push(line),
      clock: () => FIXED_NOW,
    })

    logger.debug('no')
    logger.info('no')
    logger.warn('si', { threadId: 'thread-1' })
    logger.error('si')

    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ level: 'warn', threadId: 'thread-1' })
  })

  it('admite registros sin contexto en todos los niveles', () => {
    const lines: string[] = []
    const logger = createLogger({
      level: 'debug',
      service: 'community',
      version: '0.1.0',
      sink: (line) => lines.push(line),
    })

    logger.debug('a')
    logger.info('b')
    logger.warn('c')
    logger.error('d')

    expect(lines).toHaveLength(4)
  })

  it('las sondas distinguen exito, fallo y excepcion', () => {
    expect(buildLiveness()).toEqual({ status: 'ok', checks: {} })
    expect(buildReadiness([{ name: 'repo', check: (): boolean => true }]).status).toBe('ok')
    expect(buildReadiness([{ name: 'repo', check: (): boolean => false }]).status).toBe('error')
    expect(
      buildReadiness([
        {
          name: 'repo',
          check: (): boolean => {
            throw new Error('sin conexion')
          },
        },
      ]),
    ).toEqual({ status: 'error', checks: { repo: 'error' } })
    expect(buildVersion({ service: 'a', version: 'b', nodeEnv: 'c' })).toEqual({
      service: 'a',
      version: 'b',
      nodeEnv: 'c',
    })
  })

  it('el reloj y el generador de identificadores funcionan', () => {
    expect(new SystemClock().now().getTime()).toBeGreaterThan(0)
    expect(new UuidGenerator().generate()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
