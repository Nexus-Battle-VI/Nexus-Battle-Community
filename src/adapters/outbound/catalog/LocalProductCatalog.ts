import type { ProductCatalogPort } from '../../../application/ports/ProductCatalogPort'

/**
 * Catalogo de productos local.
 *
 * Es una implementacion completa del puerto sobre una lista en memoria, no
 * una simulacion del servicio Catalog -- mismo patron que `LocalCatalogPricing`
 * en Commerce. El adaptador HTTP real depende de que se resuelva la brecha de
 * identificador (Catalog expone `sku`, este puerto trabaja con `productId`)
 * documentada en HU-40; hasta entonces, comentar y calificar un producto
 * funciona de extremo a extremo sin acoplarse a esa integracion pendiente.
 *
 * Lo que este adaptador NO hace, de forma deliberada, es acceder a la base de
 * datos de Catalog. Esa prohibicion es la que mantiene el limite entre ambos
 * servicios.
 */
export class LocalProductCatalog implements ProductCatalogPort {
  private readonly productIds: ReadonlySet<string>

  constructor(productIds: readonly string[]) {
    this.productIds = new Set(productIds)
  }

  exists(productId: string): Promise<boolean> {
    return Promise.resolve(this.productIds.has(productId.trim()))
  }

  get size(): number {
    return this.productIds.size
  }
}

/**
 * Catalogo del alcance de Sprint 1, hasta que Community consuma `productId`
 * reales de Catalog.
 */
export const DEMO_PRODUCT_IDS: readonly string[] = [
  '3f2a1e4c-6b7d-4a8e-9c1f-2d3e4f5a6b7c',
  '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
  'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
  'e5f6a7b8-c9d0-4e1f-9a2b-3c4d5e6f7a8b',
]
