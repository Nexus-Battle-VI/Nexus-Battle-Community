import type {
  CommentImageStoragePort,
  CommentImageUploadIntentResult,
} from '../../../application/ports/CommentImageStoragePort'

interface StoredEntry {
  buffer: Buffer
  contentType: string
}

export class InMemoryCommentImageStorageAdapter implements CommentImageStoragePort {
  private readonly objects = new Map<string, StoredEntry>()

  createUploadIntent(params: {
    assetId: string
    contentType: string
    contentLength: number
    checksumSha256: string
    expiresInSeconds: number
  }): Promise<CommentImageUploadIntentResult> {
    const stagingKey = `staging/comments/${params.assetId}`
    const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000)

    return Promise.resolve({
      uploadUrl: 'https://test-s3.local/upload',
      fields: {
        key: stagingKey,
        'Content-Type': params.contentType,
        'x-amz-checksum-sha256': params.checksumSha256,
        policy: 'mock-policy-base64',
        'x-amz-algorithm': 'AWS4-HMAC-SHA256',
        'x-amz-credential': 'mock/20260904/us-east-1/s3/aws4_request',
        'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
        'x-amz-signature': 'mock-signature-hex',
      },
      expiresAt,
      stagingKey,
    })
  }

  getObject(key: string): Promise<Buffer> {
    const entry = this.objects.get(key)
    if (!entry) {
      return Promise.reject(new Error(`Objeto no encontrado en almacenamiento: "${key}".`))
    }
    return Promise.resolve(Buffer.from(entry.buffer))
  }

  promoteObject(stagingKey: string, targetKey: string): Promise<void> {
    const entry = this.objects.get(stagingKey)
    if (!entry) {
      return Promise.reject(new Error(`Objeto en staging no encontrado: "${stagingKey}".`))
    }

    this.objects.set(targetKey, {
      buffer: Buffer.from(entry.buffer),
      contentType: entry.contentType,
    })
    this.objects.delete(stagingKey)
    return Promise.resolve()
  }

  deleteObject(key: string): Promise<void> {
    this.objects.delete(key)
    return Promise.resolve()
  }

  getPresignedDownloadUrl(key: string): Promise<string> {
    const entry = this.objects.get(key)
    if (!entry) {
      return Promise.reject(new Error(`Objeto no encontrado para descarga: "${key}".`))
    }
    return Promise.resolve(`https://test-s3.local/download/${key}?sig=presigned-mock`)
  }

  /** Helper de pruebas: simula la carga directa que en produccion hace el navegador contra S3. */
  putObjectDirectly(key: string, buffer: Buffer, contentType = 'image/png'): void {
    this.objects.set(key, { buffer: Buffer.from(buffer), contentType })
  }

  hasObject(key: string): boolean {
    return this.objects.has(key)
  }
}
