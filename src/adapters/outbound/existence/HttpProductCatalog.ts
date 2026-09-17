import {
  CatalogUnavailableError,
  type ProductExistencePort,
} from '../../../application/ports/ProductExistencePort'

export interface HttpProductCatalogOptions {
  /** URL publica de Catalog, sin barra final. */
  readonly baseUrl: string
  readonly timeoutMs: number
  /** Inyectable para pruebas; por defecto el `fetch` global de Node. */
  readonly fetch?: typeof fetch
}

/**
 * Adaptador HTTP contra el contrato de lectura publica de Catalog
 * (`GET /api/v1/catalog/products/:reference`), el mismo que ya usa
 * `HttpCatalogReadClient` en Player-Inventory y acepta tanto `productId` como
 * `sku`.
 *
 * Solo comprueba existencia: no proyecta ni interpreta el resto del cuerpo,
 * asi que un producto con cualquier forma responde 200 igual.
 */
export class HttpProductCatalog implements ProductExistencePort {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: HttpProductCatalogOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs
    this.fetchImpl = options.fetch ?? fetch
  }

  async exists(productId: string): Promise<boolean> {
    let response: Response
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/api/v1/catalog/products/${encodeURIComponent(productId)}`,
        { method: 'GET', signal: AbortSignal.timeout(this.timeoutMs) },
      )
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new CatalogUnavailableError(detail)
    }

    if (response.status === 404) {
      return false
    }

    if (!response.ok) {
      throw new CatalogUnavailableError(
        `respuesta ${String(response.status)} al recuperar el producto`,
      )
    }

    return true
  }
}
