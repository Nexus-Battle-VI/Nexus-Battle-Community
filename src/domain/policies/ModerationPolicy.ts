/**
 * Limites de moderacion del contexto Community.
 *
 * El limite de mensajes por hilo no es una restriccion tecnica sino de
 * producto: un hilo interminable deja de ser legible y se convierte en el
 * vehiculo habitual del abuso por volumen.
 */
export const ModerationPolicy = {
  MAX_POSTS_PER_THREAD: 500,
} as const
