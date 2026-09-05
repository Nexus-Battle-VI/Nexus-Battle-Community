import {
  ApproveComment,
  DeleteComment,
  EditComment,
  HideComment,
  ListModerationQueue,
  MarkComment,
} from '../../src/application/use-cases/CommentModerationUseCases'
import { CommentNotFoundError } from '../../src/application/errors/ApplicationError'
import { InMemoryProductCommentRepository } from '../../src/adapters/outbound/persistence/InMemoryProductCommentRepository'
import { InMemoryCommentModerationActionRepository } from '../../src/adapters/outbound/persistence/InMemoryCommentModerationActionRepository'
import { InMemoryCommentReportRepository } from '../../src/adapters/outbound/persistence/InMemoryCommentReportRepository'
import { InMemoryCommentModerationTransaction } from '../../src/adapters/outbound/persistence/InMemoryCommentModerationTransaction'
import { ProductComment } from '../../src/domain/entities/ProductComment'
import { CommentReport } from '../../src/domain/entities/CommentReport'
import { AuthorId } from '../../src/domain/value-objects/community-values'
import {
  CommentContent,
  ProductCommentId,
  ProductId,
} from '../../src/domain/value-objects/product-review-values'
import {
  CommentReportId,
  ReportCategory,
} from '../../src/domain/value-objects/comment-report-values'
import { CommentModerationStatus } from '../../src/domain/value-objects/moderation-values'
import { DomainError } from '../../src/domain/errors/DomainError'

const FIXED_NOW = new Date('2026-09-03T10:00:00.000Z')
const PRODUCTO = '3f2a1e4c-6b7d-4a8e-9c1f-2d3e4f5a6b7c'

const sequence = (prefix: string): (() => string) => {
  let counter = 0

  return (): string => {
    counter += 1

    return `${prefix}-${String(counter)}`
  }
}

interface Harness {
  comments: InMemoryProductCommentRepository
  actions: InMemoryCommentModerationActionRepository
  reports: InMemoryCommentReportRepository
  approve: ApproveComment
  hide: HideComment
  remove: DeleteComment
  edit: EditComment
  mark: MarkComment
  listQueue: ListModerationQueue
  seedComment: (id?: string) => Promise<string>
}

const buildHarness = (): Harness => {
  const comments = new InMemoryProductCommentRepository()
  const actions = new InMemoryCommentModerationActionRepository()
  const reports = new InMemoryCommentReportRepository()
  const clock = { now: (): Date => FIXED_NOW }
  const deps = {
    transaction: new InMemoryCommentModerationTransaction({ comments, actions }),
    clock,
    ids: { generate: sequence('mod') },
  }

  const seedComment = async (id = 'comment-1'): Promise<string> => {
    await comments.save(
      ProductComment.publish({
        id: ProductCommentId.create(id),
        productId: ProductId.create(PRODUCTO),
        authorId: AuthorId.create('acc-autor'),
        content: CommentContent.create('Comentario a moderar.'),
        images: [],
        occurredAt: FIXED_NOW,
      }),
    )

    return id
  }

  return {
    comments,
    actions,
    reports,
    approve: new ApproveComment(deps),
    hide: new HideComment(deps),
    remove: new DeleteComment(deps),
    edit: new EditComment(deps),
    mark: new MarkComment(deps),
    listQueue: new ListModerationQueue({ reports, comments }),
    seedComment,
  }
}

const IP = '203.0.113.10'

