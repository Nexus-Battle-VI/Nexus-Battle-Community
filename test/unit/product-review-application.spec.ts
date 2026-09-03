import {
  ListProductComments,
  PublishProductComment,
} from '../../src/application/use-cases/ProductCommentUseCases'
import { GetProductReviewSummary, RateProduct } from '../../src/application/use-cases/ProductReviewUseCases'
import {
  DuplicateProductReviewError,
  ProductNotFoundError,
} from '../../src/application/errors/ApplicationError'
import type { ProductExistencePort } from '../../src/application/ports/ProductExistencePort'
import { InMemoryProductCommentRepository } from '../../src/adapters/outbound/persistence/InMemoryProductCommentRepository'
import { InMemoryProductReviewRepository } from '../../src/adapters/outbound/persistence/InMemoryProductReviewRepository'
import { DomainError } from '../../src/domain/errors/DomainError'

const FIXED_NOW = new Date('2026-09-02T10:00:00.000Z')
const PRODUCTO = '3f2a1e4c-6b7d-4a8e-9c1f-2d3e4f5a6b7c'
const OTRO_PRODUCTO = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d'
const PRODUCTO_INEXISTENTE = '00000000-0000-4000-8000-000000000000'

const sequence = (prefix: string): (() => string) => {
  let counter = 0

  return (): string => {
    counter += 1

    return `${prefix}-${String(counter)}`
  }
}

const fakeCatalog = (known: readonly string[]): ProductExistencePort => ({
  exists: (productId: string): Promise<boolean> => Promise.resolve(known.includes(productId)),
})

interface Harness {
  comments: InMemoryProductCommentRepository
  reviews: InMemoryProductReviewRepository
  publish: PublishProductComment
  list: ListProductComments
  rate: RateProduct
  summary: GetProductReviewSummary
}

const buildHarness = (known: readonly string[] = [PRODUCTO, OTRO_PRODUCTO]): Harness => {
  const comments = new InMemoryProductCommentRepository()
  const reviews = new InMemoryProductReviewRepository()
  const catalog = fakeCatalog(known)
  const clock = { now: (): Date => FIXED_NOW }

  return {
    comments,
    reviews,
    publish: new PublishProductComment({ comments, catalog, clock, ids: { generate: sequence('comment') } }),
    list: new ListProductComments(comments),
    rate: new RateProduct({ reviews, catalog, clock, ids: { generate: sequence('review') } }),
    summary: new GetProductReviewSummary(reviews),
  }
}

