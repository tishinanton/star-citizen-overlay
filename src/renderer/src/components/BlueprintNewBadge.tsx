import { Sparkles } from 'lucide-react'
import React from 'react'

export default function BlueprintNewBadge({
  isNew,
  className = ''
}: {
  isNew?: boolean
  className?: string
}): React.JSX.Element | null {
  if (isNew !== true) return null

  return (
    <span
      className={`blueprint-new-badge ${className}`.trim()}
      aria-label="New blueprint"
      title="New in this game-data build"
    >
      <Sparkles size={11} aria-hidden="true" />
      <span aria-hidden="true">New</span>
    </span>
  )
}
