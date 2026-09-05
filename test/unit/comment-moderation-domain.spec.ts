import { DomainError } from '../../src/domain/errors/DomainError'
import { AuthorId } from '../../src/domain/value-objects/community-values'
import {
  CommentContent,
  ProductCommentId,
  ProductId,
} from '../../src/domain/value-objects/product-review-values'
import { ProductComment } from '../../src/domain/entities/ProductComment'
import { CommentModerationAction } from '../../src/domain/entities/CommentModerationAction'
import {
  ALL_MODERATION_ACTIONS,
  CommentModerationActionId,
  CommentModerationStatus,
  IpAddress,
  ModerationAction,
  ModerationReason,
  isCommentModerationStatus,
  isModerationAction,
} from '../../src/domain/value-objects/moderation-values'

const AT = new Date('2026-09-03T10:00:00.000Z')
const PRODUCTO = '3f2a1e4c-6b7d-4a8e-9c1f-2d3e4f5a6b7c'

const buildComment = (): ProductComment =>
  ProductComment.publish({
    id: ProductCommentId.create('comment-1'),
    productId: ProductId.create(PRODUCTO),
    authorId: AuthorId.create('acc-autor'),
    content: CommentContent.create('Comentario original.'),
    images: [],
    occurredAt: AT,
  })

describe('ModerationReason', () => {
  it('rechaza un motivo vacio o excesivo', () => {
    expect(() => ModerationReason.create('   ')).toThrow(DomainError)
    expect(() => ModerationReason.create('x'.repeat(501))).toThrow(DomainError)
  })

  it('acepta un motivo valido, recortado', () => {
    expect(ModerationReason.create('  Spam reiterado.  ').toString()).toBe('Spam reiterado.')
  })
})

describe('isModerationAction / isCommentModerationStatus', () => {
  it('reconoce el vocabulario cerrado y rechaza cualquier otro valor', () => {
    for (const action of ALL_MODERATION_ACTIONS) {
      expect(isModerationAction(action)).toBe(true)
    }
    expect(isModerationAction('REJECT')).toBe(false)

    expect(isCommentModerationStatus('PENDING')).toBe(true)
    expect(isCommentModerationStatus('APPROVED')).toBe(true)
    expect(isCommentModerationStatus('BORRADO')).toBe(false)
  })
})

describe('ProductComment.moderate (HU-41.2/41.3)', () => {
  it('nace PENDING', () => {
    expect(buildComment().currentModerationStatus).toBe(CommentModerationStatus.Pending)
  })

  it.each([
    [ModerationAction.Approve, CommentModerationStatus.Approved],
    [ModerationAction.Delete, CommentModerationStatus.Deleted],
    [ModerationAction.Hide, CommentModerationStatus.Hidden],
    [ModerationAction.Mark, CommentModerationStatus.Marked],
  ])('%s mueve el comentario de PENDING a %s y devuelve el estado anterior', (action, expected) => {
    const comment = buildComment()

    const result = comment.moderate({ action })

    expect(result).toEqual({ previousStatus: CommentModerationStatus.Pending, newStatus: expected })
    expect(comment.currentModerationStatus).toBe(expected)
  })

  it('EDIT cambia el contenido y mueve el estado a EDITED', () => {
    const comment = buildComment()
    const nuevoContenido = CommentContent.create('Contenido corregido por moderacion.')

    const result = comment.moderate({ action: ModerationAction.Edit, newContent: nuevoContenido })

    expect(result).toEqual({
      previousStatus: CommentModerationStatus.Pending,
      newStatus: CommentModerationStatus.Edited,
    })
    expect(comment.currentContent.value).toBe('Contenido corregido por moderacion.')
    expect(comment.currentModerationStatus).toBe(CommentModerationStatus.Edited)
  })

  it('EDIT sin contenido nuevo se rechaza y no cambia nada', () => {
    const comment = buildComment()

    expect(() => {
      comment.moderate({ action: ModerationAction.Edit })
    }).toThrow(DomainError)

    expect(comment.currentModerationStatus).toBe(CommentModerationStatus.Pending)
    expect(comment.currentContent.value).toBe('Comentario original.')
  })

  it('no hay transiciones vetadas: un comentario oculto puede aprobarse despues', () => {
    const comment = buildComment()

    comment.moderate({ action: ModerationAction.Hide })
    expect(comment.currentModerationStatus).toBe(CommentModerationStatus.Hidden)

    const result = comment.moderate({ action: ModerationAction.Approve })

    expect(result.previousStatus).toBe(CommentModerationStatus.Hidden)
    expect(comment.currentModerationStatus).toBe(CommentModerationStatus.Approved)
  })

  it('restore reconstruye el estado de moderacion exacto sin repetir validaciones', () => {
    const restored = ProductComment.restore({
      id: ProductCommentId.create('comment-1'),
      productId: ProductId.create(PRODUCTO),
      authorId: AuthorId.create('acc-autor'),
      content: CommentContent.create('Restaurado.'),
      images: [],
      createdAt: AT,
      moderationStatus: CommentModerationStatus.Marked,
    })

    expect(restored.currentModerationStatus).toBe(CommentModerationStatus.Marked)
    expect(restored.toSnapshot().moderationStatus).toBe(CommentModerationStatus.Marked)
  })
})

