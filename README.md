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

- **La persistencia es en memoria** y se pierde al reiniciar. El adaptador PostgreSQL depende de que ADR-005 decida el ORM. Configurar `PERSISTENCE_DRIVER=postgres` valida la configuración y lo advierte en el registro, pero no habilita un adaptador que no existe.
- **No hay control de acceso.** El identificador de quien modera llega en el cuerpo de la petición, sin verificar. Cualquiera podría ocultar mensajes o cerrar hilos. Implementarlo correctamente requiere que Account emita credenciales verificables, lo que depende del proveedor de identidad pendiente de aprobación. Es la limitación **más relevante de este servicio** y no debe desplegarse en un entorno accesible sin resolverla.
- **No hay filtrado automático de contenido.** La moderación es manual y reactiva. Un filtro previo requiere una decisión de producto sobre qué se considera abusivo.
- La lectura no está paginada. Con el límite de 500 mensajes por hilo es aceptable en la demo, pero no en la arquitectura objetivo.

## Contribución

Se aplican las convenciones descritas en [CONTRIBUTING.md](CONTRIBUTING.md) y la [política de trazabilidad entre repositorios](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/blob/main/docs/governance/cross-repository-traceability.md) de Management.

## Licencia

`Licensing pending project governance`. Este repositorio todavía no tiene una licencia asignada; su definición requiere autorización del gobierno del proyecto.
