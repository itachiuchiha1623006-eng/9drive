import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'

type UpstreamError = { name?: string; message?: string; $metadata?: { httpStatusCode?: number } }

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ')
    return res.status(400).json({ code: 'VALIDATION_ERROR', message })
  }

  const upstream = error as UpstreamError
  if (upstream && typeof upstream === 'object' && ('$metadata' in upstream || upstream.name === 'TimeoutError' || upstream.name === 'RequestTimeout')) {
    console.warn(`[upstream] ${upstream.name ?? 'ProviderError'}: ${upstream.message ?? 'request failed'}`)
    return res.status(502).json({ code: 'UPSTREAM_ERROR', message: upstream.message ?? 'Upstream provider request failed' })
  }

  console.error(error)
  const message = error instanceof Error ? error.message : 'Internal server error'
  return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message })
}
