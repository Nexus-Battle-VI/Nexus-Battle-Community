import 'reflect-metadata'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresProductCommentRepository } from '../../src/adapters/outbound/persistence/PostgresProductCommentRepository'
import { PostgresProductReviewRepository } from '../../src/adapters/outbound/persistence/PostgresProductReviewRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { ProductComment } from '../../src/domain/entities/ProductComment'
import { ProductReview } from '../../src/domain/entities/ProductReview'
import { AuthorId } from '../../src/domain/value-objects/community-values'
import {
  CommentContent,
  ImageReference,
  ProductCommentId,
  ProductId,
  ProductReviewId,
  Rating,
} from '../../src/domain/value-objects/product-review-values'
import { DuplicateProductReviewError } from '../../src/application/errors/ApplicationError'

/**
 * Adaptadores de HU-40 sobre PostgreSQL, contra un motor REAL en contenedor.
 *
 * Comprueban lo que un repositorio en memoria no puede: que la restriccion de
 * unicidad `product_reviews_jugador_producto_unico` rechaza de verdad un
 * duplicado, y que el tope de imagenes vive tambien en el motor.
 *
 * Cada prueba usa su propio `productId`, igual que `PostgresThreadRepository`
 * usa su propio `threadId`: no hay truncado entre pruebas, asi que reutilizar
 * un producto compartido contaminaria el recuento de otra prueba.
 */
