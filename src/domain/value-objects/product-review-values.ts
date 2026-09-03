import { DomainError } from '../errors/DomainError'

/**
 * Identificador de un producto del contexto Catalog.
 *
 * Es una referencia a OTRO servicio, igual que `AuthorId` lo es a Account: no
 * lleva clave foranea ni valida contra ninguna base de datos ajena. Que el
 * producto exista lo comprueba `ProductExistencePort`, no este objeto de valor.
 *
 * El patron UUID es el MISMO que exige `ProductId` en `Nexus-Battle-Catalog`
 * (`canonical-product-values.ts`): las dos definiciones se duplican a
 * proposito -- un paquete compartido acoplaria los servicios -- pero deben
 * reconocer exactamente el mismo formato, porque describen el mismo
 * identificador visto desde dos bounded contexts distintos.
 */
export class ProductId {
  private static readonly UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): ProductId {
    const normalized = raw.trim().toLowerCase()

    if (!ProductId.UUID_PATTERN.test(normalized)) {
      throw new DomainError(`El productId "${raw}" no es un UUID valido.`)
    }

    return new ProductId(normalized)
  }

  equals(other: ProductId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

export class ProductCommentId {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): ProductCommentId {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('El identificador del comentario no puede estar vacio.')
    }

    return new ProductCommentId(normalized)
  }

  equals(other: ProductCommentId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

export class ProductReviewId {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): ProductReviewId {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('El identificador de la calificacion no puede estar vacio.')
    }

    return new ProductReviewId(normalized)
  }

  equals(other: ProductReviewId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

/**
 * Contenido de un comentario de producto.
 *
 * Deliberadamente separado de `PostContent`: aunque hoy comparten forma
 * (texto entre 1 y 2000 caracteres), pertenecen a sub-dominios distintos
 * dentro del mismo servicio -- conversacion general frente a comentarios de
 * producto -- y HU-40 no comparte ninguna de las reglas de `Thread` (no hay
 * hilo que cerrar, no hay tope de 500 por agregado). Que hoy coincidan en
 * longitud es casualidad, no acoplamiento.
 */
export class CommentContent {
  static readonly MIN_LENGTH = 1
  static readonly MAX_LENGTH = 2_000

  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): CommentContent {
    const normalized = raw.replace(/\r\n/gu, '\n').trim()

    if (normalized.length < CommentContent.MIN_LENGTH) {
      throw new DomainError('El comentario no puede estar vacio.')
    }

    if (normalized.length > CommentContent.MAX_LENGTH) {
      throw new DomainError(
        `El comentario no puede superar ${String(CommentContent.MAX_LENGTH)} caracteres.`,
      )
    }

    return new CommentContent(normalized)
  }

  get length(): number {
    return this.value.length
  }

  equals(other: CommentContent): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

/**
 * Referencia a una imagen adjunta a un comentario.
 *
 * Guarda solo la URL, nunca el binario. Mientras el Enabler EN-028 no decida
 * el almacenamiento real de imagenes de comentario, esta es la unica forma en
 * que una imagen puede acompañar a un comentario: como referencia ya
 * publicada en otro sitio, no como archivo subido a traves de este servicio.
 */
export class ImageReference {
  static readonly MAX_LENGTH = 2_048

  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): ImageReference {
    const normalized = raw.trim()

    if (normalized.length === 0 || normalized.length > ImageReference.MAX_LENGTH) {
      throw new DomainError(
        `La referencia de imagen debe tener entre 1 y ${String(ImageReference.MAX_LENGTH)} caracteres.`,
      )
    }

    let url: URL

    try {
      url = new URL(normalized)
    } catch {
      throw new DomainError(`La referencia de imagen no es una URL valida: "${normalized}".`)
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new DomainError('La referencia de imagen debe usar http o https.')
    }

    return new ImageReference(normalized)
  }

  equals(other: ImageReference): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

/**
 * Lista de imagenes de un comentario.
 *
 * El tope vive aqui, no en el controlador: es la defensa contra el abuso por
 * volumen que HU-40 no acota explicitamente pero que ninguna operacion debe
 * dejar sin limite.
 */
export const MAX_COMMENT_IMAGES = 5

/**
 * Calificacion de un producto, en la escala de 1 a 5 estrellas que exige RF-40.
 */
export class Rating {
  static readonly MIN = 1
  static readonly MAX = 5

  readonly value: number

  private constructor(value: number) {
    this.value = value
  }

  static create(raw: number): Rating {
    if (!Number.isInteger(raw) || raw < Rating.MIN || raw > Rating.MAX) {
      throw new DomainError(
        `La calificacion debe ser un numero entero entre ${String(Rating.MIN)} y ${String(Rating.MAX)}.`,
      )
    }

    return new Rating(raw)
  }

  equals(other: Rating): boolean {
    return this.value === other.value
  }
}
