import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { AppModule } from './infrastructure/bootstrap/app.module'
import { loadConfig } from './infrastructure/config/env'
import { createLogger } from './infrastructure/observability/logger'

const bootstrap = async (): Promise<void> => {
  const config = loadConfig(process.env)
  const logger = createLogger({
    level: config.logLevel,
    service: config.serviceName,
    version: config.version,
  })

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false })

  // Community esta SIEMPRE detras de un unico proxy inverso real (Caddy,
  // `reverse_proxy` simple sin manipular cabeceras: ver el Caddyfile de
  // Nexus-Battle-Infrastructure). `trust proxy: 1` es lo que hace que
  // `request.ip`/`@Ip()` (HU-41.8) resuelvan la IP real del cliente desde
  // `X-Forwarded-For` confiando en ESE UNICO salto -nunca en cualquier valor
  // que un cliente pudiera intentar inyectar mas alla de el-. Sin esto,
  // `request.ip` seria siempre la IP de Caddy, no la del jugador.
  app.set('trust proxy', 1)

  app.setGlobalPrefix(config.globalPrefix)

  app.useGlobalPipes(
    new ValidationPipe({
      // Se descartan las propiedades no declaradas y se rechaza la peticion si
      // llegan campos desconocidos: evita que un cliente inyecte datos que el
      // contrato no contempla.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  app.enableShutdownHooks()

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Nexus Battles VI — Community')
        .setDescription('API del bounded context Community.')
        .setVersion(config.version)
        .build(),
    )

    SwaggerModule.setup(`${config.globalPrefix}/docs`, app, document)
  }

  await app.listen(config.port)

  logger.info('service_started', {
    port: config.port,
    globalPrefix: config.globalPrefix,
    persistenceDriver: config.persistenceDriver,
    swagger: config.swaggerEnabled,
  })
}

void bootstrap()
