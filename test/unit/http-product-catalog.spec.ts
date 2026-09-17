import { HttpProductCatalog } from '../../src/adapters/outbound/existence/HttpProductCatalog'
import { CatalogUnavailableError } from '../../src/application/ports/ProductExistencePort'

const jsonResponse = (status: number, body: unknown = {}): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as Response

const catalog = (fetchImpl: typeof fetch): HttpProductCatalog =>
  new HttpProductCatalog({ baseUrl: 'http://catalog:3003/', timeoutMs: 500, fetch: fetchImpl })

describe('HttpProductCatalog — exists', () => {
  it('devuelve true cuando Catalog responde 200', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { productId: 'p-1' }))

    await expect(catalog(fetchImpl).exists('p-1')).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://catalog:3003/api/v1/catalog/products/p-1',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('devuelve false ante un 404', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(404))

    await expect(catalog(fetchImpl).exists('fantasma')).resolves.toBe(false)
  })

  it('traduce un 5xx a CatalogUnavailableError, no a "no existe"', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(502))

    await expect(catalog(fetchImpl).exists('x')).rejects.toBeInstanceOf(CatalogUnavailableError)
  })

  it('traduce un fallo de red o timeout a CatalogUnavailableError', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('The operation was aborted'))

    await expect(catalog(fetchImpl).exists('x')).rejects.toBeInstanceOf(CatalogUnavailableError)
  })
})
