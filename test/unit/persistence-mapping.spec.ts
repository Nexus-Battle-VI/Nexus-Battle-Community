import 'reflect-metadata'

import {
  PersistenceMappingError,
  toPostRows,
  toSnapshot,
  toThreadRow,
  type PostRow,
  type ThreadRow,
} from '../../src/adapters/outbound/persistence/mapping'
import { ThreadStatus } from '../../src/domain/entities/Thread'
import { ModerationPolicy } from '../../src/domain/policies/ModerationPolicy'
import { up } from '../../src/adapters/outbound/persistence/migrations/001-threads'
import { describeError } from '../../src/infrastructure/observability/describe-error'

const AT = new Date('2026-08-25T10:00:00.000Z')

const THREAD: ThreadRow = {
  id: 'thr-1',
  title: 'Estrategias para el jefe final',
  author_id: 'sub-ana',
  status: ThreadStatus.Open,
}

const post = (id: string, position: number, hidden = false): PostRow => ({
  id,
  thread_id: 'thr-1',
  position,
  author_id: 'sub-ana',
  content: `Contenido de ${id}`,
  hidden,
  created_at: AT,
})

describe('Traduccion entre filas e instantanea', () => {
  it('reconstruye la instantanea completa', () => {
    expect(toSnapshot(THREAD, [post('pos-1', 0)])).toEqual({
      id: 'thr-1',
      title: 'Estrategias para el jefe final',
      authorId: 'sub-ana',
      status: ThreadStatus.Open,
      posts: [
        {
          id: 'pos-1',
          authorId: 'sub-ana',
          content: 'Contenido de pos-1',
          hidden: false,
          createdAt: AT.toISOString(),
        },
      ],
    })
  })

  /**
   * El orden es parte del agregado. Que la consulta pida `order by position` no
   * basta: bastaria que alguien escribiera una consulta nueva sin acordarse.
   */
  it('ordena los mensajes por posicion aunque lleguen desordenados', () => {
    const snapshot = toSnapshot(THREAD, [post('pos-3', 2), post('pos-1', 0), post('pos-2', 1)])

    expect(snapshot.posts.map((entry) => entry.id)).toEqual(['pos-1', 'pos-2', 'pos-3'])
  })

  it('la traduccion es reversible', () => {
    const snapshot = toSnapshot(THREAD, [post('pos-1', 0), post('pos-2', 1, true)])

    expect(toThreadRow(snapshot)).toEqual(THREAD)
    expect(toPostRows(snapshot)).toEqual([post('pos-1', 0), post('pos-2', 1, true)])
  })

  /**
   * La posicion la asigna el agregado por el lugar que ocupa cada mensaje, no
   * se conserva de la fila leida: si un mensaje intermedio desapareciera, las
   * posiciones deben recalcularse sin dejar huecos.
   */
  it('reasigna las posiciones a partir del orden del agregado', () => {
    const snapshot = toSnapshot(THREAD, [post('pos-a', 4), post('pos-b', 9)])

    expect(toPostRows(snapshot).map((row) => row.position)).toEqual([0, 1])
  })

  /**
   * Puede parecer excesivo validar lo que viene de la propia base de datos, que
   * ya tiene sus restricciones. Pero una fila escrita por una version anterior
   * del esquema, o por una migracion a medias, llegaria aqui sin que nada la
   * detuviera. Construir un agregado con un estado que el dominio no reconoce
   * es peor que fallar al leerlo.
   */
  it('rechaza un estado que el dominio no reconoce', () => {
    expect(() => toSnapshot({ ...THREAD, status: 'ARCHIVADO' }, [])).toThrow(
      PersistenceMappingError,
    )
  })

  it('rechaza una fecha de mensaje invalida', () => {
    const snapshot = {
      ...toSnapshot(THREAD, []),
      posts: [
        {
          id: 'pos-1',
          authorId: 'sub-ana',
          content: 'Hola',
          hidden: false,
          createdAt: 'no es una fecha',
        },
      ],
    }

    expect(() => toPostRows(snapshot)).toThrow(PersistenceMappingError)
  })

  it('admite un hilo sin ningun mensaje', () => {
    expect(toSnapshot(THREAD, []).posts).toEqual([])
    expect(toPostRows(toSnapshot(THREAD, []))).toEqual([])
  })
})

/**
 * Una migracion NO puede importar el dominio: queda congelada en el tiempo y
 * tiene que seguir siendo ejecutable tal y como se escribio, aunque el dominio
 * cambie despues. Eso obliga a repetir el vocabulario en la restriccion SQL.
 *
 * Estas pruebas son lo que evita que esa duplicacion se convierta en
 * divergencia: si alguien anade un estado o cambia el limite de mensajes sin
 * escribir la migracion correspondiente, falla aqui y no en produccion.
 */
describe('El dominio y la migracion no divergen', () => {
  const sqlDeLaMigracion = up.toString()

  it.each(Object.values(ThreadStatus))('la migracion admite el estado %s', (status) => {
    expect(sqlDeLaMigracion).toContain(`'${status}'`)
  })

  it('la migracion no admite estados que el dominio desconoce', () => {
    const enLaRestriccion = [...sqlDeLaMigracion.matchAll(/'([A-Z_]{3,})'/g)].map(
      (match) => match[1]!,
    )
    const conocidos: readonly string[] = Object.values(ThreadStatus)

    expect(enLaRestriccion.filter((value) => !conocidos.includes(value))).toEqual([])
  })

  it('la cota de la posicion coincide con el limite de mensajes por hilo', () => {
    expect(sqlDeLaMigracion).toContain(
      `position < ${String(ModerationPolicy.MAX_POSTS_PER_THREAD)}`,
    )
  })
})

/**
 * Muchas bibliotecas rechazan con `unknown`. Pasar eso por `String()` a secas
 * convierte cualquier objeto en `[object Object]` justo cuando mas falta hace
 * saber que ocurrio.
 */
describe('describeError', () => {
  it('usa el mensaje cuando es un Error', () => {
    expect(describeError(new Error('algo fallo'))).toBe('algo fallo')
  })

  it('serializa un objeto en lugar de producir [object Object]', () => {
    expect(describeError({ code: '23505', detail: 'duplicado' })).toBe(
      '{"code":"23505","detail":"duplicado"}',
    )
  })

  it.each([
    [undefined, 'undefined'],
    [null, 'null'],
  ])('describe %s sin romperse', (valor, esperado) => {
    expect(describeError(valor)).toBe(esperado)
  })

  it('no se rompe con una estructura circular', () => {
    const circular: Record<string, unknown> = {}
    circular.yo = circular

    expect(describeError(circular)).toBe('error no serializable')
  })
})
