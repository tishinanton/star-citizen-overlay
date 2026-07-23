import ControlApp from './components/ControlApp'
import DragHandle from './components/DragHandle'
import OverlayApp from './components/OverlayApp'

const view = new URLSearchParams(window.location.search).get('view')

function App(): React.JSX.Element {
  if (view === 'overlay') return <OverlayApp />
  if (view === 'drag-handle') return <DragHandle />
  return <ControlApp />
}

export default App