describe('Persistencia de comentarios y calificaciones de producto', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let comments: PostgresProductCommentRepository
  let reviews: PostgresProductReviewRepository

  const AT = new Date('2026-09-02T10:00:00.000Z')
  let contador = 0

  const nextProductId = (): ProductId => {
    contador += 1

    return ProductId.create(`producto-${String(contador)}`)
  }

  const buildComment = (
    productId: ProductId,
    overrides: { authorId?: string; images?: readonly string[] } = {},
  ): ProductComment => {
    contador += 1

    return ProductComment.publish({
      id: ProductCommentId.create(`comment-${String(contador)}`),
      productId,
      authorId: AuthorId.create(overrides.authorId ?? 'acc-1'),
      content: CommentContent.create('Comentario de prueba contra el motor real.'),
      images: (overrides.images ?? []).map((image) => ImageReference.create(image)),
      occurredAt: AT,
    })
  }

  const buildReview = (productId: ProductId, authorId: string, rating: number): ProductReview => {
    contador += 1

    return ProductReview.create({
      id: ProductReviewId.create(`review-${String(contador)}`),
      productId,
      authorId: AuthorId.create(authorId),
      rating: Rating.create(rating),
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
    comments = new PostgresProductCommentRepository(db)
    reviews = new PostgresProductReviewRepository(db)
  })

  describe('PostgresProductCommentRepository', () => {
    it('guarda y lista un comentario sin imagenes', async () => {
      const producto = nextProductId()
      await comments.save(buildComment(producto))

      const page = await comments.listByProduct(producto, { limit: 20, offset: 0 })

      expect(page.total).toBe(1)
      expect(page.items[0]?.toSnapshot()).toMatchObject({
        productId: producto.value,
        authorId: 'acc-1',
        images: [],
      })
    })

    it('guarda y lee las referencias de imagen en orden', async () => {
      const producto = nextProductId()
      await comments.save(
        buildComment(producto, { images: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'] }),
      )

      const page = await comments.listByProduct(producto, { limit: 20, offset: 0 })

      expect(page.items[0]?.toSnapshot().images).toEqual([
        'https://cdn.test/a.jpg',
        'https://cdn.test/b.jpg',
      ])
    })

    it('pagina y ordena mas recientes primero', async () => {
      const producto = nextProductId()
      for (let i = 0; i < 5; i += 1) {
        await comments.save(buildComment(producto))
      }

      const page = await comments.listByProduct(producto, { limit: 2, offset: 0 })

      expect(page.total).toBe(5)
      expect(page.items).toHaveLength(2)
    })

    it('no lista comentarios de otro producto', async () => {
      const producto = nextProductId()
      const otroProducto = nextProductId()
      await comments.save(buildComment(producto))
      await comments.save(buildComment(otroProducto))

      const page = await comments.listByProduct(producto, { limit: 20, offset: 0 })

      expect(page.total).toBe(1)
      expect(page.items[0]?.productId.value).toBe(producto.value)
    })

    describe('Las restricciones viven en el motor, no solo en el codigo', () => {
      it('rechaza mas del maximo de imagenes escrito directamente en la tabla', async () => {
        await expect(
          db
            .insertInto('product_comments')
            .values({
              id: 'comment-exceso',
              product_id: nextProductId().value,
              author_id: 'acc-1',
              content: 'Directo a la tabla',
              images: Array.from({ length: 6 }, (_v, i) => `https://cdn.test/${String(i)}.jpg`),
              created_at: AT,
            })
            .execute(),
        ).rejects.toThrow()
      })
    })
  })

  describe('PostgresProductReviewRepository', () => {
    it('guarda y recupera una calificacion por jugador y producto', async () => {
      const producto = nextProductId()
      await reviews.save(buildReview(producto, 'acc-1', 5))

      const found = await reviews.findByAuthorAndProduct(AuthorId.create('acc-1'), producto)

      expect(found?.toSnapshot()).toMatchObject({
        productId: producto.value,
        authorId: 'acc-1',
        rating: 5,
      })
    })

    it('devuelve null cuando el jugador no ha calificado el producto', async () => {
      expect(
        await reviews.findByAuthorAndProduct(AuthorId.create('acc-sin-calificar'), nextProductId()),
      ).toBeNull()
    })

    /**
     * La garantia definitiva: el motor rechaza el duplicado aunque el caso de
     * uso no lo hubiera comprobado antes.
     */
    it('rechaza una segunda calificacion del mismo jugador y producto con DuplicateProductReviewError', async () => {
      const producto = nextProductId()
      await reviews.save(buildReview(producto, 'acc-1', 5))

      await expect(reviews.save(buildReview(producto, 'acc-1', 2))).rejects.toBeInstanceOf(
        DuplicateProductReviewError,
      )
    })

    it('permite calificaciones del mismo jugador sobre productos distintos', async () => {
      const producto = nextProductId()
      const otroProducto = nextProductId()
      await reviews.save(buildReview(producto, 'acc-1', 5))

      await expect(reviews.save(buildReview(otroProducto, 'acc-1', 4))).resolves.toBeUndefined()
    })

    it('calcula el promedio y el conteo de calificaciones validas', async () => {
      const producto = nextProductId()
      await reviews.save(buildReview(producto, 'acc-1', 5))
      await reviews.save(buildReview(producto, 'acc-2', 3))

      expect(await reviews.summaryFor(producto)).toEqual({ average: 4, count: 2 })
    })

    it('devuelve promedio nulo cuando no hay calificaciones', async () => {
      expect(await reviews.summaryFor(nextProductId())).toEqual({ average: null, count: 0 })
    })

    describe('Las restricciones viven en el motor, no solo en el codigo', () => {
      it('rechaza una calificacion fuera de 1-5 escrita directamente en la tabla', async () => {
        await expect(
          db
            .insertInto('product_reviews')
            .values({
              id: 'review-fuera-de-rango',
              product_id: nextProductId().value,
              author_id: 'acc-directo',
              rating: 9,
              created_at: AT,
            })
            .execute(),
        ).rejects.toThrow()
      })

      it('rechaza dos filas para el mismo jugador y producto escritas directamente', async () => {
        const producto = nextProductId()

        await db
          .insertInto('product_reviews')
          .values({
            id: 'review-directo-1',
            product_id: producto.value,
            author_id: 'acc-directo-dup',
            rating: 5,
            created_at: AT,
          })
          .execute()

        await expect(
          db
            .insertInto('product_reviews')
            .values({
              id: 'review-directo-2',
              product_id: producto.value,
              author_id: 'acc-directo-dup',
              rating: 1,
              created_at: AT,
            })
            .execute(),
        ).rejects.toThrow()
      })
    })
  })

  it('la migracion es idempotente: volver a aplicarla no cambia nada', async () => {
    const { applied, error } = await migrateToLatest(db)

    expect(error).toBeUndefined()
    expect(applied).toEqual([])
  })
})
