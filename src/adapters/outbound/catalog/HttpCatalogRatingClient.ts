import type {
  ProductRatingAggregate,
  ProductRatingPublisherPort,
} from '../../../application/ports/ProductRatingPublisherPort'
import type { Logger } from '../../../infrastructure/observability/logger'
import {
  INTERNAL_SERVICE_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  signInternalRequest,
} from '../identity/internal-signature'

export interface HttpCatalogRatingClientOptions {
  readonly baseUrl: string
  readonly secret: string
  readonly serviceName: string
  readonly timeoutMs: number
  readonly logger: Logger
  readonly fetchImpl?: typeof fetch
}

const pathFor = (productId: string): string =>
  `/internal/v1/catalog/products/${encodeURIComponent(productId)}/rating`

/**
 * Cliente del contrato interno de calificacion de Catalog (HU-40, CA-03).
 *
 * NUNCA LANZA, a diferencia de `CatalogInventoryClient` de Commerce: aquella
 * adquisicion es un paso del que la compra depende; este empuje es una
 * replica de lectura que Catalog usa para mostrar el promedio junto al
 * producto, y su fallo no debe impedir ni deshacer una calificacion que
 * Community ya registro y valido como propia.
 *
 * NO SE REGISTRA LA FIRMA NI EL SECRETO, igual que en los demas clientes del
 * contrato interno.
 */
export class HttpCatalogRatingClient implements ProductRatingPublisherPort {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: HttpCatalogRatingClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async publish(productId: string, aggregate: ProductRatingAggregate): Promise<void> {
    const path = pathFor(productId)
    const body = { averageRating: aggregate.averageRating, reviewCount: aggregate.reviewCount }
    const timestamp = String(Date.now())
    const signature = signInternalRequest(this.options.secret, {
      service: this.options.serviceName,
      method: 'POST',
      path,
      timestamp,
      body,
    })

    try {
      const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [INTERNAL_SERVICE_HEADER]: this.options.serviceName,
          [INTERNAL_TIMESTAMP_HEADER]: timestamp,
          [INTERNAL_SIGNATURE_HEADER]: signature,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })

      if (!response.ok) {
        this.options.logger.warn('catalog_rating_publish_no_ok', { status: response.status })
      }
    } catch (error: unknown) {
      this.options.logger.warn('catalog_rating_publish_fallo', {
        detail: error instanceof Error ? error.message : 'fallo desconocido',
      })
    }
  }
}