describe('CommentModerationAction (HU-41.3)', () => {
  const buildAction = (): CommentModerationAction =>
    CommentModerationAction.record({
      id: CommentModerationActionId.create('mod-1'),
      commentId: ProductCommentId.create('comment-1'),
      actorId: AuthorId.create('acc-moderador'),
      action: ModerationAction.Hide,
      reason: ModerationReason.create('Contenido ofensivo.'),
      previousStatus: CommentModerationStatus.Pending,
      newStatus: CommentModerationStatus.Hidden,
      occurredAt: AT,
      ipAddress: IpAddress.create('203.0.113.10'),
    })

  it('conserva actor, motivo, estado anterior, nuevo estado e IP (trazabilidad de HU-41.3/41.8)', () => {
    const action = buildAction()

    expect(action.toSnapshot()).toEqual({
      id: 'mod-1',
      commentId: 'comment-1',
      actorId: 'acc-moderador',
      action: 'HIDE',
      reason: 'Contenido ofensivo.',
      previousStatus: 'PENDING',
      newStatus: 'HIDDEN',
      createdAt: AT.toISOString(),
      ipAddress: '203.0.113.10',
    })
  })

  it('restore reconstruye la misma instantanea', () => {
    const original = buildAction()
    const snapshot = original.toSnapshot()
    const restored = CommentModerationAction.restore({
      id: CommentModerationActionId.create(snapshot.id),
      commentId: ProductCommentId.create(snapshot.commentId),
      actorId: AuthorId.create(snapshot.actorId),
      action: snapshot.action,
      reason: ModerationReason.create(snapshot.reason),
      previousStatus: snapshot.previousStatus,
      newStatus: snapshot.newStatus,
      createdAt: new Date(snapshot.createdAt),
      ipAddress: snapshot.ipAddress === null ? null : IpAddress.create(snapshot.ipAddress),
    })

    expect(restored.toSnapshot()).toEqual(original.toSnapshot())
  })

  it('restore acepta ipAddress null para compatibilidad con registros historicos', () => {
    const restored = CommentModerationAction.restore({
      id: CommentModerationActionId.create('mod-historico'),
      commentId: ProductCommentId.create('comment-1'),
      actorId: AuthorId.create('acc-moderador'),
      action: ModerationAction.Hide,
      reason: ModerationReason.create('Contenido ofensivo.'),
      previousStatus: CommentModerationStatus.Pending,
      newStatus: CommentModerationStatus.Hidden,
      createdAt: AT,
      ipAddress: null,
    })

    expect(restored.toSnapshot().ipAddress).toBeNull()
  })
})
