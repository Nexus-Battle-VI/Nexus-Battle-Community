import { CommentModerationAction } from '../../domain/entities/CommentModerationAction'
import { AuthorId } from '../../domain/value-objects/community-values'
import { CommentContent, ProductCommentId } from '../../domain/value-objects/product-review-values'
import {
  CommentModerationActionId,
  IpAddress,
  ModerationAction,
  ModerationReason,
} from '../../domain/value-objects/moderation-values'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { ProductCommentRepositoryPort } from '../ports/ProductCommentRepositoryPort'
import type { CommentModerationTransactionPort } from '../ports/CommentModerationTransactionPort'
import type {
  ModerationQueuePage,
  ModerationQueueRepositoryPort,
} from '../ports/ModerationQueueRepositoryPort'
import { CommentNotFoundError } from '../errors/ApplicationError'
import { toProductCommentDto, type ProductCommentDto } from '../dto/ProductCommentDto'
import { toModerationQueuePageDto, type ModerationQueuePageDto } from '../dto/ModerationQueueDto'

export interface ModerateCommentDependencies {
  readonly transaction: CommentModerationTransactionPort
  readonly clock: ClockPort
  readonly ids: IdGeneratorPort
}

export interface ModerateCommentCommand {
  readonly commentId: string
  readonly actorId: string
  readonly reason: string
  /** HU-41.8: resuelta EXCLUSIVAMENTE por el servidor, nunca por el body. */
  readonly ipAddress: string
}

export interface EditCommentCommand extends ModerateCommentCommand {
  readonly content: string
}

/**
 * Aplica una accion de moderacion y registra su auditoria
 * (HU-41.2/41.3/41.8/41.9).
 *
 * Comun a las cinco acciones: resuelve el comentario (404 si no existe),
 * aplica la transicion en el agregado, y PERSISTE el efecto sobre el
 * comentario y el registro de auditoria dentro de la MISMA transaccion
 * (HU-41.8): si cualquiera de las dos escrituras falla, ninguna de las dos
 * queda hecha. Si la accion se rechaza antes de entrar a la transaccion
 * (comentario inexistente, motivo invalido, contenido invalido en `edit`),
 * no se escribe nada.
 *
 * `DELETE` es la unica accion que no termina en `comments.save()`: HU-41.9
 * (Management#29) exige eliminacion FISICA -"remover permanentemente el
 * comentario del sistema", PDF fuente 7.3.3-, no el borrado logico que
 * tenia antes. El registro de auditoria se construye ANTES de borrar,
 * tomando la instantanea final (`comment.toSnapshot()`, con
 * `moderationStatus: DELETED`) de la instancia en memoria -nunca releida de
 * la fila, que para entonces ya no existe-, de modo que el contrato HTTP no
 * cambia: la respuesta sigue siendo el mismo `ProductCommentDto`, con el
 * mismo estado final que ya devolvia el borrado logico.
 */
const applyModeration = async (
  deps: ModerateCommentDependencies,
  action: ModerationAction,
  command: ModerateCommentCommand,
  newContent?: CommentContent,
): Promise<ProductCommentDto> => {
  const commentId = ProductCommentId.create(command.commentId)
  const reason = ModerationReason.create(command.reason)
  const ipAddress = IpAddress.create(command.ipAddress)
  const occurredAt = deps.clock.now()

  return deps.transaction.run(async ({ comments, actions }) => {
    const comment = await comments.findById(commentId)

    if (comment === null) {
      throw new CommentNotFoundError(commentId.value)
    }

    const { previousStatus, newStatus } = comment.moderate({ action, newContent })
    const finalSnapshot = comment.toSnapshot()

    const record = CommentModerationAction.record({
      id: CommentModerationActionId.create(deps.ids.generate()),
      commentId,
      actorId: AuthorId.create(command.actorId),
      action,
      reason,
      previousStatus,
      newStatus,
      occurredAt,
      ipAddress,
    })

    if (action === ModerationAction.Delete) {
      await comments.deleteById(commentId)
    } else {
      await comments.save(comment)
    }

    await actions.save(record)

    return toProductCommentDto(finalSnapshot)
  })
}

export class ApproveComment {
  constructor(private readonly deps: ModerateCommentDependencies) {}

