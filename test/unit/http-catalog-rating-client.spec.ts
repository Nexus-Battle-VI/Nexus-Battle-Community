import { HttpCatalogRatingClient } from '../../src/adapters/outbound/catalog/HttpCatalogRatingClient'
import { createLogger } from '../../src/infrastructure/observability/logger'
import {
  INTERNAL_SERVICE_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
} from '../../src/adapters/outbound/identity/internal-signature'

const silentLogger = createLogger({
  level: 'error',
  service: 'test',
  version: '0.0.0',
  sink: () => undefined,
})

const buildClient = (fetchImpl: typeof fetch): HttpCatalogRatingClient =>
  new HttpCatalogRatingClient({
    baseUrl: 'http://catalog:3003',
    secret: 'secreto-ficticio-solo-para-pruebas',
    serviceName: 'community',
    timeoutMs: 2_000,
    logger: silentLogger,
    fetchImpl,
  })

describe('HttpCatalogRatingClient (HU-40, CA-03)', () => {
  it('firma y envia el agregado al contrato interno de Catalog', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const client = buildClient(fetchImpl)

    await client.publish('3f2a1e4c-6b7d-4a8e-9c1f-2d3e4f5a6b7c', {
      averageRating: 4.5,
      reviewCount: 2,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'http://catalog:3003/internal/v1/catalog/products/3f2a1e4c-6b7d-4a8e-9c1f-2d3e4f5a6b7c/rating',
    )
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ averageRating: 4.5, reviewCount: 2 }))
    const headers = init.headers as Record<string, string>
    expect(headers[INTERNAL_SERVICE_HEADER]).toBe('community')
    expect(typeof headers[INTERNAL_TIMESTAMP_HEADER]).toBe('string')
    expect(typeof headers[INTERNAL_SIGNATURE_HEADER]).toBe('string')
  })

  it('nunca lanza cuando Catalog responde con un error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 404 }))
    const client = buildClient(fetchImpl)

    await expect(
      client.publish('producto-inexistente', { averageRating: 5, reviewCount: 1 }),
    ).resolves.toBeUndefined()
  })

  it('nunca lanza cuando la peticion falla por completo', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const client = buildClient(fetchImpl)

    await expect(
      client.publish('cualquier-producto', { averageRating: null, reviewCount: 0 }),
    ).resolves.toBeUndefined()
  })

  it('empuja un promedio null cuando el producto se queda sin calificaciones', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const client = buildClient(fetchImpl)

    await client.publish('producto-sin-calificar', { averageRating: null, reviewCount: 0 })

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBe(JSON.stringify({ averageRating: null, reviewCount: 0 }))
  })
})
