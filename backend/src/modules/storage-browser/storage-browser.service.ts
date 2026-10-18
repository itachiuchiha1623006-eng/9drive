import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import type { ConnectedAccount } from '@prisma/client'
import { google } from 'googleapis'
import { escapeDriveQueryValue, getAuthedGoogleClient } from '../google/google.service.js'
import { createS3Client, getS3ConfigForAccount } from '../s3/s3.service.js'

const googleDriveFolderMimeType = 'application/vnd.google-apps.folder'
const pageSize = 200

export type BrowserItem = {
  id: string
  name: string
  kind: 'folder' | 'file'
  mimeType: string | null
  sizeBytes: string | null
  modifiedAt: string | null
}

export type BrowserListing = {
  provider: string
  parentId: string
  items: BrowserItem[]
  nextPageToken: string | null
}

export async function listGoogleBrowserItems(account: ConnectedAccount, parentId: string | null, pageToken: string | null): Promise<BrowserListing> {
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const parent = parentId || 'root'

  const response = await drive.files.list({
    q: `'${escapeDriveQueryValue(parent)}' in parents and trashed = false`,
    spaces: 'drive',
    fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
    orderBy: 'folder,name',
    pageSize,
    pageToken: pageToken || undefined,
  })

  const items: BrowserItem[] = []
  for (const file of response.data.files ?? []) {
    if (!file.id || !file.name) continue
    items.push({
      id: file.id,
      name: file.name,
      kind: file.mimeType === googleDriveFolderMimeType ? 'folder' : 'file',
      mimeType: file.mimeType ?? null,
      sizeBytes: file.size ?? null,
      modifiedAt: file.modifiedTime ?? null,
    })
  }

  return { provider: 'google_drive', parentId: parent, items, nextPageToken: response.data.nextPageToken ?? null }
}

function byName(a: BrowserItem, b: BrowserItem) {
  return a.name.localeCompare(b.name)
}

export async function listS3BrowserItems(accountId: string, prefix: string | null, pageToken: string | null): Promise<BrowserListing> {
  const config = await getS3ConfigForAccount(accountId)
  const client = createS3Client(config)
  const parent = prefix ?? ''

  const response = await client.send(new ListObjectsV2Command({
    Bucket: config.bucket,
    Prefix: parent,
    Delimiter: '/',
    MaxKeys: pageSize,
    ContinuationToken: pageToken || undefined,
  }))

  const folders: BrowserItem[] = (response.CommonPrefixes ?? [])
    .filter((entry) => entry.Prefix)
    .map((entry) => ({
      id: entry.Prefix!,
      name: entry.Prefix!.slice(parent.length).replace(/\/$/, ''),
      kind: 'folder',
      mimeType: null,
      sizeBytes: null,
      modifiedAt: null,
    }))

  const files: BrowserItem[] = (response.Contents ?? [])
    .filter((entry) => entry.Key && entry.Key !== parent)
    .map((entry) => ({
      id: entry.Key!,
      name: entry.Key!.slice(parent.length),
      kind: 'file',
      mimeType: null,
      sizeBytes: entry.Size !== undefined ? String(entry.Size) : null,
      modifiedAt: entry.LastModified ? entry.LastModified.toISOString() : null,
    }))

  return {
    provider: 's3',
    parentId: parent,
    items: [...folders.sort(byName), ...files.sort(byName)],
    nextPageToken: response.NextContinuationToken ?? null,
  }
}

export async function getGoogleBrowserStreamFile(account: ConnectedAccount, fileId: string) {
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const meta = await drive.files.get({ fileId, fields: 'id,name,mimeType' })
  if (!meta.data.id || !meta.data.name) throw new Error('File not found.')
  return {
    providerFileId: meta.data.id,
    name: meta.data.name,
    mimeType: meta.data.mimeType ?? 'application/octet-stream',
    connectedAccount: account,
  }
}

export function getS3BrowserStreamFile(accountId: string, key: string) {
  const name = key.split('/').filter(Boolean).pop() ?? key
  return { connectedAccountId: accountId, providerFileId: key, name, mimeType: 'application/octet-stream' }
}
