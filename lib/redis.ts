import { Redis } from '@upstash/redis'

/**
 * Redis (Upstash) client
 *
 * - Usado para cache/filas/estatísticas em rotas server-side.
 * - Mantém compatibilidade com testes que importam `@/lib/redis`.
 */

const redisUrl = process.env.UPSTASH_REDIS_REST_URL
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN

export const isRedisConfigured = (): boolean => {
  return Boolean(redisUrl && redisToken)
}

export const redis = isRedisConfigured()
  ? new Redis({
      url: redisUrl!,
      token: redisToken!,
    })
  : null
