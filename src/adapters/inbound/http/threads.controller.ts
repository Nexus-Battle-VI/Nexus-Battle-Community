import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import { ThreadNotFoundError } from '../../../application/errors/ApplicationError'
import type {
  CloseThread,
  GetThread,
  HidePost,
  ListThreads,
  OpenThread,
  PublishPost,
} from '../../../application/use-cases/ThreadUseCases'
import {
  CLOSE_THREAD,
  GET_THREAD,
  HIDE_POST,
  LIST_THREADS,
  OPEN_THREAD,
  PUBLISH_POST,
} from './tokens'
import {
  ModerateRequest,
  OpenThreadRequest,
  PublishPostRequest,
  ThreadResponse,
  ThreadSummaryResponse,
} from './threads.dto'

/**
 * Adaptador de entrada HTTP.
 *
 * Traduce entre el protocolo y los casos de uso. No contiene reglas de negocio:
 * el rechazo de mensajes en un hilo cerrado, el limite de mensajes y la
 * ocultacion por moderacion viven en el dominio.
 */
@ApiTags('threads')
@Controller('threads')
export class ThreadsController {
  constructor(
    @Inject(OPEN_THREAD) private readonly openThread: OpenThread,
    @Inject(PUBLISH_POST) private readonly publishPost: PublishPost,
    @Inject(HIDE_POST) private readonly hidePost: HidePost,
    @Inject(CLOSE_THREAD) private readonly closeThread: CloseThread,
    @Inject(GET_THREAD) private readonly getThread: GetThread,
    @Inject(LIST_THREADS) private readonly listThreads: ListThreads,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Abre un hilo nuevo' })
  @ApiResponse({ status: 201, description: 'Hilo abierto', type: ThreadResponse })
  @ApiResponse({ status: 400, description: 'Datos invalidos' })
  async open(@Body() body: OpenThreadRequest): Promise<ThreadResponse> {
    try {
      return await this.openThread.execute(body)
    } catch (error: unknown) {
      throw ThreadsController.translate(error)
    }
  }

  @Get()
  @ApiOperation({ summary: 'Lista los hilos' })
  @ApiResponse({ status: 200, type: ThreadSummaryResponse, isArray: true })
  async list(): Promise<readonly ThreadSummaryResponse[]> {
    return await this.listThreads.execute()
  }

  @Get(':threadId')
  @ApiOperation({ summary: 'Recupera un hilo con sus mensajes visibles' })
  @ApiResponse({ status: 200, description: 'Hilo encontrado', type: ThreadResponse })
  @ApiResponse({ status: 404, description: 'El hilo no existe' })
  async findOne(@Param('threadId') threadId: string): Promise<ThreadResponse> {
    try {
      return await this.getThread.execute(threadId)
    } catch (error: unknown) {
      throw ThreadsController.translate(error)
    }
  }

  @Post(':threadId/posts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Publica un mensaje en el hilo' })
  @ApiResponse({ status: 201, description: 'Mensaje publicado', type: ThreadResponse })
  @ApiResponse({ status: 400, description: 'Hilo cerrado, limite alcanzado o datos invalidos' })
  @ApiResponse({ status: 404, description: 'El hilo no existe' })
  async post(
    @Param('threadId') threadId: string,
    @Body() body: PublishPostRequest,
  ): Promise<ThreadResponse> {
    try {
      return await this.publishPost.execute({
        threadId,
        authorId: body.authorId,
        content: body.content,
      })
    } catch (error: unknown) {
      throw ThreadsController.translate(error)
    }
  }

  @Post(':threadId/posts/:postId/hiding')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Oculta un mensaje por moderacion' })
  @ApiResponse({ status: 200, description: 'Mensaje ocultado', type: ThreadResponse })
  @ApiResponse({ status: 400, description: 'El mensaje no existe en el hilo o ya estaba oculto' })
  @ApiResponse({ status: 404, description: 'El hilo no existe' })
  async hide(
    @Param('threadId') threadId: string,
    @Param('postId') postId: string,
    @Body() body: ModerateRequest,
  ): Promise<ThreadResponse> {
    try {
      return await this.hidePost.execute({ threadId, postId, moderatorId: body.moderatorId })
    } catch (error: unknown) {
      throw ThreadsController.translate(error)
    }
  }

  @Post(':threadId/closure')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cierra el hilo' })
  @ApiResponse({ status: 200, description: 'Hilo cerrado', type: ThreadResponse })
  @ApiResponse({ status: 400, description: 'El hilo ya estaba cerrado' })
  @ApiResponse({ status: 404, description: 'El hilo no existe' })
  async close(
    @Param('threadId') threadId: string,
    @Body() body: ModerateRequest,
  ): Promise<ThreadResponse> {
    try {
      return await this.closeThread.execute(threadId, body.moderatorId)
    } catch (error: unknown) {
      throw ThreadsController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    if (error instanceof ThreadNotFoundError) {
      return new NotFoundException(error.message)
    }

    if (error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}
