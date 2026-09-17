/**
 * Puerto de existencia de producto.
 *
 * Con `CATALOG_BASE_URL` configurada, `HttpProductCatalog` consulta el
 * contrato publico de Catalog (`GET /api/v1/catalog/products/:reference`, el
 * mismo que ya usa `HttpCatalogReadClient` en Player-Inventory), que acepta
 * tanto `productId` como `sku`. Sin esa variable -desarrollo local sin
 * Catalog levantado, o entornos de demo- se usa `LocalProductCatalog`: un
 * catalogo completo sobre datos en memoria (mismo patron que
 * `LocalCatalogPricing` en Commerce), no una simulacion del servicio real.
 */
export interface ProductExistencePort {
  exists(productId: string): Promise<boolean>
}

export const PRODUCT_EXISTENCE = Symbol('ProductExistencePort')

/**
 * Catalog no respondio o respondio con una forma inesperada: no es que el
 * producto no exista, es que no se pudo saber. Se traduce a 503, no a 404.
 */
export class CatalogUnavailableError extends Error {
  constructor(detail: string) {
    super(`Catalog no esta disponible: ${detail}`)
    this.name = 'CatalogUnavailableError'
  }
}
