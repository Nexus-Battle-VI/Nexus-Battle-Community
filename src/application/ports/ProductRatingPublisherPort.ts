/** Agregado final de calificaciones, tal como lo calcula Community. */
export interface ProductRatingAggregate {
  readonly averageRating: number | null
  readonly reviewCount: number
}

/**
 * Empuja el agregado de calificaciones hacia el producto canonico de Catalog
 * (HU-40, CA-03), a traves de su contrato interno
 * `POST /internal/v1/catalog/products/:id/rating`.
 *
 * NUNCA LANZA. Es una replica de lectura para Catalog, no una escritura de la
 * que Community dependa: el promedio y el conteo que ve un jugador siempre
 * salen de `GetProductReviewSummary`, calculados sobre las calificaciones de
 * Community, nunca de vuelta desde Catalog. Si Catalog no responde, la
 * calificacion que el jugador acaba de registrar sigue siendo valida.
 */
export interface ProductRatingPublisherPort {
  publish(productId: string, aggregate: ProductRatingAggregate): Promise<void>
}

export const PRODUCT_RATING_PUBLISHER = Symbol('ProductRatingPublisherPort')
