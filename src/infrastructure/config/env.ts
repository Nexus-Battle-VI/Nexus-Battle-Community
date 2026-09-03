export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

export const AuthMode = {
  /**
   * Sin verificacion de identidad. Es el estado que describe el BLOCKER de
   * ADR-004, no una opcion de conveniencia: ningun servicio comprueba quien
   * realiza la peticion.
   */
  Disabled: 'disabled',
  /** Se exige un testimonio firmado por el proveedor de identidad. */
  Jwt: 'jwt',
} as const

export type AuthMode = (typeof AuthMode)[keyof typeof AuthMode]

export interface CognitoConfig {
  readonly userPoolId: string
  readonly clientId: string
}

export const PersistenceDriver = {
  Memory: 'memory',
  Postgres: 'postgres',
} as const

export type PersistenceDriver = (typeof PersistenceDriver)[keyof typeof PersistenceDriver]

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production'
  readonly serviceName: string
  readonly version: string
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error'
  readonly port: number
  readonly globalPrefix: string
  readonly swaggerEnabled: boolean
  readonly persistenceDriver: PersistenceDriver
  readonly databaseUrl: string | null
  readonly authMode: AuthMode
  readonly cognito: CognitoConfig | null
  /**
   * Contrato interno con Account para comprobar la evidencia de segundo factor.
   *
   * `null` cuando falta configuracion. En ese caso las mutaciones de
   * moderacion NO quedan abiertas: el verificador responde que no puede
   * comprobar, y el guard deniega con 503.
   */
  readonly accountInternalUrl: string | null
  readonly internalServiceAuthSecret: string | null
  readonly internalServiceName: string
  readonly internalTimeoutMs: number
  /**
   * Limite de reportes de comentario por jugador (HU-46.3) y la ventana, en
   * horas, sobre la que se cuenta.
   *
   * RF-46 no fija un valor numerico -- la HU es explicita en que no debe
   * inventarse uno -- asi que es configuracion, con un valor por defecto
   * provisional documentado como tal, no una decision de negocio definitiva.
   */
  readonly commentReportLimit: number
  readonly commentReportWindowHours: number
}

type RawEnv = Readonly<Record<string, string | undefined>>

