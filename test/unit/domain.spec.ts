import { Thread, ThreadStatus } from '../../src/domain/entities/Thread'
import { ModerationPolicy } from '../../src/domain/policies/ModerationPolicy'
import {
  AuthorId,
  PostContent,
  PostId,
  ThreadId,
  ThreadTitle,
} from '../../src/domain/value-objects/community-values'
import { DomainError } from '../../src/domain/errors/DomainError'

const AT = new Date('2026-08-21T10:00:00.000Z')

const author = (id = 'acc-1'): AuthorId => AuthorId.create(id)
const post = (id: string): PostId => PostId.create(id)
const content = (text = 'Un mensaje valido.'): PostContent => PostContent.create(text)

const openThread = (): Thread =>
  Thread.open({
    id: ThreadId.create('thread-1'),
    title: ThreadTitle.create('Estrategias para el jefe final'),
    authorId: author(),
  })

const threadWithPost = (): Thread => {
  const thread = openThread()
  thread.publishPost({
    id: post('post-1'),
    authorId: author('acc-2'),
    content: content(),
    occurredAt: AT,
  })
  thread.pullEvents()

  return thread
}

describe('Objetos de valor', () => {
  it('AuthorId, ThreadId y PostId normalizan y comparan por valor', () => {
    expect(AuthorId.create('  acc-1 ').value).toBe('acc-1')
    expect(ThreadId.create('  t-1 ').value).toBe('t-1')
    expect(PostId.create('  p-1 ').value).toBe('p-1')

    expect(author('a').equals(author('a'))).toBe(true)
    expect(author('a').equals(author('b'))).toBe(false)
    expect(ThreadId.create('t').equals(ThreadId.create('t'))).toBe(true)
    expect(ThreadId.create('t').equals(ThreadId.create('u'))).toBe(false)
    expect(post('p').equals(post('p'))).toBe(true)
    expect(post('p').equals(post('q'))).toBe(false)

    expect(String(author('a'))).toBe('a')
    expect(String(ThreadId.create('t'))).toBe('t')
    expect(String(post('p'))).toBe('p')
  })

  it('rechazan identificadores vacios', () => {
    expect(() => AuthorId.create('  ')).toThrow(DomainError)
    expect(() => ThreadId.create('  ')).toThrow(DomainError)
    expect(() => PostId.create('  ')).toThrow(DomainError)
  })

  it('ThreadTitle colapsa espacios y acota la longitud', () => {
    const title = ThreadTitle.create('  Estrategias   para   el   jefe ')

    expect(title.value).toBe('Estrategias para el jefe')
    expect(String(title)).toBe('Estrategias para el jefe')
    expect(title.equals(ThreadTitle.create('Estrategias para el jefe'))).toBe(true)
    expect(title.equals(ThreadTitle.create('Otro titulo'))).toBe(false)

    expect(() => ThreadTitle.create('Ab')).toThrow(DomainError)
    expect(() => ThreadTitle.create('x'.repeat(121))).toThrow(DomainError)
  })

  it('PostContent recorta y normaliza saltos de linea sin colapsar espacios internos', () => {
    const value = PostContent.create('  Primera linea\r\nSegunda   linea  ')

    expect(value.value).toBe('Primera linea\nSegunda   linea')
    expect(value.length).toBe(value.value.length)
    expect(String(value)).toBe(value.value)
    expect(value.equals(PostContent.create('Primera linea\nSegunda   linea'))).toBe(true)
    expect(value.equals(PostContent.create('Otro'))).toBe(false)
  })

  it('PostContent rechaza un mensaje vacio o demasiado largo', () => {
    expect(() => PostContent.create('   ')).toThrow(/no puede estar vacio/)
    expect(() => PostContent.create('x'.repeat(2_001))).toThrow(/no puede superar/)
  })
})