  execute(command: ModerateCommentCommand): Promise<ProductCommentDto> {
    return applyModeration(this.deps, ModerationAction.Approve, command)
  }
}

export class HideComment {
  constructor(private readonly deps: ModerateCommentDependencies) {}

  execute(command: ModerateCommentCommand): Promise<ProductCommentDto> {
    return applyModeration(this.deps, ModerationAction.Hide, command)
  }
}

/**
 * Eliminacion POR MODERACION (HU-41.9, Management#29): borrado FISICO de
 * `product_comments`, tal y como exige el PDF fuente (7.3.3, "remover
 * permanentemente el comentario del sistema"). La evidencia -a quien se
 * elimino, quien lo hizo, cuando, por que- no vive en la fila del
 * comentario sino en `CommentModerationAction`, que no tiene clave foranea
 * hacia `product_comments` precisamente para poder sobrevivir a este
 * borrado; `CommentReport` tampoco se toca.
 */
export class DeleteComment {
  constructor(private readonly deps: ModerateCommentDependencies) {}

  execute(command: ModerateCommentCommand): Promise<ProductCommentDto> {
    return applyModeration(this.deps, ModerationAction.Delete, command)
  }
}

export class EditComment {
  constructor(private readonly deps: ModerateCommentDependencies) {}

  execute(command: EditCommentCommand): Promise<ProductCommentDto> {
    return applyModeration(
      this.deps,
      ModerationAction.Edit,
      command,
      CommentContent.create(command.content),
    )
  }
}

export class MarkComment {
  constructor(private readonly deps: ModerateCommentDependencies) {}

  execute(command: ModerateCommentCommand): Promise<ProductCommentDto> {
    return applyModeration(this.deps, ModerationAction.Mark, command)
  }
}

/**
 * Consulta de la cola de moderacion (HU-41.1, Management#29).
 *
 * La fuente es `ModerationQueueRepositoryPort`, que combina DOS entradas: el
 * reporte de otro jugador (HU-46) y la deteccion del filtro automatico de
 * contenido (HU-41.7). Un comentario con ambos origenes aparece UNA sola vez
 * -la agregacion por `commentId` vive en el repositorio, no aqui-.
 *
 * Un comentario en cola que ya no existe -desde HU-41.9, el caso real es un
 * comentario reportado o senalado que despues se elimino fisicamente por
 * moderacion- se omite del resultado en lugar de fallar toda la pagina: el
 * reporte o la senal siguen siendo evidencia historica valida, y su
 * comentario ya no estar disponible no es motivo para negarle la cola
 * entera al moderador.
 */
const DEFAULT_QUEUE_LIMIT = 20
const MAX_QUEUE_LIMIT = 100

export class ListModerationQueue {
  constructor(
    private readonly deps: {
      readonly queue: ModerationQueueRepositoryPort
      readonly comments: ProductCommentRepositoryPort
    },
  ) {}

  async execute(query: Partial<ModerationQueuePage>): Promise<ModerationQueuePageDto> {
    const page: ModerationQueuePage = {
      limit: Math.min(Math.max(query.limit ?? DEFAULT_QUEUE_LIMIT, 1), MAX_QUEUE_LIMIT),
      offset: Math.max(query.offset ?? 0, 0),
    }

    const queue = await this.deps.queue.listModerationQueue(page)

    const items = await Promise.all(
      queue.items.map(async (entry) => {
        const comment = await this.deps.comments.findById(ProductCommentId.create(entry.commentId))

        if (comment === null) {
          return null
        }

        const sources = [
          ...(entry.reportCount > 0 ? (['USER_REPORT'] as const) : []),
          ...(entry.automaticFlagCount > 0 ? (['AUTOMATIC_FILTER'] as const) : []),
        ]

        return {
          comment: toProductCommentDto(comment.toSnapshot()),
          reportCount: entry.reportCount,
          lastReportedAt: entry.lastReportedAt,
          automaticFlagCount: entry.automaticFlagCount,
          lastAutomaticFlaggedAt: entry.lastAutomaticFlaggedAt,
          sources,
        }
      }),
    )

    return toModerationQueuePageDto({
      items: items.filter((item): item is NonNullable<typeof item> => item !== null),
      total: queue.total,
      limit: page.limit,
      offset: page.offset,
    })
  }
}
