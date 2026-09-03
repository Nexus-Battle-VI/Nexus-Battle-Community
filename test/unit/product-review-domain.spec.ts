import { AuthorId } from '../../src/domain/value-objects/community-values'
import {
  CommentContent,
  ImageReference,
  MAX_COMMENT_IMAGES,
  ProductCommentId,
  ProductId,
  ProductReviewId,
  Rating,
} from '../../src/domain/value-objects/product-review-values'
import { ProductComment } from '../../src/domain/entities/ProductComment'
import { ProductReview } from '../../src/domain/entities/ProductReview'
import { DomainError } from '../../src/domain/errors/DomainError'
import { CommentModerationStatus } from '../../src/domain/value-objects/moderation-values'

const AT = new Date('2026-09-02T10:00:00.000Z')

const PRODUCTO_UUID = '3f2a1e4c-6b7d-4a8e-9c1f-2d3e4f5a6b7c'

describe('ProductCommentId, ProductReviewId', () => {
  it.each([
    ['ProductCommentId', ProductCommentId],
    ['ProductReviewId', ProductReviewId],
  ])('%s rechaza un valor vacio', (_nombre, Type) => {
    expect(() => Type.create('   ')).toThrow(DomainError)
  })
})

describe('ProductId', () => {
  /**
   * El MISMO patron UUID que `ProductId` exige en `Nexus-Battle-Catalog`:
   * ambos describen el mismo identificador, visto desde dos servicios.
   */
  it('acepta un UUID valido y lo normaliza a minusculas', () => {
    const a = ProductId.create(`  ${PRODUCTO_UUID.toUpperCase()}  `)
    const b = ProductId.create(PRODUCTO_UUID)

    expect(a.value).toBe(PRODUCTO_UUID)
    expect(a.equals(b)).toBe(true)
  })

  it.each([
    ['esta vacio', '   '],
    ['no es un UUID', 'producto-1'],
    ['le falta un segmento', '3f2a1e4c-6b7d-4a8e-9c1f'],
    ['tiene el nibble de version fuera de rango', '3f2a1e4c-6b7d-6a8e-9c1f-2d3e4f5a6b7c'],
    ['tiene el nibble de variante fuera de rango', '3f2a1e4c-6b7d-4a8e-1c1f-2d3e4f5a6b7c'],
  ])('rechaza un identificador que %s', (_caso, raw) => {
    expect(() => ProductId.create(raw)).toThrow(DomainError)
  })
})

describe('CommentContent', () => {
  it('rechaza contenido vacio o excesivo', () => {
    expect(() => CommentContent.create('   ')).toThrow(DomainError)
    expect(() => CommentContent.create('x'.repeat(2_001))).toThrow(DomainError)
  })

  it('acepta el limite exacto de 2000 caracteres', () => {
    expect(CommentContent.create('x'.repeat(2_000)).length).toBe(2_000)
  })

  it('normaliza saltos de linea y recorta, sin colapsar espacios internos', () => {
    expect(CommentContent.create('  Muy   bueno\r\neste producto  ').value).toBe(
      'Muy   bueno\neste producto',
    )
  })
})

describe('ImageReference', () => {
  it('acepta una URL http o https valida', () => {
    expect(ImageReference.create('https://cdn.example.test/foto.jpg').value).toBe(
      'https://cdn.example.test/foto.jpg',
    )
    expect(ImageReference.create('http://cdn.example.test/foto.jpg').value).toBe(
      'http://cdn.example.test/foto.jpg',
    )
  })

  it.each([
    ['no es una URL', 'no-es-una-url'],
    ['usa un protocolo no permitido', 'ftp://cdn.example.test/foto.jpg'],
    ['esta vacia', '   '],
  ])('rechaza una referencia que %s', (_caso, raw) => {
    expect(() => ImageReference.create(raw)).toThrow(DomainError)
  })
})

describe('Rating', () => {
  it('acepta enteros entre 1 y 5', () => {
    for (let value = 1; value <= 5; value += 1) {
      expect(Rating.create(value).value).toBe(value)
    }
  })

  it.each([
    ['cero', 0],
    ['seis', 6],
    ['negativo', -1],
    ['no entero', 3.5],
  ])('rechaza %s', (_caso, value) => {
    expect(() => Rating.create(value)).toThrow(DomainError)
  })
})

describe('ProductComment', () => {
  const publish = (images: readonly string[] = []): ProductComment =>
    ProductComment.publish({
      id: ProductCommentId.create('comment-1'),
      productId: ProductId.create(PRODUCTO_UUID),
      authorId: AuthorId.create('acc-1'),
      content: CommentContent.create('Buen producto, cumple lo prometido.'),
      images: images.map((image) => ImageReference.create(image)),
      occurredAt: AT,
    })

  it('publica un comentario sin imagenes', () => {
    const comment = publish()

    expect(comment.toSnapshot()).toEqual({
      id: 'comment-1',
      productId: PRODUCTO_UUID,
      authorId: 'acc-1',
      content: 'Buen producto, cumple lo prometido.',
      images: [],
      createdAt: AT.toISOString(),
      moderationStatus: 'PENDING',
    })
  })

  it('acepta hasta el maximo de imagenes permitidas', () => {
    const images = Array.from(
      { length: MAX_COMMENT_IMAGES },
      (_v, i) => `https://cdn.test/${String(i)}.jpg`,
    )

    expect(publish(images).images).toHaveLength(MAX_COMMENT_IMAGES)
  })

  it('rechaza superar el maximo de imagenes', () => {
    const images = Array.from(
      { length: MAX_COMMENT_IMAGES + 1 },
      (_v, i) => `https://cdn.test/${String(i)}.jpg`,
    )

    expect(() => publish(images)).toThrow(DomainError)
  })

  it('restore reconstruye el mismo estado sin repetir la validacion de negocio', () => {
    const restored = ProductComment.restore({
      id: ProductCommentId.create('comment-1'),
      productId: ProductId.create(PRODUCTO_UUID),
      authorId: AuthorId.create('acc-1'),
      content: CommentContent.create('Restaurado desde el almacen.'),
      images: [],
      createdAt: AT,
      moderationStatus: CommentModerationStatus.Approved,
    })

    expect(restored.toSnapshot().content).toBe('Restaurado desde el almacen.')
  })
})

describe('ProductReview', () => {
  it('crea y serializa una calificacion valida', () => {
    const review = ProductReview.create({
      id: ProductReviewId.create('review-1'),
      productId: ProductId.create(PRODUCTO_UUID),
      authorId: AuthorId.create('acc-1'),
      rating: Rating.create(5),
      occurredAt: AT,
    })

    expect(review.toSnapshot()).toEqual({
      id: 'review-1',
      productId: PRODUCTO_UUID,
      authorId: 'acc-1',
      rating: 5,
      createdAt: AT.toISOString(),
    })
  })
})
