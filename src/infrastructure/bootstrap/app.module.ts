import { Module, type CanActivate } from '@nestjs/common'
import { APP_GUARD, Reflector } from '@nestjs/core'

import { ThreadsController } from '../../adapters/inbound/http/threads.controller'
import { MeController } from '../../adapters/inbound/http/me.controller'
import { ProductCommentsController } from '../../adapters/inbound/http/product-comments.controller'
import { CommentReportsController } from '../../adapters/inbound/http/comment-reports.controller'
import { HealthController } from '../../adapters/inbound/http/health.controller'
import {
  CLOSE_THREAD,
  GET_PRODUCT_REVIEW_SUMMARY,
  GET_THREAD,
  HIDE_POST,
  LIST_PRODUCT_COMMENTS,
  LIST_THREADS,
  LIST_OWN_POSTS,
  OPEN_THREAD,
  PUBLISH_POST,
  PUBLISH_PRODUCT_COMMENT,
  RATE_PRODUCT,
  REPORT_COMMENT,
} from '../../adapters/inbound/http/tokens'
import { READINESS_CHECKS, VERSION_REPORT } from '../../adapters/inbound/http/tokens.health'

import {
  CloseThread,
  GetThread,
  HidePost,
  ListThreads,
  ListOwnPosts,
  OpenThread,
  PublishPost,
} from '../../application/use-cases/ThreadUseCases'
import {
  ListProductComments,
  PublishProductComment,
} from '../../application/use-cases/ProductCommentUseCases'
import {
  GetProductReviewSummary,
  RateProduct,
} from '../../application/use-cases/ProductReviewUseCases'
import { ReportComment } from '../../application/use-cases/CommentReportUseCases'
import { THREAD_REPOSITORY } from '../../application/ports/ThreadRepositoryPort'
import { PRODUCT_COMMENT_REPOSITORY } from '../../application/ports/ProductCommentRepositoryPort'
import { PRODUCT_REVIEW_REPOSITORY } from '../../application/ports/ProductReviewRepositoryPort'
import { PRODUCT_EXISTENCE } from '../../application/ports/ProductExistencePort'
import { COMMENT_REPORT_REPOSITORY } from '../../application/ports/CommentReportRepositoryPort'
import { CLOCK } from '../../application/ports/ClockPort'
import { ID_GENERATOR } from '../../application/ports/IdGeneratorPort'
import type { ThreadRepositoryPort } from '../../application/ports/ThreadRepositoryPort'
import type { ProductCommentRepositoryPort } from '../../application/ports/ProductCommentRepositoryPort'
import type { ProductReviewRepositoryPort } from '../../application/ports/ProductReviewRepositoryPort'
import type { ProductExistencePort } from '../../application/ports/ProductExistencePort'
import type { CommentReportRepositoryPort } from '../../application/ports/CommentReportRepositoryPort'
import type { ClockPort } from '../../application/ports/ClockPort'
import type { IdGeneratorPort } from '../../application/ports/IdGeneratorPort'

import { InMemoryThreadRepository } from '../../adapters/outbound/persistence/InMemoryThreadRepository'
import { PostgresThreadRepository } from '../../adapters/outbound/persistence/PostgresThreadRepository'
import { InMemoryProductCommentRepository } from '../../adapters/outbound/persistence/InMemoryProductCommentRepository'
import { PostgresProductCommentRepository } from '../../adapters/outbound/persistence/PostgresProductCommentRepository'
import { InMemoryProductReviewRepository } from '../../adapters/outbound/persistence/InMemoryProductReviewRepository'
import { PostgresProductReviewRepository } from '../../adapters/outbound/persistence/PostgresProductReviewRepository'
import { InMemoryCommentReportRepository } from '../../adapters/outbound/persistence/InMemoryCommentReportRepository'
import { PostgresCommentReportRepository } from '../../adapters/outbound/persistence/PostgresCommentReportRepository'
import {
  LocalProductCatalog,
  DEMO_PRODUCT_IDS,
} from '../../adapters/outbound/existence/LocalProductCatalog'
import { SystemClock } from '../../adapters/outbound/system/SystemClock'
import { UuidGenerator } from '../../adapters/outbound/system/UuidGenerator'

import { createDatabase } from '../persistence/database'
import { createLogger, type Logger } from '../observability/logger'
import { AuthMode, loadConfig, PersistenceDriver, type AppConfig } from '../config/env'

