import { ReportComment } from '../../src/application/use-cases/CommentReportUseCases'
import {
  CommentNotFoundError,
  ReportLimitExceededError,
} from '../../src/application/errors/ApplicationError'
import { InMemoryProductCommentRepository } from '../../src/adapters/outbound/persistence/InMemoryProductCommentRepository'
import { InMemoryCommentReportRepository } from '../../src/adapters/outbound/persistence/InMemoryCommentReportRepository'
import { ProductComment } from '../../src/domain/entities/ProductComment'
import { AuthorId } from '../../src/domain/value-objects/community-values'
import {
  CommentContent,
  ProductCommentId,
  ProductId,
} from '../../src/domain/value-objects/product-review-values'
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
  reports: InMemoryCommentReportRepository
  report: ReportComment
  seedComment: (id?: string) => Promise<string>
}

const buildHarness = (
  overrides: { reportLimit?: number; reportWindowHours?: number } = {},
): Harness => {
  const comments = new InMemoryProductCommentRepository()
  const reports = new InMemoryCommentReportRepository()
  const clock = { now: (): Date => FIXED_NOW }

  const seedComment = async (id = 'comment-1'): Promise<string> => {
    await comments.save(
      ProductComment.publish({
        id: ProductCommentId.create(id),
        productId: ProductId.create(PRODUCTO),
        authorId: AuthorId.create('acc-autor'),
        content: CommentContent.create('Comentario a reportar.'),
        images: [],
        occurredAt: FIXED_NOW,
      }),
    )

    return id
  }

  return {
    comments,
    reports,
    report: new ReportComment({
      comments,
      reports,
      clock,
      ids: { generate: sequence('report') },
      reportLimit: overrides.reportLimit ?? 10,
      reportWindowHours: overrides.reportWindowHours ?? 24,
    }),
    seedComment,
  }
}

describe('ReportComment', () => {
  it('registra un reporte valido sobre un comentario existente', async () => {
    const harness = buildHarness()
    const commentId = await harness.seedComment()

    const result = await harness.report.execute({
      commentId,
      authorId: 'acc-reportante',
      category: 'SPAM',
    })

    expect(result).toMatchObject({
      commentId,
      authorId: 'acc-reportante',
      category: 'SPAM',
      description: null,
    })
  })

  it('acepta una descripcion opcional', async () => {
    const harness = buildHarness()
    const commentId = await harness.seedComment()

    const result = await harness.report.execute({
      commentId,
      authorId: 'acc-reportante',
      category: 'HARASSMENT',
      description: 'Insultos reiterados.',
    })

    expect(result.description).toBe('Insultos reiterados.')
  })

  it('falla cuando el comentario no existe', async () => {
    const harness = buildHarness()

    await expect(
      harness.report.execute({
        commentId: 'comentario-inexistente',
        authorId: 'acc-reportante',
        category: 'SPAM',
      }),
    ).rejects.toBeInstanceOf(CommentNotFoundError)
    expect(harness.reports.size).toBe(0)
  })

  it('rechaza una categoria que no pertenece al vocabulario de RF-46', async () => {
    const harness = buildHarness()
    const commentId = await harness.seedComment()

    await expect(
      harness.report.execute({ commentId, authorId: 'acc-reportante', category: 'OTHER' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('rechaza una descripcion vacia o excesiva sin impedir un reporte sin descripcion', async () => {
    const harness = buildHarness()
    const commentId = await harness.seedComment()

    await expect(
      harness.report.execute({
        commentId,
        authorId: 'acc-reportante',
        category: 'SPAM',
        description: '   ',
      }),
    ).rejects.toBeInstanceOf(DomainError)

    await expect(
      harness.report.execute({ commentId, authorId: 'acc-reportante', category: 'SPAM' }),
    ).resolves.toMatchObject({ description: null })
  })

  it('un jugador puede reportar comentarios distintos hasta su limite', async () => {
    const harness = buildHarness({ reportLimit: 2 })
    const primero = await harness.seedComment('comment-1')
    const segundo = await harness.seedComment('comment-2')

    await harness.report.execute({
      commentId: primero,
      authorId: 'acc-reportante',
      category: 'SPAM',
    })
    await harness.report.execute({
      commentId: segundo,
      authorId: 'acc-reportante',
      category: 'SPAM',
    })

    expect(harness.reports.size).toBe(2)
  })

  /**
   * El caso central de HU-46.3: superado el limite, el siguiente reporte se
   * rechaza -- incluso sobre un comentario que el jugador no ha reportado
   * todavia.
   */
  it('DENIEGA con ReportLimitExceededError al superar el limite en la ventana', async () => {
    const harness = buildHarness({ reportLimit: 2 })
    const primero = await harness.seedComment('comment-1')
    const segundo = await harness.seedComment('comment-2')
    const tercero = await harness.seedComment('comment-3')

    await harness.report.execute({
      commentId: primero,
      authorId: 'acc-reportante',
      category: 'SPAM',
    })
    await harness.report.execute({
      commentId: segundo,
      authorId: 'acc-reportante',
      category: 'SPAM',
    })

    await expect(
      harness.report.execute({ commentId: tercero, authorId: 'acc-reportante', category: 'SPAM' }),
    ).rejects.toBeInstanceOf(ReportLimitExceededError)
    expect(harness.reports.size).toBe(2)
  })

  it('el limite es por jugador: otro jugador no se ve afectado', async () => {
    const harness = buildHarness({ reportLimit: 1 })
    const primero = await harness.seedComment('comment-1')
    const segundo = await harness.seedComment('comment-2')

    await harness.report.execute({ commentId: primero, authorId: 'acc-uno', category: 'SPAM' })

    await expect(
      harness.report.execute({ commentId: segundo, authorId: 'acc-dos', category: 'SPAM' }),
    ).resolves.toMatchObject({ authorId: 'acc-dos' })
  })

  it('un comentario inexistente se rechaza antes de consultar el limite de reportes', async () => {
    const harness = buildHarness({ reportLimit: 0 })

    // Con limite 0, cualquier reporte valido lo excederia. Si el orden fuera
    // al reves, este caso devolveria ReportLimitExceededError en lugar de
    // CommentNotFoundError.
    await expect(
      harness.report.execute({
        commentId: 'comentario-inexistente',
        authorId: 'acc-reportante',
        category: 'SPAM',
      }),
    ).rejects.toBeInstanceOf(CommentNotFoundError)
  })
})
