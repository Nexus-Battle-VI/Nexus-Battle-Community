import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'

import { CommentImageAssetsController } from '../../src/adapters/inbound/http/comment-image-assets.controller'
import {
  CommentImageAssetConflictError,
  CommentImageAssetExpiredError,
  CommentImageAssetNotFoundError,
  CommentImageAssetOwnershipError,
  CommentImageChecksumMismatchError,
  CommentImageInvalidContentError,
  CommentImageLengthMismatchError,
  CommentImageStorageUnavailableError,
} from '../../src/application/errors/ApplicationError'
import { DomainError } from '../../src/domain/errors/DomainError'
import type { VerifiedIdentity } from '../../src/application/ports/TokenVerifierPort'

const IDENTITY: VerifiedIdentity = {
  subject: 'acc-jugador-1',
  email: null,
  roles: new Set(),
}

/**
 * Cobertura del mapeo de errores de `CommentImageAssetsController.translate`
 * a nivel unitario: no vale la pena montar la aplicacion NestJS completa solo
 * para forzar cada rama de error, cuando construir el controlador a mano con
 * dependencias falsas basta para ejercitarlas todas.
 */
describe('CommentImageAssetsController (mapeo de errores)', () => {
  const buildController = (overrides: {
    createUploadIntent?: { execute: jest.Mock }
    finalizeAsset?: { execute: jest.Mock }
    getContentUseCase?: { execute: jest.Mock }
  }): CommentImageAssetsController =>
    new CommentImageAssetsController(
      (overrides.createUploadIntent ?? { execute: jest.fn() }) as never,
      (overrides.finalizeAsset ?? { execute: jest.fn() }) as never,
      (overrides.getContentUseCase ?? { execute: jest.fn() }) as never,
    )

  it('createUpload propaga la respuesta exitosa del caso de uso', async () => {
    const execute = jest.fn().mockResolvedValue({ assetId: 'asset-1', upload: {} })
    const controller = buildController({ createUploadIntent: { execute } })

    const result = await controller.createUpload(
      { contentType: 'image/png', contentLength: 100, checksumSha256: 'hash' },
      IDENTITY,
    )

    expect(result).toEqual({ assetId: 'asset-1', upload: {} })
    expect(execute).toHaveBeenCalledWith({
      authorId: IDENTITY.subject,
      contentType: 'image/png',
      contentLength: 100,
      checksumSha256: 'hash',
    })
  })

  it.each([
    [CommentImageAssetNotFoundError, NotFoundException, ['x']],
    [CommentImageAssetOwnershipError, ForbiddenException, ['x']],
    [CommentImageAssetExpiredError, ConflictException, ['x']],
    [CommentImageAssetConflictError, ConflictException, ['mensaje']],
    [CommentImageChecksumMismatchError, UnprocessableEntityException, []],
    [CommentImageInvalidContentError, UnprocessableEntityException, ['mensaje']],
    [CommentImageLengthMismatchError, UnprocessableEntityException, [1, 2]],
    [CommentImageStorageUnavailableError, ServiceUnavailableException, ['mensaje']],
    [DomainError, UnprocessableEntityException, ['mensaje']],
  ] as const)('createUpload traduce %p a %p', async (ErrorType, ExpectedException, args) => {
    const execute = jest
      .fn()
      .mockRejectedValue(new (ErrorType as new (...a: unknown[]) => Error)(...args))
    const controller = buildController({ createUploadIntent: { execute } })

    await expect(
      controller.createUpload(
        { contentType: 'image/png', contentLength: 100, checksumSha256: 'h' },
        IDENTITY,
      ),
    ).rejects.toBeInstanceOf(ExpectedException)
  })

  it('createUpload traduce un error generico con "UUID" a BadRequestException', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('formato UUID invalido'))
    const controller = buildController({ createUploadIntent: { execute } })

    await expect(
      controller.createUpload(
        { contentType: 'image/png', contentLength: 100, checksumSha256: 'h' },
        IDENTITY,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('createUpload relanza un error desconocido tal cual', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('fallo inesperado'))
    const controller = buildController({ createUploadIntent: { execute } })

    await expect(
      controller.createUpload(
        { contentType: 'image/png', contentLength: 100, checksumSha256: 'h' },
        IDENTITY,
      ),
    ).rejects.toThrow('fallo inesperado')
  })

  it('finalize usa el subject del testimonio, no un valor del cuerpo', async () => {
    const execute = jest.fn().mockResolvedValue({ assetId: 'asset-1', status: 'READY' })
    const controller = buildController({ finalizeAsset: { execute } })

    await controller.finalize('asset-1', IDENTITY)

    expect(execute).toHaveBeenCalledWith('asset-1', IDENTITY.subject)
  })

  it('getContent responde 307 con la URL firmada', async () => {
    const execute = jest.fn().mockResolvedValue('https://signed.example/download')
    const controller = buildController({ getContentUseCase: { execute } })
    const res = { setHeader: jest.fn(), redirect: jest.fn() }

    await controller.getContent('asset-1', res as never)

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=240')
    expect(res.redirect).toHaveBeenCalledWith(307, 'https://signed.example/download')
  })

  it('getContent traduce not-found a 404 y storage-unavailable a 503', async () => {
    const notFound = jest.fn().mockRejectedValue(new CommentImageAssetNotFoundError('x'))
    const unavailable = jest.fn().mockRejectedValue(new CommentImageStorageUnavailableError('x'))
    const res = { setHeader: jest.fn(), redirect: jest.fn() }

    await expect(
      buildController({ getContentUseCase: { execute: notFound } }).getContent('x', res as never),
    ).rejects.toBeInstanceOf(NotFoundException)

    await expect(
      buildController({ getContentUseCase: { execute: unavailable } }).getContent(
        'x',
        res as never,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('getContent relanza cualquier otro error tal cual', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('fallo inesperado'))
    const res = { setHeader: jest.fn(), redirect: jest.fn() }

    await expect(
      buildController({ getContentUseCase: { execute } }).getContent('x', res as never),
    ).rejects.toThrow('fallo inesperado')
  })
})
