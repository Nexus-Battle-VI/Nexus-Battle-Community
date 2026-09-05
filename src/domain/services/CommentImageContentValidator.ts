import { createHash } from 'node:crypto'
import {
  CommentImageChecksumMismatchError,
  CommentImageInvalidContentError,
  CommentImageLengthMismatchError,
} from '../../application/errors/ApplicationError'

export interface ValidatedCommentImage {
  readonly format: 'jpeg' | 'png' | 'webp'
  readonly sha256Hex: string
}

const MAX_FILE_SIZE = 5 * 1024 * 1024

const verifyChecksum = (declared: string, calcHex: string, calcBase64: string): void => {
  const cleanDeclared = declared.trim()

  if (cleanDeclared.startsWith('b64:')) {
    if (cleanDeclared.slice(4) !== calcBase64) {
      throw new CommentImageChecksumMismatchError()
    }
    return
  }

  if (cleanDeclared.toLowerCase() === calcHex.toLowerCase() || cleanDeclared === calcBase64) {
    return
  }

  throw new CommentImageChecksumMismatchError()
}

/**
 * Confirma que el archivo decodifica como una imagen real del formato
 * declarado. No extrae ni exige dimensiones: EN-028 aprobo explicitamente que
 * las imagenes de comentario no tengan minimo de tamano ni deteccion de
 * animacion -a diferencia de ADR-016 para Catalog-, asi que la unica defensa
 * que corresponde aqui es que el archivo sea de verdad lo que dice ser.
 */
const assertDecodesAsDeclaredFormat = (buffer: Buffer, format: 'jpeg' | 'png' | 'webp'): void => {
  if (format === 'png') {
    if (buffer.length < 24) {
      throw new CommentImageInvalidContentError('Cabecera PNG incompleta.')
    }
    return
  }

  if (format === 'jpeg') {
    let offset = 2
    while (offset < buffer.length) {
      while (offset < buffer.length && buffer[offset] === 0xff) offset++
      if (offset >= buffer.length) break
      const marker = buffer[offset++]
      if (marker === undefined) break

      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)

      if (isSof) {
        if (offset + 7 > buffer.length) {
          throw new CommentImageInvalidContentError('Cabecera SOF JPEG truncada.')
        }
        return
      }

      if (marker === 0xd9 || marker === 0xda) break
      if (offset + 2 > buffer.length) break
      offset += buffer.readUInt16BE(offset)
    }

    throw new CommentImageInvalidContentError('No se pudo decodificar la imagen JPEG.')
  }

  // WebP: el chunk que sigue a la firma RIFF/WEBP debe ser uno reconocido.
  const chunkType = buffer.subarray(12, 16).toString('ascii')
  if (!['VP8 ', 'VP8L', 'VP8X'].includes(chunkType)) {
    throw new CommentImageInvalidContentError(`Chunk WebP no reconocido: "${chunkType}".`)
  }
  if (buffer.length < 21) {
    throw new CommentImageInvalidContentError('Cabecera WebP truncada.')
  }
}

export const CommentImageContentValidator = {
  validate(params: {
    buffer: Buffer
    declaredContentType: string
    declaredContentLength: number
    declaredChecksumSha256: string
  }): ValidatedCommentImage {
    const { buffer, declaredContentType, declaredContentLength, declaredChecksumSha256 } = params

    if (buffer.length !== declaredContentLength) {
      throw new CommentImageLengthMismatchError(buffer.length, declaredContentLength)
    }

    if (buffer.length > MAX_FILE_SIZE) {
      throw new CommentImageInvalidContentError(
        `El tamano del archivo (${String(buffer.length)} bytes) supera el maximo permitido de 5 MiB.`,
      )
    }

    if (buffer.length < 16) {
      throw new CommentImageInvalidContentError(
        'El archivo es demasiado pequeno para ser una imagen valida.',
      )
    }

    const calculatedHex = createHash('sha256').update(buffer).digest('hex')
    const calculatedBase64 = createHash('sha256').update(buffer).digest('base64')

    verifyChecksum(declaredChecksumSha256, calculatedHex, calculatedBase64)

    const headerPrefix = buffer.subarray(0, 16).toString('utf-8')
    if (
      headerPrefix.includes('<svg') ||
      headerPrefix.includes('<?xml') ||
      buffer.subarray(0, 2).toString('ascii') === 'BM'
    ) {
      throw new CommentImageInvalidContentError(
        'Formatos SVG y BMP no estan permitidos por motivos de seguridad.',
      )
    }

    let format: 'jpeg' | 'png' | 'webp'
    if (declaredContentType === 'image/jpeg') {
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        throw new CommentImageInvalidContentError(
          'Magic bytes no corresponden a una imagen JPEG valida.',
        )
      }
      format = 'jpeg'
    } else if (declaredContentType === 'image/png') {
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      if (!buffer.subarray(0, 8).equals(pngSignature)) {
        throw new CommentImageInvalidContentError(
          'Magic bytes no corresponden a una imagen PNG valida.',
        )
      }
      format = 'png'
    } else if (declaredContentType === 'image/webp') {
      const isRiff = buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      const isWebp = buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      if (!isRiff || !isWebp) {
        throw new CommentImageInvalidContentError(
          'Magic bytes no corresponden a una imagen WebP valida.',
        )
      }
      format = 'webp'
    } else {
      throw new CommentImageInvalidContentError(
        `Tipo de contenido no admitido: "${declaredContentType}". Solo se admiten JPEG, PNG o WebP.`,
      )
    }

    assertDecodesAsDeclaredFormat(buffer, format)

    return { format, sha256Hex: calculatedHex }
  },
}
