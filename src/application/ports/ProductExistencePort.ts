/**
 * Puerto de existencia de producto.
 *
 * Community NO llama en vivo a `Nexus-Battle-Catalog`. HU-40 documenta por
 * que: el contrato publico de Catalog expone `sku`, mientras que este puerto
 * ya trabaja con `productId` -- la brecha de identificador queda fuera de
 * alcance de esta HU y debe resolverse cuando el Carril B de EN-027 avance.
 *
 * Hasta entonces, la implementacion es un catalogo local (mismo patron que
 * `LocalCatalogPricing` en Commerce): un adaptador completo sobre datos en
 * memoria, no una simulacion del servicio real.
 */
export interface ProductExistencePort {
  exists(productId: string): Promise<boolean>
}

export const PRODUCT_EXISTENCE = Symbol('ProductExistencePort')