describe('Thread', () => {
  it('nace abierto y sin mensajes', () => {
    const thread = openThread()

    expect(thread.currentStatus).toBe(ThreadStatus.Open)
    expect(thread.isOpen).toBe(true)
    expect(thread.postCount).toBe(0)
    expect(thread.visiblePostCount).toBe(0)
    expect(thread.currentTitle.value).toBe('Estrategias para el jefe final')
  })

  it('publica un mensaje y emite el evento con la longitud, no el contenido', () => {
    const thread = openThread()

    thread.publishPost({
      id: post('post-1'),
      authorId: author('acc-2'),
      content: content('Conviene abrir con el escudo.'),
      occurredAt: AT,
    })

    expect(thread.postCount).toBe(1)
    expect(thread.visiblePostCount).toBe(1)

    const events = thread.pullEvents()
    expect(events[0]).toMatchObject({
      name: 'community.post.published',
      postId: 'post-1',
      authorId: 'acc-2',
      contentLength: 'Conviene abrir con el escudo.'.length,
    })
    // El evento no transporta el texto escrito por la persona usuaria.
    expect(JSON.stringify(events[0])).not.toContain('escudo')
  })

  it('rechaza publicar en un hilo cerrado', () => {
    const thread = openThread()
    thread.close(author('acc-mod'), AT)

    expect(() => {
      thread.publishPost({
        id: post('post-1'),
        authorId: author(),
        content: content(),
        occurredAt: AT,
      })
    }).toThrow(/cerrado y no admite mensajes/)
  })

  it('rechaza dos mensajes con el mismo identificador', () => {
    const thread = threadWithPost()

    expect(() => {
      thread.publishPost({
        id: post('post-1'),
        authorId: author(),
        content: content(),
        occurredAt: AT,
      })
    }).toThrow(/ya contiene un mensaje/)
  })

  it('aplica el limite de mensajes por hilo', () => {
    const thread = openThread()

    for (let index = 0; index < ModerationPolicy.MAX_POSTS_PER_THREAD; index += 1) {
      thread.publishPost({
        id: post(`post-${String(index)}`),
        authorId: author(),
        content: content(),
        occurredAt: AT,
      })
    }

    expect(thread.postCount).toBe(ModerationPolicy.MAX_POSTS_PER_THREAD)
    expect(() => {
      thread.publishPost({
        id: post('excedente'),
        authorId: author(),
        content: content(),
        occurredAt: AT,
      })
    }).toThrow(/limite de/)
  })

  it('ocultar conserva el mensaje pero lo retira del recuento visible', () => {
    const thread = threadWithPost()

    thread.hidePost(post('post-1'), author('acc-mod'), AT)

    expect(thread.postCount).toBe(1)
    expect(thread.visiblePostCount).toBe(0)
    expect(thread.toSnapshot().posts[0]).toMatchObject({
      hidden: true,
      content: 'Un mensaje valido.',
    })
    expect(thread.pullEvents()[0]).toMatchObject({
      name: 'community.post.hidden',
      postId: 'post-1',
      moderatorId: 'acc-mod',
    })
  })

  it('rechaza ocultar un mensaje inexistente o ya oculto', () => {
    const thread = threadWithPost()

    expect(() => {
      thread.hidePost(post('inexistente'), author('acc-mod'), AT)
    }).toThrow(/no contiene el mensaje/)

    thread.hidePost(post('post-1'), author('acc-mod'), AT)
    expect(() => {
      thread.hidePost(post('post-1'), author('acc-mod'), AT)
    }).toThrow(/ya estaba oculto/)
  })

  it('restituye un mensaje ocultado por error', () => {
    const thread = threadWithPost()
    thread.hidePost(post('post-1'), author('acc-mod'), AT)

    thread.restorePost(post('post-1'))

    expect(thread.visiblePostCount).toBe(1)
  })

  it('rechaza restituir un mensaje inexistente o que no estaba oculto', () => {
    const thread = threadWithPost()

    expect(() => {
      thread.restorePost(post('inexistente'))
    }).toThrow(/no contiene el mensaje/)
    expect(() => {
      thread.restorePost(post('post-1'))
    }).toThrow(/no estaba oculto/)
  })

  it('cierra y reabre el hilo', () => {
    const thread = threadWithPost()

    thread.close(author('acc-mod'), AT)
    expect(thread.isOpen).toBe(false)
    expect(thread.pullEvents()[0]).toMatchObject({
      name: 'community.thread.closed',
      moderatorId: 'acc-mod',
    })

    thread.reopen()
    expect(thread.isOpen).toBe(true)
  })

  it('rechaza cerrar dos veces y reabrir lo ya abierto', () => {
    const thread = openThread()

    expect(() => {
      thread.reopen()
    }).toThrow(/ya esta abierto/)

    thread.close(author('acc-mod'), AT)
    expect(() => {
      thread.close(author('acc-mod'), AT)
    }).toThrow(/ya esta cerrado/)
  })

  it('permite renombrar un hilo abierto y lo rechaza si esta cerrado', () => {
    const thread = openThread()

    thread.rename(ThreadTitle.create('Titulo corregido'))
    expect(thread.currentTitle.value).toBe('Titulo corregido')

    thread.close(author('acc-mod'), AT)
    expect(() => {
      thread.rename(ThreadTitle.create('Otro titulo mas'))
    }).toThrow(/cerrado y no admite cambios de titulo/)
  })

  it('la instantanea conserva los mensajes ocultos para la persistencia', () => {
    const thread = threadWithPost()
    thread.hidePost(post('post-1'), author('acc-mod'), AT)

    const snapshot = thread.toSnapshot()

    expect(snapshot).toMatchObject({
      id: 'thread-1',
      title: 'Estrategias para el jefe final',
      authorId: 'acc-1',
      status: ThreadStatus.Open,
    })
    expect(snapshot.posts).toHaveLength(1)
    expect(snapshot.posts[0]?.createdAt).toBe('2026-08-21T10:00:00.000Z')
  })

  it('reconstituye un hilo persistido sin emitir eventos', () => {
    const thread = Thread.restore({
      id: ThreadId.create('thread-9'),
      title: ThreadTitle.create('Hilo restaurado'),
      authorId: author(),
      status: ThreadStatus.Closed,
      posts: [
        {
          id: post('post-1'),
          authorId: author('acc-2'),
          content: content(),
          hidden: true,
          createdAt: AT,
        },
      ],
    })

    expect(thread.pullEvents()).toHaveLength(0)
    expect(thread.isOpen).toBe(false)
    expect(thread.postCount).toBe(1)
    expect(thread.visiblePostCount).toBe(0)
  })
})
