import { sql, type Kysely } from 'kysely'

/**
 * IP de origen y proteccion append-only de `comment_moderation_actions`
 * (HU-41.8, PDF fuente 7.3.5).
 *
 * `ip_address` se anade NULLABLE: filas historicas anteriores a esta
 * migracion no tienen IP capturada y no se inventa una para ellas -no hay
 * forma honesta de reconstruirla-; toda accion NUEVA la resuelve siempre
 * desde el servidor (ver `main.ts` y `CommentModerationController`).
 *
 * El disparador `comment_moderation_actions_solo_insercion` hace que un
 * UPDATE o DELETE sobre la tabla falle en el motor, no solo en el
 * repositorio: la auditoria de moderacion es evidencia de solo insercion, y
 * una fila que desaparece o cambia en silencio por un error de aplicacion
 * -o por acceso directo a la base de datos- deja de servir como evidencia.
 * Una migracion administrativa futura que necesite tocar esta tabla debe
 * deshabilitar el disparador explicitamente, nunca colarse por debajo de el.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('comment_moderation_actions').addColumn('ip_address', 'text').execute()

  await sql`
    create function comment_moderation_actions_evita_modificacion()
    returns trigger as $$
    begin
      raise exception 'comment_moderation_actions es de solo insercion (append-only): % no esta permitido', TG_OP;
    end;
    $$ language plpgsql
  `.execute(db)

  await sql`
    create trigger comment_moderation_actions_solo_insercion
    before update or delete on comment_moderation_actions
    for each row execute function comment_moderation_actions_evita_modificacion()
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop trigger comment_moderation_actions_solo_insercion on comment_moderation_actions`.execute(
    db,
  )
  await sql`drop function comment_moderation_actions_evita_modificacion()`.execute(db)
  await db.schema.alterTable('comment_moderation_actions').dropColumn('ip_address').execute()
}
