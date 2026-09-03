import { AuthorId } from '../../src/domain/value-objects/community-values'
import { ProductCommentId } from '../../src/domain/value-objects/product-review-values'
import {
  ALL_REPORT_CATEGORIES,
  CommentReportId,
  ReportCategory,
  ReportDescription,
  isReportCategory,
} from '../../src/domain/value-objects/comment-report-values'
import { CommentReport } from '../../src/domain/entities/CommentReport'
import { DomainError } from '../../src/domain/errors/DomainError'

const AT = new Date('2026-09-03T10:00:00.000Z')

describe('CommentReportId', () => {
  it('rechaza un valor vacio', () => {
    expect(() => CommentReportId.create('   ')).toThrow(DomainError)
  })

  it('recorta espacios', () => {
    expect(CommentReportId.create('  report-1  ').value).toBe('report-1')
  })
})

describe('ReportCategory / isReportCategory', () => {
  it('reconoce exactamente las seis categorias de RF-46', () => {
    expect(ALL_REPORT_CATEGORIES).toEqual([
      'SPAM',
      'OFFENSIVE_CONTENT',
      'HARASSMENT',
      'FALSE_INFORMATION',
      'INAPPROPRIATE_CONTENT',
      'COPYRIGHT_VIOLATION',
    ])
  })

  it.each(ALL_REPORT_CATEGORIES)('reconoce %s como categoria valida', (category) => {
    expect(isReportCategory(category)).toBe(true)
  })

  it('rechaza una categoria no definida por RF-46', () => {
    expect(isReportCategory('OTHER')).toBe(false)
    expect(isReportCategory('spam')).toBe(false)
  })
})

describe('ReportDescription', () => {
  it('acepta una descripcion dentro del limite', () => {
    expect(ReportDescription.create('Contenido repetido varias veces.').toString()).toBe(
      'Contenido repetido varias veces.',
    )
  })

  it('rechaza una descripcion vacia o excesiva', () => {
    expect(() => ReportDescription.create('   ')).toThrow(DomainError)
    expect(() => ReportDescription.create('x'.repeat(501))).toThrow(DomainError)
  })

  it('acepta el limite exacto de 500 caracteres', () => {
    expect(() => ReportDescription.create('x'.repeat(500))).not.toThrow()
  })
})

describe('CommentReport', () => {
  const file = (description: ReportDescription | null = null): CommentReport =>
    CommentReport.file({
      id: CommentReportId.create('report-1'),
      commentId: ProductCommentId.create('comment-1'),
      authorId: AuthorId.create('acc-1'),
      category: ReportCategory.Spam,
      description,
      occurredAt: AT,
    })

  it('registra un reporte sin descripcion', () => {
    expect(file().toSnapshot()).toEqual({
      id: 'report-1',
      commentId: 'comment-1',
      authorId: 'acc-1',
      category: 'SPAM',
      description: null,
      createdAt: AT.toISOString(),
    })
  })

  it('registra un reporte con descripcion', () => {
    const report = file(ReportDescription.create('Enlace repetido.'))

    expect(report.toSnapshot().description).toBe('Enlace repetido.')
  })

  it('restore reconstruye el mismo estado', () => {
    const restored = CommentReport.restore({
      id: CommentReportId.create('report-1'),
      commentId: ProductCommentId.create('comment-1'),
      authorId: AuthorId.create('acc-1'),
      category: ReportCategory.Harassment,
      description: null,
      createdAt: AT,
    })

    expect(restored.toSnapshot().category).toBe('HARASSMENT')
  })
})
