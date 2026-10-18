import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ChevronRight,
  Download,
  Eye,
  FileArchive,
  FileAudio,
  FileImage,
  FilePlay,
  FileText,
  Folder,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { DummyModal } from '@/components/drive/DummyModal'
import { PageHeader } from '@/components/drive/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { API_URL, apiFetch, formatBytes, formatDate } from '@/lib/api'

type ConnectedAccount = {
  id: string
  email: string
  displayName?: string | null
  provider: string
  status: string
}

type BrowserItem = {
  id: string
  name: string
  kind: 'folder' | 'file'
  mimeType: string | null
  sizeBytes: string | null
  modifiedAt: string | null
}

type BrowserListing = {
  provider: string
  parentId: string
  items: BrowserItem[]
  nextPageToken: string | null
}

type Crumb = { id: string; name: string }

type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'frame'

const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']
const videoExtensions = ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv']
const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']

function providerLabel(provider: string) {
  if (provider === 's3') return 'S3 Storage'
  return 'Google Drive'
}

function extensionOf(name: string) {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ''
}

function previewKind(item: BrowserItem): PreviewKind | null {
  if (item.kind === 'folder') return null
  const mime = item.mimeType ?? ''
  if (mime.startsWith('application/vnd.google-apps.')) return 'frame'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  const extension = extensionOf(item.name)
  if (imageExtensions.includes(extension)) return 'image'
  if (videoExtensions.includes(extension)) return 'video'
  if (audioExtensions.includes(extension)) return 'audio'
  if (extension === 'pdf') return 'pdf'
  return null
}

function ItemIcon({ item }: { item: BrowserItem }) {
  if (item.kind === 'folder') return <Folder className="h-4 w-4 rounded-sm p-0.5 text-white bg-lime-500" />
  const mime = item.mimeType ?? ''
  const extension = extensionOf(item.name)
  if (mime.startsWith('image/') || imageExtensions.includes(extension)) return <FileImage className="h-4 w-4 rounded-sm p-0.5 text-white bg-yellow-400" />
  if (mime.startsWith('video/') || videoExtensions.includes(extension)) return <FilePlay className="h-4 w-4 rounded-sm p-0.5 text-white bg-orange-500" />
  if (mime.startsWith('audio/') || audioExtensions.includes(extension)) return <FileAudio className="h-4 w-4 rounded-sm p-0.5 text-white bg-purple-500" />
  if (mime === 'application/pdf' || extension === 'pdf') return <FileArchive className="h-4 w-4 rounded-sm p-0.5 text-white bg-cyan-400" />
  if (mime.startsWith('application/vnd.google-apps.')) return <FileText className="h-4 w-4 rounded-sm p-0.5 text-white bg-blue-500" />
  return <FileText className="h-4 w-4 rounded-sm p-0.5 text-white bg-slate-400" />
}

function buildTrail(account: ConnectedAccount, folder: string, folderName: string): Crumb[] {
  const root: Crumb = { id: '', name: account.provider === 's3' ? 'Bucket root' : 'My Drive' }
  if (!folder) return [root]
  if (account.provider === 's3') {
    const crumbs = [root]
    let prefix = ''
    for (const part of folder.split('/').filter(Boolean)) {
      prefix += `${part}/`
      crumbs.push({ id: prefix, name: part })
    }
    return crumbs
  }
  return [root, { id: folder, name: folderName || 'Folder' }]
}

