import crypto from 'node:crypto'
import { env } from '../config/env.js'

const key = crypto.createHash('sha256').update(env.TOKEN_ENCRYPTION_KEY).digest()

export function encryptText(value: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptText(value: string) {
  const [ivRaw, tagRaw, encryptedRaw] = value.split(':')
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error('Invalid encrypted payload')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64'))
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64')), decipher.final()]).toString('utf8')
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function signPayload<T extends Record<string, unknown>>(payload: T, ttlMs: number): string {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url')
  const signature = crypto.createHmac('sha256', key).update(data).digest('base64url')
  return `${data}.${signature}`
}

export function verifyPayload<T extends Record<string, unknown>>(token: string): T | null {
  const [data, signature] = token.split('.')
  if (!data || !signature) return null
  const expected = crypto.createHmac('sha256', key).update(data).digest('base64url')
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as Record<string, unknown> & { exp?: unknown }
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null
    return parsed as T
  } catch {
    return null
  }
}
