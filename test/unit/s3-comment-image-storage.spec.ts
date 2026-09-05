import { Readable } from 'node:stream'
import type { S3Client } from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { S3CommentImageStorageAdapter } from '../../src/adapters/outbound/storage/S3CommentImageStorageAdapter'
import { CommentImageStorageUnavailableError } from '../../src/application/errors/ApplicationError'

jest.mock('@aws-sdk/s3-presigned-post')
jest.mock('@aws-sdk/s3-request-presigner')

const mockedCreatePresignedPost = createPresignedPost as jest.MockedFunction<
  typeof createPresignedPost
>
const mockedGetSignedUrl = getSignedUrl as jest.MockedFunction<typeof getSignedUrl>

describe('S3CommentImageStorageAdapter (EN-028)', () => {
  let mockClient: { send: jest.Mock }
  let adapter: S3CommentImageStorageAdapter

  beforeEach(() => {
    jest.clearAllMocks()
    mockClient = { send: jest.fn() }
    adapter = new S3CommentImageStorageAdapter({
      bucketName: 'nexus-battles-vi-product-assets-test',
      region: 'us-east-1',
      client: mockClient as unknown as S3Client,
    })
  })

  it('crea la intencion de carga bajo staging/comments/, no staging/ a secas', async () => {
    mockedCreatePresignedPost.mockResolvedValue({
      url: 'https://bucket.s3.amazonaws.com',
      fields: { key: 'staging/comments/asset-1' },
    })

    const result = await adapter.createUploadIntent({
      assetId: 'asset-1',
      contentType: 'image/png',
      contentLength: 1000,
      checksumSha256: 'hash',
      expiresInSeconds: 600,
    })

    expect(result.stagingKey).toBe('staging/comments/asset-1')
    expect(mockedCreatePresignedPost).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        Bucket: 'nexus-battles-vi-product-assets-test',
        Key: 'staging/comments/asset-1',
      }),
    )
  })

  it('envuelve un fallo al generar la intencion en CommentImageStorageUnavailableError', async () => {
    mockedCreatePresignedPost.mockRejectedValue(new Error('credenciales invalidas'))

    await expect(
      adapter.createUploadIntent({
        assetId: 'asset-1',
        contentType: 'image/png',
        contentLength: 1000,
        checksumSha256: 'hash',
        expiresInSeconds: 600,
      }),
    ).rejects.toThrow(CommentImageStorageUnavailableError)
  })

  it('obtiene el contenido binario de un objeto', async () => {
    const chunks = [Buffer.from('hola-'), Buffer.from('mundo')]
    mockClient.send.mockResolvedValue({ Body: Readable.from(chunks) })

    const buffer = await adapter.getObject('assets/comments/asset-1/hash.png')

    expect(buffer.toString()).toBe('hola-mundo')
  })

  it('rechaza con CommentImageStorageUnavailableError si el cuerpo de la respuesta esta vacio', async () => {
    mockClient.send.mockResolvedValue({ Body: undefined })

    await expect(adapter.getObject('assets/comments/asset-1/hash.png')).rejects.toThrow(
      CommentImageStorageUnavailableError,
    )
  })

  it('promociona un objeto de staging a assets llamando Copy y Delete', async () => {
    mockClient.send.mockResolvedValue({})

    await adapter.promoteObject('staging/comments/asset-1', 'assets/comments/asset-1/hash.png')

    expect(mockClient.send).toHaveBeenCalledTimes(2)
  })

  it('envuelve un fallo de promocion en CommentImageStorageUnavailableError', async () => {
    mockClient.send.mockRejectedValue(new Error('S3 no disponible'))

    await expect(
      adapter.promoteObject('staging/comments/asset-1', 'assets/comments/asset-1/hash.png'),
    ).rejects.toThrow(CommentImageStorageUnavailableError)
  })

  it('elimina un objeto llamando DeleteObjectCommand', async () => {
    mockClient.send.mockResolvedValue({})

    await adapter.deleteObject('staging/comments/asset-1')

    expect(mockClient.send).toHaveBeenCalledTimes(1)
  })

  it('envuelve un fallo de borrado en CommentImageStorageUnavailableError', async () => {
    mockClient.send.mockRejectedValue(new Error('timeout'))

    await expect(adapter.deleteObject('staging/comments/asset-1')).rejects.toThrow(
      CommentImageStorageUnavailableError,
    )
  })

  it('genera una URL firmada de descarga', async () => {
    mockedGetSignedUrl.mockResolvedValue('https://bucket.s3.amazonaws.com/signed?sig=abc')

    const url = await adapter.getPresignedDownloadUrl('assets/comments/asset-1/hash.png', 300)

    expect(url).toBe('https://bucket.s3.amazonaws.com/signed?sig=abc')
    expect(mockedGetSignedUrl).toHaveBeenCalledWith(mockClient, expect.anything(), {
      expiresIn: 300,
    })
  })

  it('envuelve un fallo al firmar la descarga en CommentImageStorageUnavailableError', async () => {
    mockedGetSignedUrl.mockRejectedValue(new Error('no se pudo firmar'))

    await expect(
      adapter.getPresignedDownloadUrl('assets/comments/asset-1/hash.png', 300),
    ).rejects.toThrow(CommentImageStorageUnavailableError)
  })
})
