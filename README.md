# Nexus-Battle-Community

Servicio de comunidad de Nexus Battles VI. Implementa el bounded context **Community**: hilos de conversación, mensajes y moderación.

Este repositorio contiene código y Pull Requests. No contiene Issues ni Product Backlog: la fuente única de verdad es [Nexus-Battle-Management](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management).

- **Team propietario:** Team Gama
- **Arquitectura interna:** Clean + Hexagonal, con puertos y adaptadores
- **Base de datos objetivo:** PostgreSQL (ver limitaciones más abajo)
- **Documentación técnica del sistema:** [Nexus-Battle-Infrastructure](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure)

## Ocultar no es borrar

Es la decisión central del contexto. Cuando se modera un mensaje:

- **deja de ser visible de inmediato**, que es lo que la comunidad necesita;
- **el contenido se conserva en el almacén**, para que la decisión de moderación pueda revisarse o revertirse.

La separación se materializa en dos sitios distintos: la instantánea del agregado conserva todos los mensajes, y la proyección hacia el exterior (`toThreadDto`) filtra los ocultos. Esa división es lo que permite que ocultar sea reversible sin ser visible.

## Los mensajes no son un agregado propio

Un mensaje no tiene sentido fuera de su hilo, y las reglas que lo gobiernan — no publicar en un hilo cerrado, no superar el límite de mensajes — son invariantes del hilo completo. Por eso `Thread` es la raíz de agregado y los mensajes viven dentro de ella.

## Verificacion de identidad

El servicio comprueba el testimonio que acompana a cada peticion contra el JWKS del user pool de Cognito ([ADR-004](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure/blob/main/docs/adr/ADR-004-identity-directory.md)). Se verifica el **token de acceso**, no el de identidad: el de identidad describe al usuario para la interfaz, el de acceso es el que autoriza y el unico cuyo `client_id` puede comprobarse.

