import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type {
  CommentImageStoragePort,
  CommentImageUploadIntentResult,
} from '../../../application/ports/CommentImageStoragePort'
import { CommentImageStorageUnavailableError } from '../../../application/errors/ApplicationError'

export interface S3CommentImageStorageConfig {
  readonly bucketName: string
  readonly region: string
  readonly client?: S3Client
}

/**
 * Adaptador S3 de imagenes de comentario (HU-40, EN-028).
 *
 * Reutiliza el MISMO bucket que Catalog provisiono en EN-027.9: la decision
 * aprobada en EN-028 (#299) confirmo que el rol del nodo compartido ya
 * autoriza el prefijo `assets/*`/`staging/*` completo, asi que este adaptador
 * no requiere ningun cambio de Terraform -- solo anida sus claves bajo
 * `staging/comments/` y `assets/comments/` para no cruzarse con las de
 * Catalog.
 */
export class S3CommentImageStorageAdapter implements CommentImageStoragePort {
  private readonly client: S3Client
  private readonly bucketName: string

  constructor(config: S3CommentImageStorageConfig) {
    this.bucketName = config.bucketName
    this.client = config.client ?? new S3Client({ region: config.region })
  }

  async createUploadIntent(params: {
    assetId: string
    contentType: string
    contentLength: number
    checksumSha256: string
    expiresInSeconds: number
  }): Promise<CommentImageUploadIntentResult> {
    const stagingKey = `staging/comments/${params.assetId}`
    const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000)

    try {
      const presignedPost = await createPresignedPost(this.client, {
        Bucket: this.bucketName,
        Key: stagingKey,
        Conditions: [
          ['content-length-range', 1, 5 * 1024 * 1024],
          ['eq', '$key', stagingKey],
          ['eq', '$Content-Type', params.contentType],
        ],
        Fields: {
          'Content-Type': params.contentType,
          'x-amz-checksum-sha256': params.checksumSha256,
        },
        Expires: params.expiresInSeconds,
      })

      return {
        uploadUrl: presignedPost.url,
        fields: presignedPost.fields,
        expiresAt,
        stagingKey,
      }
    } catch (error: unknown) {
      throw new CommentImageStorageUnavailableError(
        `Error al generar la intencion de carga en S3: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async getObject(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
      )

      if (!response.Body) {
        throw new Error('Cuerpo de respuesta vacio.')
      }

      const stream = response.Body as NodeJS.ReadableStream
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      return Buffer.concat(chunks)
    } catch (error: unknown) {
      throw new CommentImageStorageUnavailableError(
        `Error al obtener objeto "${key}" de S3: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async promoteObject(stagingKey: string, targetKey: string): Promise<void> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucketName,
          CopySource: `${this.bucketName}/${stagingKey}`,
          Key: targetKey,
        }),
      )

      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: stagingKey }))
    } catch (error: unknown) {
      throw new CommentImageStorageUnavailableError(
        `Error al promocionar objeto de "${stagingKey}" a "${targetKey}" en S3: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }))
    } catch (error: unknown) {
      throw new CommentImageStorageUnavailableError(
        `Error al eliminar objeto "${key}" de S3: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async getPresignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    try {
      const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key })
      return await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds })
    } catch (error: unknown) {
      throw new CommentImageStorageUnavailableError(
        `Error al generar URL de descarga firmada en S3: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
