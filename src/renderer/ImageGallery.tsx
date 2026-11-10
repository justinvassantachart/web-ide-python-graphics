import { useState } from 'react'
import type { EncodedImage, ImageServiceSnapshot } from 'web-ide/assets'
import { RasterImage, type ImageResourceReader } from './RasterImage'

/** Host callback controls promotion; simply showing/downloading never edits a project. */
export interface ImageGalleryProps {
  snapshot: ImageServiceSnapshot
  readResource: ImageResourceReader
  downloadPresentation: (id: string) => Promise<EncodedImage>
  getOutput?: (id: string) => EncodedImage | Promise<EncodedImage>
  onSaveToProject?: (output: ImageServiceSnapshot['outputs'][number], image: EncodedImage) => Promise<void>
}

function download(image: EncodedImage, filename: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(image.bytes)], { type: image.mediaType }))
  const link = document.createElement('a')
  link.href = url
  // eslint-disable-next-line no-control-regex -- Strip unsafe filename controls.
  link.download = filename.replace(/[\\/\u0000-\u001f]/g, '_')
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function ImageGallery({ snapshot, readResource, downloadPresentation, getOutput, onSaveToProject }: ImageGalleryProps) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const perform = async (key: string, task: () => Promise<void>) => {
    setBusy(key); setError('')
    try { await task() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Image action failed') }
    finally { setBusy(null) }
  }
  if (!snapshot.presentations.length && !snapshot.outputs.length) return null
  return <section aria-label="Image outputs" style={{ padding: 12, display: 'grid', gap: 16, color: 'var(--color-foreground, #ddd)' }}>
    {error && <div role="alert">{error}</div>}
    {snapshot.presentations.map(presentation => <figure key={presentation.presentationId} style={{ margin: 0 }}>
      <figcaption>{presentation.title} · {presentation.resource.width} × {presentation.resource.height}</figcaption>
      <div style={{ width: presentation.resource.width, maxWidth: '100%', aspectRatio: `${presentation.resource.width} / ${presentation.resource.height}`, background: 'white' }}>
        <RasterImage resourceId={presentation.resource.resourceId} version={presentation.resource.version} readResource={readResource} label={presentation.title} />
      </div>
      <button type="button" disabled={busy !== null} onClick={() => void perform(presentation.presentationId, async () => download(await downloadPresentation(presentation.presentationId), `${presentation.title.replace(/\.[^.]+$/, '') || 'image'}.png`))}>Download PNG</button>
    </figure>)}
    {snapshot.outputs.map(output => <div key={output.outputId} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span>{output.path} · {output.byteLength.toLocaleString()} bytes</span>
      {getOutput && <button type="button" disabled={busy !== null} onClick={() => void perform(output.outputId, async () => download(await getOutput(output.outputId), output.path.split('/').pop() || 'image.png'))}>Download</button>}
      {getOutput && onSaveToProject && <button type="button" disabled={busy !== null} onClick={() => void perform(output.outputId, async () => onSaveToProject(output, await getOutput(output.outputId)))}>Save to project</button>}
    </div>)}
  </section>
}