describe('Acciones de moderacion (HU-41.2)', () => {
  it('aprobar mueve PENDING -> APPROVED y devuelve el comentario actualizado', async () => {
    const h = buildHarness()
    const commentId = await h.seedComment()

    const dto = await h.approve.execute({
      commentId,
      actorId: 'acc-moderador',
      reason: 'Cumple las normas de la comunidad.',
      ipAddress: IP,
    })

    expect(dto.moderationStatus).toBe(CommentModerationStatus.Approved)
  })

  it('ocultar mueve PENDING -> HIDDEN', async () => {
    const h = buildHarness()
    const commentId = await h.seedComment()

    const dto = await h.hide.execute({
      commentId,
      actorId: 'acc-moderador',
      reason: 'Contenido ofensivo.',
      ipAddress: IP,
    })

    expect(dto.moderationStatus).toBe(CommentModerationStatus.Hidden)
  })

  it('eliminar (borrado logico) mueve PENDING -> DELETED sin borrar la fila', async () => {
    const h = buildHarness()
    const commentId = await h.seedComment()

    const dto = await h.remove.execute({
      commentId,
      actorId: 'acc-moderador',
      reason: 'Infringe los terminos de uso.',
      ipAddress: IP,
    })

    expect(dto.moderationStatus).toBe(CommentModerationStatus.Deleted)
    expect(await h.comments.findById(ProductCommentId.create(commentId))).not.toBeNull()
  })

  it('editar cambia el contenido y mueve PENDING -> EDITED', async () => {
    const h = buildHarness()
    const commentId = await h.seedComment()

    const dto = await h.edit.execute({
      commentId,
      actorId: 'acc-moderador',
      reason: 'Se retiro un enlace externo.',
      content: 'Buen producto. [Enlace retirado por moderacion.]',
      ipAddress: IP,
    })

    expect(dto.moderationStatus).toBe(CommentModerationStatus.Edited)
    expect(dto.content).toBe('Buen producto. [Enlace retirado por moderacion.]')
  })

  it('marcar mueve PENDING -> MARKED', async () => {
    const h = buildHarness()
    const commentId = await h.seedComment()

    const dto = await h.mark.execute({
      commentId,
      actorId: 'acc-moderador',
      reason: 'Requiere seguimiento.',
      ipAddress: IP,
    })

    expect(dto.moderationStatus).toBe(CommentModerationStatus.Marked)
  })

  it('falla con CommentNotFoundError cuando el comentario no existe, en las cinco acciones', async () => {
    const h = buildHarness()
    const command = {
      commentId: 'inexistente',
      actorId: 'acc-moderador',
      reason: 'Motivo.',
      ipAddress: IP,
    }

    await expect(h.approve.execute(command)).rejects.toBeInstanceOf(CommentNotFoundError)
    await expect(h.hide.execute(command)).rejects.toBeInstanceOf(CommentNotFoundError)
    await expect(h.remove.execute(command)).rejects.toBeInstanceOf(CommentNotFoundError)
    await expect(h.mark.execute(command)).rejects.toBeInstanceOf(CommentNotFoundError)
    await expect(
      h.edit.execute({ ...command, content: 'Contenido nuevo.' }),
    ).rejects.toBeInstanceOf(CommentNotFoundError)
  })

  it('rechaza un motivo vacio sin persistir cambio ni auditoria', async () => {
    const h = buildHarness()
    const commentId = await h.seedComment()

    await expect(
      h.approve.execute({ commentId, actorId: 'acc-moderador', reason: '   ', ipAddress: IP }),
    ).rejects.toBeInstanceOf(DomainError)

    const comment = await h.comments.findById(ProductCommentId.create(commentId))
    expect(comment?.currentModerationStatus).toBe(CommentModerationStatus.Pending)
    expect(h.actions.size).toBe(0)
  })

  /**
   * HU-41.3/41.8: cada accion exitosa deja un registro de auditoria con
   * actor, motivo, estado anterior, nuevo estado E IP -- no solo el efecto
   * sobre el comentario.
   */
  it('registra la auditoria de la accion con actor, motivo, ambos estados e IP', async () => {
    const h = buildHarness()
    const commentId = await h.seedComment()

    await h.hide.execute({
      commentId,
      actorId: 'acc-moderador',
      reason: 'Contenido ofensivo.',
      ipAddress: IP,
    })

    const history = await h.actions.listByComment(ProductCommentId.create(commentId))

    expect(history).toHaveLength(1)
    expect(history[0]?.toSnapshot()).toMatchObject({
      commentId,
      actorId: 'acc-moderador',
      action: 'HIDE',
      reason: 'Contenido ofensivo.',
      previousStatus: 'PENDING',
      newStatus: 'HIDDEN',
      ipAddress: IP,
    })
  })

  it('cada una de las cinco acciones captura la IP resuelta por el servidor, nunca del body', async () => {
    const h = buildHarness()

    const acciones: readonly [string, (id: string) => Promise<unknown>][] = [
      [
        'approve',
        (id) =>
          h.approve.execute({ commentId: id, actorId: 'acc-mod', reason: 'M.', ipAddress: IP }),
      ],
      [
        'hide',
        (id) => h.hide.execute({ commentId: id, actorId: 'acc-mod', reason: 'M.', ipAddress: IP }),
      ],
      [
        'remove',
        (id) =>
          h.remove.execute({ commentId: id, actorId: 'acc-mod', reason: 'M.', ipAddress: IP }),
      ],
      [
        'edit',
        (id) =>
          h.edit.execute({
            commentId: id,
            actorId: 'acc-mod',
            reason: 'M.',
            content: 'C.',
            ipAddress: IP,
          }),
      ],
      [
        'mark',
        (id) => h.mark.execute({ commentId: id, actorId: 'acc-mod', reason: 'M.', ipAddress: IP }),
      ],
    ]

    for (const [nombre, ejecutar] of acciones) {
      const commentId = await h.seedComment(`comment-${nombre}`)
      await ejecutar(commentId)

      const history = await h.actions.listByComment(ProductCommentId.create(commentId))
      expect(history[0]?.ipAddress?.value).toBe(IP)
    }
  })

  it('un comentario puede acumular varias acciones, todas auditadas de forma independiente', async () => {
    const h = buildHarness()
    const commentId = await h.seedComment()

    await h.hide.execute({
      commentId,
      actorId: 'acc-moderador',
      reason: 'Motivo 1.',
      ipAddress: IP,
    })
    await h.approve.execute({
      commentId,
      actorId: 'acc-otro-moderador',
      reason: 'Motivo 2.',
      ipAddress: '198.51.100.20',
    })

    // Ambas acciones comparten el mismo reloj fijo: solo el conteo y el
    // conjunto de acciones son deterministas aqui, no el orden -- el orden por
    // fecha reciente, con marcas de tiempo distintas, lo comprueba
    // `postgres-comment-moderation-action-repository.spec.ts`.
    const history = await h.actions.listByComment(ProductCommentId.create(commentId))
    expect(history).toHaveLength(2)
    expect(history.map((a) => a.action).sort()).toEqual(['APPROVE', 'HIDE'])
    expect(new Set(history.map((a) => a.id.value)).size).toBe(2)
  })
})

describe('ListModerationQueue (HU-41.1)', () => {
  it('devuelve los comentarios con al menos un reporte, con su conteo', async () => {
    const h = buildHarness()
    const reportado = await h.seedComment('comment-reportado')
    await h.seedComment('comment-sin-reportes')

    await h.reports.save(
      CommentReport.file({
        id: CommentReportId.create('report-1'),
        commentId: ProductCommentId.create(reportado),
        authorId: AuthorId.create('acc-reportante'),
        category: ReportCategory.Spam,
        description: null,
        occurredAt: FIXED_NOW,
      }),
    )

    const page = await h.listQueue.execute({})

    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.comment.id).toBe(reportado)
    expect(page.items[0]?.reportCount).toBe(1)
  })

  it('la cola esta vacia cuando ningun comentario tiene reportes', async () => {
    const h = buildHarness()
    await h.seedComment()

    const page = await h.listQueue.execute({})

    expect(page.items).toEqual([])
    expect(page.total).toBe(0)
  })

  it('acota el limite entre 1 y 100, y el offset a no negativo', async () => {
    const h = buildHarness()

    const page = await h.listQueue.execute({ limit: 500, offset: -5 })

    expect(page.limit).toBe(100)
    expect(page.offset).toBe(0)
  })
})
