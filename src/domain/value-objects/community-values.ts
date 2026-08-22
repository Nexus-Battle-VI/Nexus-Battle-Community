import { DomainError } from '../errors/DomainError'

/**
 * Identidad de quien escribe.
 *
 * Es una referencia al contexto Account: este servicio no conoce el correo ni
 * el nombre visible de la persona autora. Solo su identificador. Esa frontera
 * evita duplicar el modelo de cuentas dentro de la comunidad, y limita el dato
 * personal que este contexto llega a almacenar.
 */
export class AuthorId {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): AuthorId {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('El identificador de la persona autora no puede estar vacio.')
    }

    return new AuthorId(normalized)
  }

  equals(other: AuthorId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

export class ThreadId {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): ThreadId {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('El identificador del hilo no puede estar vacio.')
    }

    return new ThreadId(normalized)
  }

  equals(other: ThreadId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

export class PostId {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): PostId {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('El identificador del mensaje no puede estar vacio.')
    }

    return new PostId(normalized)
  }

  equals(other: PostId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

export class ThreadTitle {
  static readonly MIN_LENGTH = 5
  static readonly MAX_LENGTH = 120

  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): ThreadTitle {
    const normalized = raw.trim().replace(/\s+/gu, ' ')

    if (normalized.length < ThreadTitle.MIN_LENGTH || normalized.length > ThreadTitle.MAX_LENGTH) {
      throw new DomainError(
        `El titulo del hilo debe tener entre ${String(ThreadTitle.MIN_LENGTH)} y ${String(ThreadTitle.MAX_LENGTH)} caracteres.`,
      )
    }

    return new ThreadTitle(normalized)
  }

  equals(other: ThreadTitle): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

/**
 * Contenido de un mensaje.
 *
 * La longitud esta acotada en el objeto de valor y no solo en el controlador:
 * es el limite mas simple y efectivo contra el abuso por volumen, y debe
 * aplicarse llegue la peticion por donde llegue.
 */
export class PostContent {
  static readonly MIN_LENGTH = 1
  static readonly MAX_LENGTH = 2_000

  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): PostContent {
    // Se normalizan los saltos de linea y se recorta, pero no se colapsan los
    // espacios internos: el formato del texto pertenece a quien escribe.
    const normalized = raw.replace(/\r\n/gu, '\n').trim()

    if (normalized.length < PostContent.MIN_LENGTH) {
      throw new DomainError('El mensaje no puede estar vacio.')
    }

    if (normalized.length > PostContent.MAX_LENGTH) {
      throw new DomainError(
        `El mensaje no puede superar ${String(PostContent.MAX_LENGTH)} caracteres.`,
      )
    }

    return new PostContent(normalized)
  }

  get length(): number {
    return this.value.length
  }

  equals(other: PostContent): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