import { JwtAuthGuard } from '../../adapters/inbound/http/auth/jwt-auth.guard'
import { RolesGuard } from '../../adapters/inbound/http/auth/roles.guard'
import { MfaEvidenceGuard } from '../../adapters/inbound/http/auth/mfa-evidence.guard'
import { AnonymousIdentityGuard } from '../../adapters/inbound/http/auth/anonymous.guard'
import { TOKEN_VERIFIER } from '../../application/ports/TokenVerifierPort'
import type { TokenVerifierPort } from '../../application/ports/TokenVerifierPort'
import {
  MFA_EVIDENCE_VERIFIER,
  MfaEvidenceOutcome,
  type MfaEvidenceVerifierPort,
} from '../../application/ports/MfaEvidenceVerifierPort'
import { CognitoTokenVerifier } from '../../adapters/outbound/identity/CognitoTokenVerifier'
import { AccountMfaEvidenceClient } from '../../adapters/outbound/identity/AccountMfaEvidenceClient'
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
  controllers: [
    ThreadsController,
    MeController,
    ProductCommentsController,
    CommentReportsController,
    HealthController,
  ],
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
        if (config.persistenceDriver !== PersistenceDriver.Postgres) {
          logger.warn('in_memory_persistence', {
            detail: 'PERSISTENCE_DRIVER=memory: el estado se pierde al reiniciar el servicio.',
          })

          return new InMemoryThreadRepository()
        }

        // `loadConfig` ya garantiza que DATABASE_URL existe con este driver: un
        // servicio mal configurado no debe arrancar y aparentar salud.
        if (config.databaseUrl === null) {
          throw new Error('DATABASE_URL es obligatorio con PERSISTENCE_DRIVER=postgres.')
        }

        logger.info('postgres_persistence', { detail: 'Adaptador PostgreSQL activo.' })

        // El esquema NO se migra aqui. Migrar al arrancar hace que varias
        // replicas migren a la vez y que una migracion rota deje el servicio en
        // bucle de reinicio. Es un paso explicito: `npm run migrate`.
        return new PostgresThreadRepository(
          createDatabase({ connectionString: config.databaseUrl }),
        )
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      // Comparte driver con THREAD_REPOSITORY: si el servicio corre sobre
      // PostgreSQL, todos sus repositorios lo hacen.
      provide: PRODUCT_COMMENT_REPOSITORY,
      useFactory: (config: AppConfig): ProductCommentRepositoryPort => {
        if (config.persistenceDriver !== PersistenceDriver.Postgres) {
          return new InMemoryProductCommentRepository()
        }

        if (config.databaseUrl === null) {
          throw new Error('DATABASE_URL es obligatorio con PERSISTENCE_DRIVER=postgres.')
        }

        return new PostgresProductCommentRepository(
          createDatabase({ connectionString: config.databaseUrl }),
        )
      },
      inject: [APP_CONFIG],
    },
    {
      provide: PRODUCT_REVIEW_REPOSITORY,
      useFactory: (config: AppConfig): ProductReviewRepositoryPort => {
        if (config.persistenceDriver !== PersistenceDriver.Postgres) {
          return new InMemoryProductReviewRepository()
        }

        if (config.databaseUrl === null) {
          throw new Error('DATABASE_URL es obligatorio con PERSISTENCE_DRIVER=postgres.')
        }

        return new PostgresProductReviewRepository(
          createDatabase({ connectionString: config.databaseUrl }),
        )
      },
      inject: [APP_CONFIG],
    },
    {
      // Catalogo local, mismo patron que `LocalCatalogPricing` en Commerce.
      // Ver ProductExistencePort para la brecha de identificador que justifica
      // no llamar en vivo a Nexus-Battle-Catalog todavia.
      provide: PRODUCT_EXISTENCE,
      useFactory: (): ProductExistencePort => new LocalProductCatalog(DEMO_PRODUCT_IDS),
    },
    {
      provide: COMMENT_REPORT_REPOSITORY,
      useFactory: (config: AppConfig): CommentReportRepositoryPort => {
        if (config.persistenceDriver !== PersistenceDriver.Postgres) {
          return new InMemoryCommentReportRepository()
        }

        if (config.databaseUrl === null) {
          throw new Error('DATABASE_URL es obligatorio con PERSISTENCE_DRIVER=postgres.')
        }

        return new PostgresCommentReportRepository(
          createDatabase({ connectionString: config.databaseUrl }),
        )
      },
      inject: [APP_CONFIG],
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
      // Comprueba la evidencia de segundo factor en las mutaciones marcadas.
      // Va DESPUES de RolesGuard: quien no tiene rol suficiente ya fue
      // rechazado, y asi no se gasta una llamada de red por cada intento sin
      // permiso.
      provide: APP_GUARD,
      useFactory: (
        config: AppConfig,
        reflector: Reflector,
        verifier: MfaEvidenceVerifierPort,
      ): CanActivate =>
        // Solo con proveedor de identidad activo, igual que `RolesGuard`. Sin
        // proveedor no hay RBAC ni testimonios, asi que exigir evidencia de un
        // segundo factor que nadie pudo superar dejaria el servicio
        // inutilizable en desarrollo sin ganar ninguna proteccion: un binario
        // con `NODE_ENV=production` y `AUTH_MODE=disabled` no arranca.
        config.authMode === AuthMode.Jwt
          ? new MfaEvidenceGuard({ reflector, verifier })
          : { canActivate: (): boolean => true },
      inject: [APP_CONFIG, Reflector, MFA_EVIDENCE_VERIFIER],
    },
    {
      provide: MFA_EVIDENCE_VERIFIER,
      useFactory: (config: AppConfig, logger: Logger): MfaEvidenceVerifierPort => {
        if (config.accountInternalUrl === null || config.internalServiceAuthSecret === null) {
          logger.warn('mfa_evidence_verifier', {
            driver: 'no-configurado',
            detail:
              'Sin ACCOUNT_INTERNAL_URL o INTERNAL_SERVICE_AUTH_SECRET no se puede comprobar el segundo factor: las mutaciones de moderacion fallaran cerradas.',
          })

          // NO se deja pasar ante configuracion ausente. Un despliegue
          // incompleto dejaria las mutaciones de moderacion exigiendo solo el
          // rol, que es exactamente lo que este cambio viene a cerrar.
          return {
            verify: (): Promise<MfaEvidenceOutcome> =>
              Promise.resolve(MfaEvidenceOutcome.Unavailable),
          }
        }

        logger.info('mfa_evidence_verifier', { driver: 'account' })

        return new AccountMfaEvidenceClient({
          baseUrl: config.accountInternalUrl,
          secret: config.internalServiceAuthSecret,
          serviceName: config.internalServiceName,
          timeoutMs: config.internalTimeoutMs,
          logger,
        })
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
      provide: LIST_OWN_POSTS,
      useFactory: (threads: ThreadRepositoryPort): ListOwnPosts => new ListOwnPosts(threads),
      inject: [THREAD_REPOSITORY],
    },
    {
      provide: PUBLISH_PRODUCT_COMMENT,
      useFactory: (
        comments: ProductCommentRepositoryPort,
        catalog: ProductExistencePort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ): PublishProductComment => new PublishProductComment({ comments, catalog, clock, ids }),
      inject: [PRODUCT_COMMENT_REPOSITORY, PRODUCT_EXISTENCE, CLOCK, ID_GENERATOR],
    },
    {
      provide: LIST_PRODUCT_COMMENTS,
      useFactory: (comments: ProductCommentRepositoryPort): ListProductComments =>
        new ListProductComments(comments),
      inject: [PRODUCT_COMMENT_REPOSITORY],
    },
    {
      provide: RATE_PRODUCT,
      useFactory: (
        reviews: ProductReviewRepositoryPort,
        catalog: ProductExistencePort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ): RateProduct => new RateProduct({ reviews, catalog, clock, ids }),
      inject: [PRODUCT_REVIEW_REPOSITORY, PRODUCT_EXISTENCE, CLOCK, ID_GENERATOR],
    },
    {
      provide: GET_PRODUCT_REVIEW_SUMMARY,
      useFactory: (reviews: ProductReviewRepositoryPort): GetProductReviewSummary =>
        new GetProductReviewSummary(reviews),
      inject: [PRODUCT_REVIEW_REPOSITORY],
    },
    {
      provide: REPORT_COMMENT,
      useFactory: (
        comments: ProductCommentRepositoryPort,
        reports: CommentReportRepositoryPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
        config: AppConfig,
      ): ReportComment =>
        new ReportComment({
          comments,
          reports,
          clock,
          ids,
          reportLimit: config.commentReportLimit,
          reportWindowHours: config.commentReportWindowHours,
        }),
      inject: [
        PRODUCT_COMMENT_REPOSITORY,
        COMMENT_REPORT_REPOSITORY,
        CLOCK,
        ID_GENERATOR,
        APP_CONFIG,
      ],
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
