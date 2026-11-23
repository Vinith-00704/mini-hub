// A note the owner writes in the tile's settings. Shown as plain text, kept as written, blurred in privacy mode.

import { useSettings } from '../app/queries.ts'
import { Window } from '../components/look/index.ts'
import { visible } from '../components/look/plainText.tsx'
import { noteText, type TileProps } from './settings.ts'

export function NoteTile({ settings = {} }: TileProps) {
  const privacy = useSettings().data?.privacy === true
  const body = noteText(settings)
  return (
    <Window title="Note" state={body.trim() ? 'ready' : 'empty'} emptyText="An empty note. Write in it from this tile's settings.">
      <p dir="auto" className={`text-body break-words whitespace-pre-wrap [overflow-wrap:anywhere] ${privacy ? 'privacy-blur' : ''}`}>
        {visible(body)}
      </p>
    </Window>
  )
}