const readEnum = <T extends string>(
  env: RawEnv,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T => {
  const raw = env[key]

  if (raw === undefined || raw === '') {
    return fallback
  }

  if (!(allowed as readonly string[]).includes(raw)) {
    throw new ConfigurationError(
      `${key} debe ser uno de: ${allowed.join(', ')}. Se recibio "${raw}".`,
    )
  }

  return raw as T
}

const readInteger = (
  env: RawEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const raw = env[key]

  if (raw === undefined || raw === '') {
    return fallback
  }

  const parsed = Number(raw)

  if (!Number.isInteger(parsed)) {
    throw new ConfigurationError(`${key} debe ser un numero entero. Se recibio "${raw}".`)
  }

  if (parsed < min || parsed > max) {
    throw new ConfigurationError(
      `${key} debe estar entre ${String(min)} y ${String(max)}. Se recibio ${String(parsed)}.`,
    )
  }

  return parsed
}

const readString = (env: RawEnv, key: string, fallback: string): string => {
  const raw = env[key]

  return raw === undefined || raw === '' ? fallback : raw
}

const readBoolean = (env: RawEnv, key: string, fallback: boolean): boolean => {
  const raw = env[key]

  if (raw === undefined || raw === '') {
    return fallback
  }

  if (raw !== 'true' && raw !== 'false') {
    throw new ConfigurationError(`${key} debe ser "true" o "false". Se recibio "${raw}".`)
  }

  return raw === 'true'
}

/**
 * Construye la configuracion a partir del entorno. Es una funcion pura sobre
 * `env`: no lee `process.env` directamente, de modo que puede verificarse por
 * completo sin contaminar el proceso de pruebas.
 *
 * Falla de inmediato ante una configuracion invalida. Un servicio mal
 * configurado no debe arrancar y aparentar salud.
 */
export const loadConfig = (env: RawEnv): AppConfig => {
  const nodeEnv = readEnum(
    env,
    'NODE_ENV',
    ['development', 'test', 'production'] as const,
    'development',
  )

  const persistenceDriver = readEnum(
    env,
    'PERSISTENCE_DRIVER',
    [PersistenceDriver.Memory, PersistenceDriver.Postgres],
    PersistenceDriver.Memory,
  )

  const databaseUrl = env.DATABASE_URL ?? null

  if (
    persistenceDriver === PersistenceDriver.Postgres &&
    (databaseUrl === null || databaseUrl === '')
  ) {
    throw new ConfigurationError(
      'DATABASE_URL es obligatorio cuando PERSISTENCE_DRIVER es "postgres".',
    )
  }

  const authMode = readEnum(env, 'AUTH_MODE', [AuthMode.Disabled, AuthMode.Jwt], AuthMode.Disabled)

  // Un binario de produccion sin verificacion de identidad no arranca.
  //
  // Es la traduccion en codigo del BLOCKER de ADR-004: mientras ningun servicio
  // compruebe quien realiza la peticion, cualquiera puede actuar en nombre de
  // otra persona. Un aviso en el registro se pasa por alto; un arranque que
  // falla, no.
  if (nodeEnv === 'production' && authMode === AuthMode.Disabled) {
    throw new ConfigurationError(
      'AUTH_MODE no puede ser "disabled" con NODE_ENV=production. Sin verificacion de ' +
        'identidad el servicio no debe exponerse. Vease ADR-004.',
    )
  }

  const cognitoUserPoolId = readString(env, 'COGNITO_USER_POOL_ID', '')
  const cognitoClientId = readString(env, 'COGNITO_CLIENT_ID', '')

  if (authMode === AuthMode.Jwt && (cognitoUserPoolId === '' || cognitoClientId === '')) {
    throw new ConfigurationError(
      'COGNITO_USER_POOL_ID y COGNITO_CLIENT_ID son obligatorios cuando AUTH_MODE es "jwt".',
    )
  }

  return {
    nodeEnv,
    serviceName: readString(env, 'SERVICE_NAME', 'nexus-battle-community'),
    version: readString(env, 'SERVICE_VERSION', '0.1.0'),
    logLevel: readEnum(env, 'LOG_LEVEL', ['debug', 'info', 'warn', 'error'] as const, 'info'),
    port: readInteger(env, 'PORT', 3004, 1, 65_535),
    globalPrefix: readString(env, 'GLOBAL_PREFIX', 'api'),
    // La documentacion interactiva permanece deshabilitada en produccion salvo
    // decision explicita: expone la superficie completa de la API.
    swaggerEnabled: readBoolean(env, 'SWAGGER_ENABLED', nodeEnv !== 'production'),
    persistenceDriver,
    databaseUrl: databaseUrl === '' ? null : databaseUrl,
    authMode,
    cognito:
      authMode === AuthMode.Jwt
        ? { userPoolId: cognitoUserPoolId, clientId: cognitoClientId }
        : null,
    accountInternalUrl: readString(env, 'ACCOUNT_INTERNAL_URL', '').replace(/\/+$/, '') || null,
    internalServiceAuthSecret: readString(env, 'INTERNAL_SERVICE_AUTH_SECRET', '') || null,
    internalServiceName: readString(env, 'INTERNAL_SERVICE_NAME', 'community'),
    // Corto a proposito: quien espera es una mutacion de moderacion, y un
    // tiempo de espera generoso convertiria una caida de Account en una
    // interfaz congelada en lugar de un rechazo claro.
    internalTimeoutMs: readInteger(env, 'INTERNAL_TIMEOUT_MS', 3_000, 100, 30_000),
    // Valor provisional (nota de Refinement en HU-46.3): 10 reportes por 24
    // horas. RF-46 no define esta cifra; es configuracion, no una decision
    // de negocio cerrada.
    commentReportLimit: readInteger(env, 'COMMENT_REPORT_LIMIT', 10, 1, 1_000),
    commentReportWindowHours: readInteger(env, 'COMMENT_REPORT_WINDOW_HOURS', 24, 1, 8_760),
  }
}
