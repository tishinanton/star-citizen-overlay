import { useEffect } from 'react'

export default function DragHandle(): React.JSX.Element {
  useEffect(() => {
    document.documentElement.dataset.view = 'drag-handle'
    return () => {
      delete document.documentElement.dataset.view
    }
  }, [])

  return <div className="drag-handle" aria-label="Drag mining overlay" />
}