describe('PublishProductComment', () => {
  it('publica un comentario asociado al producto y al autor del testimonio', async () => {
    const harness = buildHarness()

    const result = await harness.publish.execute({
      productId: PRODUCTO,
      authorId: 'acc-1',
      content: 'Excelente calidad, lo recomiendo.',
    })

    expect(result).toMatchObject({
      productId: PRODUCTO,
      authorId: 'acc-1',
      content: 'Excelente calidad, lo recomiendo.',
      images: [],
    })
    expect(harness.comments.size).toBe(1)
  })

  it('acepta imagenes opcionales', async () => {
    const harness = buildHarness()

    const result = await harness.publish.execute({
      productId: PRODUCTO,
      authorId: 'acc-1',
      content: 'Con foto.',
      images: ['https://cdn.test/foto.jpg'],
    })

    expect(result.images).toEqual(['https://cdn.test/foto.jpg'])
  })

  it('falla cuando el producto no existe', async () => {
    const harness = buildHarness()

    await expect(
      harness.publish.execute({ productId: PRODUCTO_INEXISTENTE, authorId: 'acc-1', content: 'Hola' }),
    ).rejects.toBeInstanceOf(ProductNotFoundError)
    expect(harness.comments.size).toBe(0)
  })

  it('rechaza contenido vacio o excesivo, sin dejar un registro parcial', async () => {
    const harness = buildHarness()

    await expect(
      harness.publish.execute({ productId: PRODUCTO, authorId: 'acc-1', content: '   ' }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(harness.comments.size).toBe(0)
  })

  /**
   * El caso central de la resolucion de diseno: HU-40 no limita la cantidad
   * de comentarios por producto, a diferencia de `ModerationPolicy` de Thread.
   */
  it('no impone limite de comentarios por producto', async () => {
    const harness = buildHarness()

    for (let i = 0; i < 25; i += 1) {
      await harness.publish.execute({
        productId: PRODUCTO,
        authorId: `acc-${String(i)}`,
        content: `Comentario numero ${String(i)}`,
      })
    }

    expect(harness.comments.size).toBe(25)
  })

  it('un jugador puede publicar varios comentarios sobre el mismo producto', async () => {
    const harness = buildHarness()

    await harness.publish.execute({ productId: PRODUCTO, authorId: 'acc-1', content: 'Uno' })
    await harness.publish.execute({ productId: PRODUCTO, authorId: 'acc-1', content: 'Dos' })

    const page = await harness.list.execute({ productId: PRODUCTO })
    expect(page.total).toBe(2)
  })
})

describe('ListProductComments', () => {
  it('lista los comentarios de un producto, mas recientes primero', async () => {
    const harness = buildHarness()
    await harness.publish.execute({ productId: PRODUCTO, authorId: 'acc-1', content: 'Primero' })
    await harness.publish.execute({ productId: PRODUCTO, authorId: 'acc-2', content: 'Segundo' })
    await harness.publish.execute({ productId: OTRO_PRODUCTO, authorId: 'acc-3', content: 'De otro producto' })

    const page = await harness.list.execute({ productId: PRODUCTO })

    expect(page.total).toBe(2)
    expect(page.items.map((item) => item.content)).toEqual(['Segundo', 'Primero'])
  })

  it('pagina con limite y desplazamiento', async () => {
    const harness = buildHarness()
    for (let i = 0; i < 5; i += 1) {
      await harness.publish.execute({ productId: PRODUCTO, authorId: 'acc-1', content: `C${String(i)}` })
    }

    const page = await harness.list.execute({ productId: PRODUCTO, limit: 2, offset: 1 })

    expect(page.items).toHaveLength(2)
    expect(page.total).toBe(5)
    expect(page.limit).toBe(2)
    expect(page.offset).toBe(1)
  })

  it('acota el limite al maximo permitido', async () => {
    const harness = buildHarness()

    const page = await harness.list.execute({ productId: PRODUCTO, limit: 10_000 })

    expect(page.limit).toBe(100)
  })

  it('devuelve una pagina vacia cuando el producto no tiene comentarios', async () => {
    const harness = buildHarness()

    expect(await harness.list.execute({ productId: PRODUCTO })).toEqual({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    })
  })
})

describe('RateProduct', () => {
  it('registra una calificacion valida', async () => {
    const harness = buildHarness()

    const result = await harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-1', rating: 5 })

    expect(result).toMatchObject({ productId: PRODUCTO, authorId: 'acc-1', rating: 5 })
  })

  it('falla cuando el producto no existe', async () => {
    const harness = buildHarness()

    await expect(
      harness.rate.execute({ productId: PRODUCTO_INEXISTENTE, authorId: 'acc-1', rating: 5 }),
    ).rejects.toBeInstanceOf(ProductNotFoundError)
  })

  it('rechaza una calificacion fuera de la escala 1-5', async () => {
    const harness = buildHarness()

    await expect(
      harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-1', rating: 6 }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  /**
   * El caso que motiva HU-40.3: un jugador que ya califico no puede volver a
   * calificar el mismo producto.
   */
  it('DENIEGA una segunda calificacion del mismo jugador sobre el mismo producto', async () => {
    const harness = buildHarness()
    await harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-1', rating: 3 })

    await expect(
      harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-1', rating: 5 }),
    ).rejects.toBeInstanceOf(DuplicateProductReviewError)
  })

  it('el mismo jugador puede calificar productos distintos', async () => {
    const harness = buildHarness()
    await harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-1', rating: 3 })

    await expect(
      harness.rate.execute({ productId: OTRO_PRODUCTO, authorId: 'acc-1', rating: 4 }),
    ).resolves.toMatchObject({ productId: OTRO_PRODUCTO })
  })

  it('productos distintos jugadores pueden calificar el mismo producto', async () => {
    const harness = buildHarness()
    await harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-1', rating: 3 })

    await expect(
      harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-2', rating: 4 }),
    ).resolves.toMatchObject({ authorId: 'acc-2' })
  })

  /**
   * Dos solicitudes concurrentes del mismo jugador para el mismo producto:
   * la garantia final la da `save`, no solo la comprobacion previa.
   */
  it('ante dos solicitudes concurrentes solo una calificacion queda registrada', async () => {
    const harness = buildHarness()

    const results = await Promise.allSettled([
      harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-1', rating: 4 }),
      harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-1', rating: 2 }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(harness.reviews.size).toBe(1)
  })

  /**
   * Retirar un comentario no borra la calificacion, y calificar no limita
   * los comentarios: son entidades independientes.
   */
  it('calificar un producto no impide seguir publicando comentarios sobre el', async () => {
    const harness = buildHarness()
    await harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-1', rating: 5 })

    await harness.publish.execute({ productId: PRODUCTO, authorId: 'acc-1', content: 'Un comentario mas' })
    await harness.publish.execute({ productId: PRODUCTO, authorId: 'acc-1', content: 'Y otro' })

    const page = await harness.list.execute({ productId: PRODUCTO })
    expect(page.total).toBe(2)
  })
})

describe('GetProductReviewSummary', () => {
  it('calcula el promedio de las calificaciones validas', async () => {
    const harness = buildHarness()
    await harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-1', rating: 5 })
    await harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-2', rating: 3 })

    expect(await harness.summary.execute(PRODUCTO)).toEqual({
      productId: PRODUCTO,
      average: 4,
      count: 2,
    })
  })

  it('devuelve promedio nulo cuando el producto no tiene calificaciones', async () => {
    const harness = buildHarness()

    expect(await harness.summary.execute(PRODUCTO)).toEqual({
      productId: PRODUCTO,
      average: null,
      count: 0,
    })
  })

  it('no mezcla calificaciones de productos distintos', async () => {
    const harness = buildHarness()
    await harness.rate.execute({ productId: PRODUCTO, authorId: 'acc-1', rating: 1 })
    await harness.rate.execute({ productId: OTRO_PRODUCTO, authorId: 'acc-1', rating: 5 })

    expect((await harness.summary.execute(PRODUCTO)).average).toBe(1)
    expect((await harness.summary.execute(OTRO_PRODUCTO)).average).toBe(5)
  })
})
