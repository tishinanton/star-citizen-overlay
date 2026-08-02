import { useEffect, useState, type CSSProperties } from 'react'
import { Maximize2, Minus, X } from 'lucide-react'

import { useRockfall } from '../hooks/useRockfall'

export default function DragHandle(): React.JSX.Element {
  const { snapshot } = useRockfall()
  const [collapsed, setCollapsed] = useState(false)
  const [collapsePending, setCollapsePending] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.view = 'drag-handle'
    return () => {
      delete document.documentElement.dataset.view
    }
  }, [])

  useEffect(() => {
    let active = true
    void window.rockfall
      .getOverlayWindowState()
      .then((state) => {
        if (active) setCollapsed(state.collapsed)
      })
      .catch((reason: unknown) => {
        console.error('Overlay window state could not be loaded.', reason)
      })
    return () => {
      active = false
    }
  }, [])

  const setOverlayCollapsed = async (nextCollapsed: boolean): Promise<void> => {
    setCollapsePending(true)
    try {
      const state = await window.rockfall.setOverlayCollapsed(nextCollapsed)
      setCollapsed(state.collapsed)
    } catch (reason) {
      console.error('Overlay collapsed state could not be changed.', reason)
    } finally {
      setCollapsePending(false)
    }
  }

  const hideOverlay = async (): Promise<void> => {
    try {
      await window.rockfall.hideOverlay()
    } catch (reason) {
      console.error('Overlay could not be hidden.', reason)
    }
  }

  const style = {
    '--overlay-font-scale': snapshot?.settings.fontScale ?? 1
  } as CSSProperties

  return (
    <div className="drag-handle" aria-label="Drag mining overlay" style={style}>
      <div className="overlay-window-controls">
        <button
          className="overlay-window-control"
          type="button"
          aria-label={collapsed ? 'Expand overlay' : 'Collapse overlay'}
          title={collapsed ? 'Expand overlay' : 'Collapse overlay'}
          disabled={collapsePending}
          onClick={() => void setOverlayCollapsed(!collapsed)}
        >
          {collapsed ? (
            <Maximize2 aria-hidden="true" strokeWidth={2} />
          ) : (
            <Minus aria-hidden="true" strokeWidth={2} />
          )}
        </button>
        <button
          className="overlay-window-control overlay-window-control--close"
          type="button"
          aria-label="Close overlay"
          title="Close overlay"
          onClick={() => void hideOverlay()}
        >
          <X aria-hidden="true" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