La comprobacion de firma la hace [`aws-jwt-verify`](https://github.com/awslabs/aws-jwt-verify). **No se implementa verificacion criptografica a mano**: es la clase de codigo donde un error sutil no falla, sino que acepta tokens falsificados en silencio.

**La proteccion es el comportamiento por defecto.** El guard se registra de forma global y hay que excluir explicitamente lo que deba ser publico con `@Public()`. Al reves, cualquier endpoint nuevo naceria desprotegido y ese olvido no falla ninguna prueba.

| Ruta                                         | Proteccion                                 |
| -------------------------------------------- | ------------------------------------------ |
| `GET /api/threads` y `GET /api/threads/:id`  | **Publica.** La conversacion es legible    |
| `POST /api/threads`                          | Testimonio valido. El autor sale del `sub` |
| `POST /api/threads/:id/posts`                | Testimonio valido. El autor sale del `sub` |
| `POST /api/threads/:id/posts/:postId/hiding` | Rol **`MODERATOR`** o **`ADMINISTRATOR`**  |
| `POST /api/threads/:id/closure`              | Rol **`MODERATOR`** o **`ADMINISTRATOR`**  |
| `GET /api/health/*`                          | **Publica**                                |

### `authorId` y `moderatorId` salieron del contrato

Estaban en el cuerpo de la peticion, es decir, **los declaraba el cliente**. Cualquiera podia publicar en nombre de otra persona u ocultar mensajes declarandose moderador. Ahora salen del `sub` del testimonio verificado.

Enviarlos ahora produce **400**: el intento de suplantacion se rechaza de forma ruidosa en lugar de aceptarse en silencio.

La autoridad de moderacion **no se hereda** de haber abierto el hilo: ni el autor puede cerrarlo sin el rol.

### Un binario de produccion sin autenticacion no arranca

Con `NODE_ENV=production` y `AUTH_MODE=disabled`, `loadConfig` lanza `ConfigurationError` y el servicio **no llega a escuchar**. Es la traduccion en codigo del blocker de ADR-004: un aviso en el registro se pasa por alto; un arranque que falla, no.

| Variable             | Efecto                                                                   |
| -------------------- | ------------------------------------------------------------------------ |
| `AUTH_MODE=disabled` | Se atribuye la **identidad anonima** a toda peticion. Estado del blocker |
| `AUTH_MODE=jwt`      | Exige `COGNITO_USER_POOL_ID` y `COGNITO_CLIENT_ID`                       |

Con `disabled` no se deja pasar sin mas: se atribuye el sujeto literal `anonymous` con todos los roles. Sin proveedor **no se sabe** quien realiza la peticion, y el dato que se guarde debe decirlo. Un registro firmado por `anonymous` es honesto; uno firmado por un identificador sin verificar, no.

Los roles llegan en el claim `cognito:groups`. **Los grupos que no corresponden a un rol conocido se descartan**: aceptarlos convertiria el pool en una fuente de roles arbitrarios, donde bastaria crear un grupo con cualquier nombre para inventar un permiso.

## Persistencia

PostgreSQL con **Kysely** ([ADR-012](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure/blob/main/docs/adr/ADR-012-orm-odm.md)). Kysely es un constructor de consultas, no un ORM: **cada consulta está escrita a la vista**, y no hay carga perezosa que dispare consultas dentro de un bucle sin que aparezcan en el código.

| Variable                      | Efecto                                                       |
| ----------------------------- | ------------------------------------------------------------ |
| `PERSISTENCE_DRIVER=memory`   | Repositorio en proceso. **El estado se pierde al reiniciar** |
| `PERSISTENCE_DRIVER=postgres` | Adaptador real. Exige `DATABASE_URL`                         |

### El esquema no se migra al arrancar

```bash
npm run migrate
```

Es un paso explícito del despliegue, y el motivo es concreto: migrar desde el arranque hace que **varias réplicas migren a la vez**, y que un despliegue con una migración rota deje el servicio en **bucle de reinicio** en lugar de fallar una sola vez, de forma visible.

### El orden de los mensajes es una columna, no una deducción

Los mensajes llevan `position`. Lo tentador sería ordenar por `created_at`, pero con un reloj fijo —el de las pruebas— dos mensajes comparten instante y el orden pasaría a depender del identificador, que no significa nada.

### Publicar un mensaje no reescribe los otros 499

Un hilo admite hasta 500 mensajes. Borrarlos e insertarlos en cada guardado significaría reescribir 500 filas para publicar una. Se insertan con `on conflict` y una cláusula `where` que compara contra `excluded`: sin ella PostgreSQL escribiría una versión nueva de cada fila igualmente, porque **una actualización que no cambia nada sigue siendo una escritura**.

`list()` lee todos los hilos con sus mensajes en **dos consultas**, no en una por hilo.

### Las restricciones viven en el motor

Estado del hilo, unicidad de la posición dentro del hilo y clave foránea a `threads`. El **autor no lleva clave foránea**: vive en Account, y una clave foránea entre servicios está prohibida en este proyecto.

Una migración no puede importar el dominio, así que el vocabulario se repite en SQL. Hay pruebas que comparan ambos y fallan si divergen.

### Pruebas contra el motor real

```bash
npm run test:db
```

Levantan PostgreSQL 17 en un contenedor con Testcontainers. **Necesitan Docker**, y por eso están fuera de `npm test`: quien trabaja en el dominio o en los casos de uso no debería necesitarlo. El CI ejecuta ambas suites.

Lo que comprueban no se puede comprobar de otra forma: que las restricciones existan de verdad y que el guardado haga lo que dice. Un doble de prueba habría pasado con un esquema equivocado.

## Requisitos

| Herramienta | Versión                                       |
| ----------- | --------------------------------------------- |
| Node.js     | 24 LTS (`.nvmrc` fija el major 24)            |
| npm         | 11 o superior                                 |
| Docker      | opcional, para construir y ejecutar la imagen |

Este repositorio usa **npm** y `package-lock.json`. No se utilizan pnpm ni yarn.

## Puesta en marcha

```bash
nvm use
npm ci
cp .env.example .env
npm run dev
```

Con la configuración por defecto el servicio arranca con el repositorio en memoria: no requiere base de datos ni servicios externos.

Documentación interactiva de la API en `http://localhost:3004/api/docs`.

## API

| Método | Ruta                                          | Descripción                                                    |
| ------ | --------------------------------------------- | -------------------------------------------------------------- |
| `POST` | `/api/threads`                                | Abre un hilo nuevo                                             |
| `GET`  | `/api/threads`                                | Lista los hilos con su recuento de mensajes visibles           |
| `GET`  | `/api/threads/:threadId`                      | Recupera un hilo con sus mensajes visibles                     |
| `POST` | `/api/threads/:threadId/posts`                | Publica un mensaje                                             |
| `POST` | `/api/threads/:threadId/posts/:postId/hiding` | Oculta un mensaje por moderación                               |
| `POST` | `/api/threads/:threadId/closure`              | Cierra el hilo                                                 |
| `GET`  | `/api/health/live`                            | El proceso responde. No consulta dependencias                  |
| `GET`  | `/api/health/ready`                           | Evalúa las dependencias reales. Responde `503` si alguna falla |
| `GET`  | `/api/version`                                | Servicio, versión y entorno                                    |

Un hilo cerrado sigue siendo legible: cerrar impide mensajes nuevos, no oculta la conversación.

## Scripts

Los mismos que el resto de servicios del producto: `dev`, `build`, `start`, `start:prod`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test`, `test:unit`, `test:integration`, `test:coverage`. La cobertura mínima exigida es del **80 %** y está configurada como umbral en Jest.

## Estructura

```text
src/
  domain/            Thread, ModerationPolicy, objetos de valor y eventos.
  application/       Casos de uso, puertos, DTO y errores.
  adapters/
    inbound/http/    Controladores y contratos HTTP.
    outbound/        Persistencia y utilidades de sistema.
  infrastructure/    Configuracion, observabilidad, salud y raiz de composicion.
test/
  unit/              Pruebas unitarias por capa.
  integration/       API real levantada con el modulo completo.
```

El dominio no importa NestJS, SDK de AWS, ORM, HTTP ni drivers de base de datos. La restricción se verifica en CI mediante reglas de ESLint.

## Versión de TypeScript

**TypeScript 5.9.3**, no 7, porque `@nestjs/cli@11.0.24` la declara como dependencia directa. Es la misma decisión que en el resto de servicios NestJS y está registrada en ADR-002.

## Docker

```bash
docker build -t nexus-battle-community:local .
docker run --rm -p 3004:3004 nexus-battle-community:local
```

La imagen es multi-etapa, se ejecuta con el usuario sin privilegios `node`, incluye solo dependencias de producción y no contiene secretos.

## Limitaciones conocidas del alcance actual

- **La persistencia por defecto es en memoria y se pierde al reiniciar.** Con `PERSISTENCE_DRIVER=postgres` opera el adaptador real sobre PostgreSQL con Kysely, probado contra un motor en contenedor. El repositorio en memoria no es un resto del andamiaje: es lo que permite probar el dominio y los casos de uso **sin Docker**.
- **No hay control de acceso.** El identificador de quien modera llega en el cuerpo de la petición, sin verificar. Cualquiera podría ocultar mensajes o cerrar hilos. Implementarlo correctamente requiere que Account emita credenciales verificables, lo que depende del proveedor de identidad pendiente de aprobación. Es la limitación **más relevante de este servicio** y no debe desplegarse en un entorno accesible sin resolverla.
- **No hay filtrado automático de contenido.** La moderación es manual y reactiva. Un filtro previo requiere una decisión de producto sobre qué se considera abusivo.
- La lectura no está paginada. Con el límite de 500 mensajes por hilo es aceptable en la demo, pero no en la arquitectura objetivo.

## Contribución

Se aplican las convenciones descritas en [CONTRIBUTING.md](CONTRIBUTING.md) y la [política de trazabilidad entre repositorios](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/blob/main/docs/governance/cross-repository-traceability.md) de Management.

## Licencia

`Licensing pending project governance`. Este repositorio todavía no tiene una licencia asignada; su definición requiere autorización del gobierno del proyecto.
