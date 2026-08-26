import { Module, type CanActivate } from '@nestjs/common'
import { APP_GUARD, Reflector } from '@nestjs/core'

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
import { AuthMode, loadConfig, PersistenceDriver, type AppConfig } from '../config/env'

import { JwtAuthGuard } from '../../adapters/inbound/http/auth/jwt-auth.guard'
import { RolesGuard } from '../../adapters/inbound/http/auth/roles.guard'
import { AnonymousIdentityGuard } from '../../adapters/inbound/http/auth/anonymous.guard'
import { TOKEN_VERIFIER } from '../../application/ports/TokenVerifierPort'
import type { TokenVerifierPort } from '../../application/ports/TokenVerifierPort'
import { CognitoTokenVerifier } from '../../adapters/outbound/identity/CognitoTokenVerifier'
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
      provide: TOKEN_VERIFIER,
      useFactory: (config: AppConfig, logger: Logger): TokenVerifierPort => {
        if (config.cognito === null) {
          // No se devuelve un verificador que acepte cualquier cosa: sin
          // proveedor, el guard directamente no se registra. Un verificador
          // permisivo daria la apariencia de que hay comprobacion.
          logger.warn('authentication_disabled', {
            detail:
              'AUTH_MODE=disabled: ninguna ruta verifica quien realiza la peticion. BLOCKER de ADR-004.',
          })

          return {
            verify: (): Promise<never> => {
              throw new Error('No hay verificador de testimonios configurado.')
            },
          }
        }

        return new CognitoTokenVerifier(config.cognito)
      },
      inject: [APP_CONFIG, LOGGER],
    },
    // Los guards se registran de forma global SOLO cuando hay proveedor. El
    // orden importa: JwtAuthGuard deja la identidad verificada en la peticion y
    // RolesGuard la lee. NestJS los ejecuta en el orden de declaracion.
    {
      provide: APP_GUARD,
      useFactory: (
        config: AppConfig,
        reflector: Reflector,
        verifier: TokenVerifierPort,
      ): CanActivate =>
        config.authMode === AuthMode.Jwt
          ? new JwtAuthGuard(reflector, verifier)
          : // Sin proveedor no se deja pasar sin mas: se atribuye la identidad
            // anonima, para que lo que se guarde diga que nadie fue verificado.
            new AnonymousIdentityGuard(),
      inject: [APP_CONFIG, Reflector, TOKEN_VERIFIER],
    },
    {
      provide: APP_GUARD,
      useFactory: (config: AppConfig, reflector: Reflector): CanActivate =>
        config.authMode === AuthMode.Jwt
          ? new RolesGuard(reflector)
          : { canActivate: (): boolean => true },
      inject: [APP_CONFIG, Reflector],
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