export function StorageBrowserPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [trail, setTrail] = useState<Crumb[]>([])
  const [items, setItems] = useState<BrowserItem[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ item: BrowserItem; url: string } | null>(null)
  const [previewPendingId, setPreviewPendingId] = useState('')

  const accountParam = searchParams.get('account') ?? ''
  const activeAccount = accounts.find((account) => account.id === accountParam) ?? accounts[0]
  const activeAccountId = activeAccount?.id ?? ''
  const parentId = trail.length > 0 ? trail[trail.length - 1].id : ''

  useEffect(() => {
    apiFetch<{ accounts: ConnectedAccount[] }>('/connected-accounts')
      .then((data) => setAccounts(data.accounts.filter((account) => account.status === 'connected')))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load accounts'))
  }, [])

  useEffect(() => {
    if (accounts.length === 0 || searchParams.get('account')) return
    const next = new URLSearchParams(searchParams)
    next.set('account', accounts[0].id)
    setSearchParams(next, { replace: true })
  }, [accounts, searchParams, setSearchParams])

  useEffect(() => {
    if (!activeAccount) {
      setTrail([])
      return
    }
    setTrail(buildTrail(activeAccount, searchParams.get('folder') ?? '', searchParams.get('name') ?? ''))
  }, [activeAccountId])

  const loadItems = useCallback(async (accountId: string, parent: string, pageToken?: string) => {
    if (pageToken) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setItems([])
      setNextPageToken(null)
      setError('')
    }
    try {
      const params = new URLSearchParams({ accountId })
      if (parent) params.set('parentId', parent)
      if (pageToken) params.set('pageToken', pageToken)
      const data = await apiFetch<BrowserListing>(`/storage-browser/list?${params.toString()}`)
      setItems((current) => (pageToken ? [...current, ...data.items] : data.items))
      setNextPageToken(data.nextPageToken)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load this location')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    if (!activeAccountId) return
    void loadItems(activeAccountId, parentId)
  }, [activeAccountId, parentId, loadItems])

  function selectAccount(id: string) {
    const account = accounts.find((entry) => entry.id === id)
    if (account) setTrail(buildTrail(account, '', ''))
    setSearchParams({ account: id }, { replace: true })
  }

  function openFolder(item: BrowserItem) {
    if (!activeAccount) return
    setTrail([...trail, { id: item.id, name: item.name }])
    const next = new URLSearchParams({ account: activeAccount.id })
    next.set('folder', item.id)
    if (activeAccount.provider !== 's3') next.set('name', item.name)
    setSearchParams(next)
  }

  function goToCrumb(index: number) {
    if (!activeAccount) return
    const nextTrail = trail.slice(0, index + 1)
    const current = nextTrail[nextTrail.length - 1]
    setTrail(nextTrail)
    const next = new URLSearchParams({ account: activeAccount.id })
    if (current.id) {
      next.set('folder', current.id)
      if (activeAccount.provider !== 's3') next.set('name', current.name)
    }
    setSearchParams(next)
  }

  async function createToken(item: BrowserItem, disposition: 'inline' | 'attachment') {
    if (!activeAccount) throw new Error('No account selected')
    const data = await apiFetch<{ url: string }>('/storage-browser/tokens', {
      method: 'POST',
      body: JSON.stringify({ accountId: activeAccount.id, fileId: item.id, disposition }),
    })
    return `${API_URL}${data.url}`
  }

  async function openPreview(item: BrowserItem) {
    setPreviewPendingId(item.id)
    setError('')
    try {
      const url = await createToken(item, 'inline')
      setPreview({ item, url })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open preview')
    } finally {
      setPreviewPendingId('')
    }
  }

  async function downloadItem(item: BrowserItem) {
    try {
      const url = await createToken(item, 'attachment')
      const link = document.createElement('a')
      link.href = url
      link.download = item.name
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start download')
    }
  }

  const previewType = preview ? previewKind(preview.item) : null

  return (
    <>
      <PageHeader
        title="Storage Browser"
        description="Browse every file and folder directly from each connected account."
        actions={(
          <Button variant="outline" size="sm" onClick={() => void loadItems(activeAccountId, parentId)} disabled={loading || !activeAccountId}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Refresh
          </Button>
        )}
      />

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-500" htmlFor="storage-browser-account">Account</label>
        <select
          id="storage-browser-account"
          value={activeAccount?.id ?? ''}
          onChange={(event) => selectAccount(event.target.value)}
          className="block w-full max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold focus:border-blue-500 focus:bg-white focus:outline-none"
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.email} — {providerLabel(account.provider)}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="mt-4 rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-600">{error}</p> : null}

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-4 py-3 text-sm">
          {trail.map((crumb, index) => (
            <span key={`${crumb.id}-${index}`} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight className="h-4 w-4 text-slate-400" /> : null}
              {index === trail.length - 1 ? (
                <span className="font-bold text-slate-900">{crumb.name}</span>
              ) : (
                <button type="button" className="font-semibold text-slate-500 transition-colors hover:text-blue-600" onClick={() => goToCrumb(index)}>
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm font-semibold text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-sm font-semibold text-slate-500">
            <Folder className="h-8 w-8 text-slate-300" />
            This location is empty.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50/70">
                <ItemIcon item={item} />
                {item.kind === 'folder' ? (
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-blue-600" onClick={() => openFolder(item)} title={item.name}>
                    {item.name}
                  </button>
                ) : (
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={item.name}>{item.name}</p>
                )}
                <span className="hidden w-24 shrink-0 text-right text-xs text-slate-500 sm:block">{item.kind === 'folder' ? '--' : formatBytes(item.sizeBytes)}</span>
                <span className="hidden w-40 shrink-0 text-right text-xs text-slate-500 md:block">{item.modifiedAt ? formatDate(item.modifiedAt) : '--'}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {item.kind === 'file' && previewKind(item) ? (
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Preview" disabled={previewPendingId === item.id} onClick={() => void openPreview(item)}>
                      {previewPendingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  ) : null}
                  {item.kind === 'file' ? (
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Download" onClick={() => void downloadItem(item)}>
                      <Download className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {nextPageToken ? (
          <div className="flex justify-center border-t border-slate-100 px-4 py-3">
            <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadItems(activeAccountId, parentId, nextPageToken)}>
              {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Load more
            </Button>
          </div>
        ) : null}
      </Card>

      <DummyModal
        open={preview !== null}
        title={preview?.item.name ?? ''}
        description={preview && activeAccount ? `${providerLabel(activeAccount.provider)} · ${preview.item.kind === 'file' ? formatBytes(preview.item.sizeBytes) : '--'}` : ''}
        onClose={() => setPreview(null)}
        className="sm:max-w-3xl"
      >
        {preview && previewType === 'image' ? <img src={preview.url} alt={preview.item.name} className="max-h-[70vh] w-full rounded-xl bg-slate-100 object-contain" /> : null}
        {preview && previewType === 'video' ? <video src={preview.url} controls className="max-h-[70vh] w-full rounded-xl bg-black" /> : null}
        {preview && previewType === 'audio' ? <audio src={preview.url} controls className="w-full" /> : null}
        {preview && (previewType === 'pdf' || previewType === 'frame') ? (
          <iframe src={preview.url} title={preview.item.name} className="h-[70vh] w-full rounded-xl border border-slate-200" />
        ) : null}
        {preview && !previewType ? (
          <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-500">
            Preview is not available for this file type. You can still download it.
          </p>
        ) : null}
        {preview ? (
          <div className="mt-4 flex justify-end">
            <Button onClick={() => void downloadItem(preview.item)}>
              <Download className="h-4 w-4" />
              Download
            </Button>
          </div>
        ) : null}
      </DummyModal>
    </>
  )
}
