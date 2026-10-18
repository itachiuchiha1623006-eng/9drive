import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { signPayload, verifyPayload } from '../../utils/crypto.js'
import { streamGoogleFile } from '../files/stream-google-file.js'
import { streamS3File } from '../s3/s3.service.js'
import {
  getGoogleBrowserStreamFile,
  getS3BrowserStreamFile,
  listGoogleBrowserItems,
  listS3BrowserItems,
} from './storage-browser.service.js'

export const storageBrowserRouter = Router()

const tokenTtlMs = 10 * 60 * 1000

type StreamTokenPayload = { userId: string; accountId: string; fileId: string; disposition?: string }

async function findOwnedAccount(accountId: string, userId: string) {
  return prisma.connectedAccount.findFirst({ where: { id: accountId, userId, status: 'connected' } })
}

const listQuerySchema = z.object({
  accountId: z.string().min(1),
  parentId: z.string().optional(),
  pageToken: z.string().optional(),
})

storageBrowserRouter.get('/list', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query)
    const account = await findOwnedAccount(query.accountId, req.user!.id)
    if (!account) return res.status(404).json({ code: 'ACCOUNT_NOT_FOUND', message: 'Storage account not found.' })

    const listing = account.provider === 's3'
      ? await listS3BrowserItems(account.id, query.parentId ?? null, query.pageToken ?? null)
      : await listGoogleBrowserItems(account, query.parentId ?? null, query.pageToken ?? null)

    return res.json(listing)
  } catch (error) {
    return next(error)
  }
})

const tokenBodySchema = z.object({
  accountId: z.string().min(1),
  fileId: z.string().min(1),
  disposition: z.enum(['inline', 'attachment']).optional(),
})

storageBrowserRouter.post('/tokens', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = tokenBodySchema.parse(req.body)
    const account = await findOwnedAccount(body.accountId, req.user!.id)
    if (!account) return res.status(404).json({ code: 'ACCOUNT_NOT_FOUND', message: 'Storage account not found.' })

    const token = signPayload<StreamTokenPayload>(
      { userId: req.user!.id, accountId: account.id, fileId: body.fileId, disposition: body.disposition ?? 'inline' },
      tokenTtlMs,
    )

    return res.status(201).json({ url: `/storage-browser/stream/${token}`, expiresInSeconds: tokenTtlMs / 1000 })
  } catch (error) {
    return next(error)
  }
})

storageBrowserRouter.get('/stream/:token', async (req, res, next) => {
  try {
    const payload = verifyPayload<StreamTokenPayload>(String(req.params.token))
    if (!payload) return res.status(401).json({ code: 'INVALID_TOKEN', message: 'Invalid or expired link.' })

    const account = await findOwnedAccount(payload.accountId, payload.userId)
    if (!account) return res.status(404).json({ code: 'ACCOUNT_NOT_FOUND', message: 'Storage account not found.' })

    const options = { disposition: payload.disposition === 'attachment' ? 'attachment' as const : 'inline' as const }

    if (account.provider === 's3') {
      return await streamS3File(getS3BrowserStreamFile(account.id, payload.fileId), req.headers.range, res, options)
    }

    return await streamGoogleFile(await getGoogleBrowserStreamFile(account, payload.fileId), req.headers.range, res, options)
  } catch (error) {
    return next(error)
  }
})
