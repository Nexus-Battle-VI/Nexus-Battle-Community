import { PublishProductComment } from '../../src/application/use-cases/ProductCommentUseCases'
import type { ProductExistencePort } from '../../src/application/ports/ProductExistencePort'
import { ConfigurableCommentContentModerationPolicy } from '../../src/adapters/outbound/moderation/ConfigurableCommentContentModerationPolicy'
import { InMemoryProductCommentRepository } from '../../src/adapters/outbound/persistence/InMemoryProductCommentRepository'
import { InMemoryAutomaticModerationFlagRepository } from '../../src/adapters/outbound/persistence/InMemoryAutomaticModerationFlagRepository'
import { InMemoryCommentReportRepository } from '../../src/adapters/outbound/persistence/InMemoryCommentReportRepository'
import { InMemoryCommentPublicationTransaction } from '../../src/adapters/outbound/persistence/InMemoryCommentPublicationTransaction'
import { ProductCommentId } from '../../src/domain/value-objects/product-review-values'
import { CommentModerationStatus } from '../../src/domain/value-objects/moderation-values'
import { ModerationSignalRuleType } from '../../src/domain/value-objects/moderation-signal-values'

/**
 * Filtro automatico de contenido (Management#29, HU-41.7): tanto la politica
 * de deteccion en aislamiento como su integracion con la publicacion de un
 * comentario.
 */
const FIXED_NOW = new Date('2026-09-04T10:00:00.000Z')
const PRODUCTO = '3f2a1e4c-6b7d-4a8e-9c1f-2d3e4f5a6b7c'

const sequence = (prefix: string): (() => string) => {
  let counter = 0

  return (): string => {
    counter += 1

    return `${prefix}-${String(counter)}`
  }
}

const fakeCatalog: ProductExistencePort = { exists: (): Promise<boolean> => Promise.resolve(true) }

describe('ConfigurableCommentContentModerationPolicy', () => {
  it('un comentario que no coincide con ninguna regla no genera ninguna candidata', () => {
    const policy = new ConfigurableCommentContentModerationPolicy({
      forbiddenTerms: ['forbidden-test-term'],
      suspiciousPatterns: [/http:\/\/[^\s]+/i],
    })

    expect(policy.evaluate('Excelente producto, lo recomiendo.')).toEqual([])
  })

  it('un termino prohibido configurado genera una candidata, insensible a mayusculas', () => {
    const policy = new ConfigurableCommentContentModerationPolicy({
      forbiddenTerms: ['forbidden-test-term'],
      suspiciousPatterns: [],
    })

    const candidates = policy.evaluate('Esto contiene FORBIDDEN-TEST-TERM en el medio.')

    expect(candidates).toEqual([
      { ruleType: ModerationSignalRuleType.ForbiddenTerm, match: 'forbidden-test-term' },
    ])
  })

  it('un patron sospechoso configurado genera una candidata con el fragmento que coincidio', () => {
    const policy = new ConfigurableCommentContentModerationPolicy({
      forbiddenTerms: [],
      suspiciousPatterns: [/http:\/\/[^\s]+/i],
    })

    const candidates = policy.evaluate('Visita http://enlace-sospechoso.test ya mismo.')

    expect(candidates).toEqual([
      {
        ruleType: ModerationSignalRuleType.SuspiciousPattern,
        match: 'http://enlace-sospechoso.test',
      },
    ])
  })

  it('sin terminos ni patrones configurados, nunca genera candidatas', () => {
    const policy = new ConfigurableCommentContentModerationPolicy({
      forbiddenTerms: [],
      suspiciousPatterns: [],
    })

    expect(policy.evaluate('forbidden-test-term http://cualquier-cosa.test')).toEqual([])
  })
})

describe('PublishProductComment con filtro automatico (HU-41.7)', () => {
  const buildHarness = (): {
    comments: InMemoryProductCommentRepository
    automaticFlags: InMemoryAutomaticModerationFlagRepository
    reports: InMemoryCommentReportRepository
    publish: PublishProductComment
  } => {
    const comments = new InMemoryProductCommentRepository()
    const automaticFlags = new InMemoryAutomaticModerationFlagRepository()
    const reports = new InMemoryCommentReportRepository()

    const publish = new PublishProductComment({
      transaction: new InMemoryCommentPublicationTransaction({
        comments,
        automaticModerationFlags: automaticFlags,
      }),
      catalog: fakeCatalog,
      clock: { now: (): Date => FIXED_NOW },
      ids: { generate: sequence('comment') },
      moderationPolicy: new ConfigurableCommentContentModerationPolicy({
        forbiddenTerms: ['forbidden-test-term'],
        suspiciousPatterns: [],
      }),
    })

    return { comments, automaticFlags, reports, publish }
  }

  it('un comentario sin coincidencias se publica sin generar ninguna senal', async () => {
    const h = buildHarness()

    const dto = await h.publish.execute({
      productId: PRODUCTO,
      authorId: 'acc-autor',
      content: 'Un comentario perfectamente normal.',
    })

    expect(dto.moderationStatus).toBe(CommentModerationStatus.Pending)
    expect(h.automaticFlags.size).toBe(0)
  })

  it('un comentario con un termino prohibido se publica normalmente Y queda con una senal registrada', async () => {
    const h = buildHarness()

    const dto = await h.publish.execute({
      productId: PRODUCTO,
      authorId: 'acc-autor',
      content: 'Este comentario contiene forbidden-test-term.',
    })

    // No se sanciona ni se elimina: el comentario sigue PENDING, visible y sin tocar.
    expect(dto.moderationStatus).toBe(CommentModerationStatus.Pending)

    const flags = await h.automaticFlags.listByComment(ProductCommentId.create(dto.id))
    expect(flags).toHaveLength(1)
    expect(flags[0]?.toSnapshot()).toMatchObject({
      commentId: dto.id,
      source: 'AUTOMATIC_FILTER',
      ruleType: ModerationSignalRuleType.ForbiddenTerm,
      match: 'forbidden-test-term',
    })
  })

  it('una senal automatica NUNCA crea un CommentReport (no hay reportes falsos de HU-46)', async () => {
    const h = buildHarness()

    await h.publish.execute({
      productId: PRODUCTO,
      authorId: 'acc-autor',
      content: 'Contiene forbidden-test-term otra vez.',
    })

    expect(h.reports.size).toBe(0)
  })

  it('no sanciona ni elimina automaticamente: el comentario permanece legible y consultable', async () => {
    const h = buildHarness()

    const dto = await h.publish.execute({
      productId: PRODUCTO,
      authorId: 'acc-autor',
      content: 'forbidden-test-term en el contenido.',
    })

    const stored = await h.comments.findById(ProductCommentId.create(dto.id))
    expect(stored).not.toBeNull()
    expect(stored?.currentModerationStatus).toBe(CommentModerationStatus.Pending)
    expect(stored?.currentContent.value).toBe('forbidden-test-term en el contenido.')
  })
})
