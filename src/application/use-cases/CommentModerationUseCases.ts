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
  CommentReportRepositoryPort,
  ModerationQueuePage,
} from '../ports/CommentReportRepositoryPort'
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
 * Aplica una accion de moderacion y registra su auditoria (HU-41.2/41.3/41.8).
 *
 * Comun a las cinco acciones: resuelve el comentario (404 si no existe),
 * aplica la transicion en el agregado, y PERSISTE el comentario y el
 * registro de auditoria dentro de la MISMA transaccion (HU-41.8): si
 * cualquiera de las dos escrituras falla, ninguna de las dos queda hecha -ni
 * el comentario actualizado sin su auditoria, ni la auditoria sin que el
 * comentario refleje el nuevo estado-. Si la accion se rechaza antes de
 * entrar a la transaccion (comentario inexistente, motivo invalido,
 * contenido invalido en `edit`), no se escribe nada.
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

    await comments.save(comment)
    await actions.save(record)

    return toProductCommentDto(comment.toSnapshot())
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
 * Eliminacion POR MODERACION. Es un borrado logico -el comentario pasa a
 * `DELETED`, la fila permanece- no fisico: eliminar la fila borraria junto
 * con ella la evidencia que la propia HU-41 exige conservar (estado anterior,
 * quien actuo, por que).
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
 * Consulta de la cola de moderacion (HU-41.1).
 *
 * La fuente es `CommentReportRepositoryPort.listModerationQueue`: sin
 * filtros automaticos de lenguaje ofensivo implementados en ningun servicio
 * del org, el reporte de otro jugador (HU-46, ya integrado) es la unica
 * entrada real por la que un comentario llega a la cola -no se inventa un
 * mecanismo de deteccion que no existe-.
 *
 * Un comentario reportado que ya no existe (por ejemplo, si en el futuro se
 * permitiera un borrado fisico fuera de moderacion) se omite del resultado en
 * lugar de fallar toda la pagina: es una inconsistencia de datos, no un
 * motivo para negarle la cola entera al moderador.
 */
const DEFAULT_QUEUE_LIMIT = 20
const MAX_QUEUE_LIMIT = 100

export class ListModerationQueue {
  constructor(
    private readonly deps: {
      readonly reports: CommentReportRepositoryPort
      readonly comments: ProductCommentRepositoryPort
    },
  ) {}

  async execute(query: Partial<ModerationQueuePage>): Promise<ModerationQueuePageDto> {
    const page: ModerationQueuePage = {
      limit: Math.min(Math.max(query.limit ?? DEFAULT_QUEUE_LIMIT, 1), MAX_QUEUE_LIMIT),
      offset: Math.max(query.offset ?? 0, 0),
    }

    const queue = await this.deps.reports.listModerationQueue(page)

    const items = await Promise.all(
      queue.items.map(async (entry) => {
        const comment = await this.deps.comments.findById(ProductCommentId.create(entry.commentId))

        return comment === null
          ? null
          : {
              comment: toProductCommentDto(comment.toSnapshot()),
              reportCount: entry.reportCount,
              lastReportedAt: entry.lastReportedAt,
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
