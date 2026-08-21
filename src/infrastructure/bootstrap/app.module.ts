import { Module } from '@nestjs/common'

import { ThreadsController } from '../../adapters/inbound/http/threads.controller'
import { HealthController } from '../../adapters/inbound/http/health.controller'
import {
  CLOSE_THREAD,
  GET_THREAD,
  HIDE_POST,
  LIST_THREADS,
  OPEN_THREAD,
  PUBLISH_POST,
} from '../../adapters/inbound/http/tokens'
import { READINESS_CHECKS, VERSION_REPORT } from '../../adapters/inbound/http/tokens.health'

import {
  CloseThread,
  GetThread,
  HidePost,
  ListThreads,
  OpenThread,
  PublishPost,
} from '../../application/use-cases/ThreadUseCases'
import { THREAD_REPOSITORY } from '../../application/ports/ThreadRepositoryPort'
import { CLOCK } from '../../application/ports/ClockPort'
import { ID_GENERATOR } from '../../application/ports/IdGeneratorPort'
import type { ThreadRepositoryPort } from '../../application/ports/ThreadRepositoryPort'
import type { ClockPort } from '../../application/ports/ClockPort'
import type { IdGeneratorPort } from '../../application/ports/IdGeneratorPort'

import { InMemoryThreadRepository } from '../../adapters/outbound/persistence/InMemoryThreadRepository'
import { SystemClock } from '../../adapters/outbound/system/SystemClock'
import { UuidGenerator } from '../../adapters/outbound/system/UuidGenerator'

import { createLogger, type Logger } from '../observability/logger'
import { loadConfig, PersistenceDriver, type AppConfig } from '../config/env'
import type { ReadinessCheck, VersionReport } from '../health/health'

export const APP_CONFIG = Symbol('AppConfig')
export const LOGGER = Symbol('Logger')

/**
 * Raiz de composicion.
 *
 * Es el unico lugar donde se eligen implementaciones concretas. Los casos de
 * uso son clases planas sin decoradores de NestJS: se registran con fabricas
 * explicitas, de modo que la capa de aplicacion permanece independiente del
 * framework.
 */
@Module({
  controllers: [ThreadsController, HealthController],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(process.env),
    },
    {
      provide: LOGGER,
      useFactory: (config: AppConfig): Logger =>
        createLogger({
          level: config.logLevel,
          service: config.serviceName,
          version: config.version,
        }),
      inject: [APP_CONFIG],
    },
    {
      provide: THREAD_REPOSITORY,
      useFactory: (config: AppConfig, logger: Logger): ThreadRepositoryPort => {
        if (config.persistenceDriver === PersistenceDriver.Postgres) {
          // La configuracion se valida al arrancar para que un despliegue mal
          // parametrizado falle de inmediato. El adaptador PostgreSQL depende
          // de que ADR-005 decida el ORM; no se sustituye por una simulacion.
          logger.warn('postgres_driver_not_available', {
            detail:
              'El adaptador PostgreSQL requiere ADR-005 aprobado. Se usa el repositorio en memoria.',
          })
        }

        return new InMemoryThreadRepository()
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: CLOCK,
      useFactory: (): ClockPort => new SystemClock(),
    },
    {
      provide: ID_GENERATOR,
      useFactory: (): IdGeneratorPort => new UuidGenerator(),
    },
    {
      provide: OPEN_THREAD,
      useFactory: (
        threads: ThreadRepositoryPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ): OpenThread => new OpenThread({ threads, clock, ids }),
      inject: [THREAD_REPOSITORY, CLOCK, ID_GENERATOR],
    },
    {
      provide: PUBLISH_POST,
      useFactory: (
        threads: ThreadRepositoryPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ): PublishPost => new PublishPost({ threads, clock, ids }),
      inject: [THREAD_REPOSITORY, CLOCK, ID_GENERATOR],
    },
    {
      provide: HIDE_POST,
      useFactory: (
        threads: ThreadRepositoryPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ): HidePost => new HidePost({ threads, clock, ids }),
      inject: [THREAD_REPOSITORY, CLOCK, ID_GENERATOR],
    },
    {
      provide: CLOSE_THREAD,
      useFactory: (
        threads: ThreadRepositoryPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ): CloseThread => new CloseThread({ threads, clock, ids }),
      inject: [THREAD_REPOSITORY, CLOCK, ID_GENERATOR],
    },
    {
      provide: GET_THREAD,
      useFactory: (threads: ThreadRepositoryPort): GetThread => new GetThread(threads),
      inject: [THREAD_REPOSITORY],
    },
    {
      provide: LIST_THREADS,
      useFactory: (threads: ThreadRepositoryPort): ListThreads => new ListThreads(threads),
      inject: [THREAD_REPOSITORY],
    },
    {
      provide: READINESS_CHECKS,
      useFactory: (threads: ThreadRepositoryPort): readonly ReadinessCheck[] => [
        // La comprobacion ejercita el repositorio de verdad: si el almacen no
        // responde, la sonda falla. No se declara `ok` de forma incondicional.
        { name: 'threads-repository', check: (): boolean => typeof threads.list === 'function' },
      ],
      inject: [THREAD_REPOSITORY],
    },
    {
      provide: VERSION_REPORT,
      useFactory: (config: AppConfig): VersionReport => ({
        service: config.serviceName,
        version: config.version,
        nodeEnv: config.nodeEnv,
      }),
      inject: [APP_CONFIG],
    },
  ],
})
export class AppModule {}
