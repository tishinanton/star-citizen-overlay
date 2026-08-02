import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useRockfall } from '../hooks/useRockfall'
import { getOverlayLayoutKey } from '../../../shared/overlay-layout'
import SignatureBoard from './SignatureBoard'

export default function OverlayApp(): React.JSX.Element | null {
  const { snapshot } = useRockfall()
  const rootRef = useRef<HTMLElement>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.view = 'overlay'
    return () => {
      delete document.documentElement.dataset.view
    }
  }, [])

  useEffect(() => {
    let active = true
    const unsubscribe = window.rockfall.onOverlayWindowState((state) => {
      if (active) setCollapsed(state.collapsed)
    })
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
      unsubscribe()
    }
  }, [])

  useLayoutEffect(() => {
    if (!snapshot || !rootRef.current) return

    const root = rootRef.current
    const board = root.querySelector<HTMLElement>('.signature-board')
    const header = root.querySelector<HTMLElement>('.signature-board__header')
    if (!board || !header) {
      console.error('Overlay dimensions could not be measured because its board is incomplete.')
      return
    }

    let animationFrame: number | null = null
    const reportMetrics = (): void => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(() => {
        const boardStyle = getComputedStyle(board)
        const rootStyle = getComputedStyle(root)
        const borderHeight =
          Number.parseFloat(boardStyle.borderTopWidth) +
          Number.parseFloat(boardStyle.borderBottomWidth)
        const rootPadding =
          Number.parseFloat(rootStyle.paddingTop) + Number.parseFloat(rootStyle.paddingBottom)
        const height =
          Math.max(board.getBoundingClientRect().height, board.scrollHeight + borderHeight) +
          rootPadding

        void window.rockfall
          .reportOverlayMetrics({
            layoutKey: getOverlayLayoutKey(snapshot.settings),
            height,
            headerHeight: header.getBoundingClientRect().height
          })
          .catch((reason: unknown) => {
            console.error('Overlay dimensions could not be synchronized.', reason)
          })
      })
    }

    const observer = new ResizeObserver(reportMetrics)
    observer.observe(board)
    reportMetrics()

    return () => {
      observer.disconnect()
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    }
  }, [snapshot])

  return snapshot ? (
    <main className="overlay-root" ref={rootRef}>
      <SignatureBoard snapshot={snapshot} collapsed={collapsed} />
    </main>
  ) : null
}
