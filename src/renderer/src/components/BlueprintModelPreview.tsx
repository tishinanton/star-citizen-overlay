import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { Box, LoaderCircle, Maximize2, RotateCcw, TriangleAlert } from 'lucide-react'
import {
  AmbientLight,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Spherical,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import type { BlueprintModelResult } from '../../../shared/contracts'
import { disposeModel, getModelFraming, resetModelCamera } from '../lib/model-viewer'

interface BlueprintModelPreviewProps {
  model: BlueprintModelResult | null
  preparing: boolean
  requestKey: string
  fallbackImageDataUrl: string | null
  onRetry: () => void
}

export default function BlueprintModelPreview({
  model,
  preparing,
  requestKey,
  fallbackImageDataUrl,
  onRetry
}: BlueprintModelPreviewProps): React.JSX.Element {
  const [resetVersion, setResetVersion] = useState(0)
  const [viewerError, setViewerError] = useState<{
    requestKey: string
    message: string
  } | null>(null)
  const [readyRequestKey, setReadyRequestKey] = useState('')
  const readyModel = model?.status === 'ready' ? model : null
  const modelBytes = readyModel?.bytes ?? null
  const currentError = viewerError?.requestKey === requestKey ? viewerError.message : null
  const viewerReady = modelBytes !== null && readyRequestKey === requestKey
  const status = currentError
    ? 'error'
    : preparing || (readyModel !== null && !viewerReady)
      ? 'preparing'
      : (model?.status ?? 'preparing')
  const message = currentError ?? model?.message ?? 'Preparing the local 3D model.'
  const handleReady = useCallback(() => {
    setReadyRequestKey(requestKey)
  }, [requestKey])
  const handleError = useCallback(
    (error: string) => {
      setViewerError({ requestKey, message: error })
    },
    [requestKey]
  )

  return (
    <section className="blueprint-model" aria-labelledby="blueprint-model-title">
      <div className="blueprint-model__heading">
        <div>
          <Maximize2 size={15} />
          <h3 id="blueprint-model-title">Interactive model</h3>
        </div>
        <button
          type="button"
          onClick={() => setResetVersion((current) => current + 1)}
          disabled={!viewerReady}
          title="Reset model position and zoom"
        >
          <RotateCcw size={14} />
          Reset view
        </button>
      </div>

      <div className={`blueprint-model__stage blueprint-model__stage--${status}`}>
        <PreviewFallback imageDataUrl={fallbackImageDataUrl} hidden={viewerReady} />
        {readyModel?.bytes && (
          <InteractiveModelCanvas
            bytes={readyModel.bytes}
            resetVersion={resetVersion}
            onReady={handleReady}
            onError={handleError}
          />
        )}
        {!viewerReady && (
          <div className="blueprint-model__state" role={status === 'error' ? 'alert' : 'status'}>
            {status === 'preparing' || status === 'superseded' ? (
              <LoaderCircle className="is-spinning" size={18} />
            ) : (
              <TriangleAlert size={18} />
            )}
            <div>
              <strong>{modelStatusTitle(status, message)}</strong>
              <span>{message}</span>
            </div>
            {(status === 'error' || status === 'unavailable') && (
              <button type="button" onClick={onRetry}>
                Retry preview
              </button>
            )}
          </div>
        )}
        {viewerReady && readyModel?.stats && (
          <div className="blueprint-model__telemetry" aria-live="polite">
            <span>{formatBytes(readyModel.stats.byteLength)}</span>
            <span>{readyModel.stats.triangleCount.toLocaleString('en-US')} triangles</span>
            <span>{readyModel.cache === 'disk' ? 'Local cache' : 'Generated locally'}</span>
          </div>
        )}
      </div>
      <p className="blueprint-model__controls">
        Drag to rotate · Wheel or pinch to zoom · Arrow keys rotate · +/− zoom · Home resets
      </p>
    </section>
  )
}

function PreviewFallback({
  imageDataUrl,
  hidden
}: {
  imageDataUrl: string | null
  hidden: boolean
}): React.JSX.Element {
  return (
    <div className={`blueprint-model__fallback ${hidden ? 'is-hidden' : ''}`} aria-hidden="true">
      {imageDataUrl ? <img src={imageDataUrl} alt="" /> : <Box size={48} />}
    </div>
  )
}

function InteractiveModelCanvas({
  bytes,
  resetVersion,
  onReady,
  onError
}: {
  bytes: Uint8Array
  resetVersion: number
  onReady: () => void
  onError: (message: string) => void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const resetRef = useRef<(() => void) | null>(null)
  const interactionRef = useRef<{
    camera: PerspectiveCamera
    controls: OrbitControls
    render: () => void
  } | null>(null)

  useEffect(() => {
    resetRef.current?.()
  }, [resetVersion])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let disposed = false
    let modelRoot: Group | null = null
    let resizeObserver: ResizeObserver | null = null
    let renderer: WebGLRenderer | null = null
    let controls: OrbitControls | null = null

    try {
      renderer = new WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power'
      })
      renderer.outputColorSpace = SRGBColorSpace
      renderer.setClearColor(new Color(0x061218), 0)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    } catch (reason) {
      onError(`WebGL preview could not start: ${errorMessage(reason)}`)
      return
    }

    const scene = new Scene()
    const camera = new PerspectiveCamera(36, 1, 0.01, 10_000)
    camera.up.set(0, 0, 1)
    controls = new OrbitControls(camera, canvas)
    controls.enablePan = false
    controls.enableDamping = false
    controls.rotateSpeed = 0.72
    controls.zoomSpeed = 0.82
    controls.screenSpacePanning = false

    scene.add(new AmbientLight(0xa8d9e6, 1.65))
    const keyLight = new DirectionalLight(0xd7f7ff, 3.2)
    keyLight.position.set(-3, -4, 6)
    scene.add(keyLight)
    const rimLight = new DirectionalLight(0x239dc4, 2.1)
    rimLight.position.set(5, 3, 1)
    scene.add(rimLight)

    const render = (): void => {
      if (!disposed) renderer?.render(scene, camera)
    }
    interactionRef.current = { camera, controls, render }
    controls.addEventListener('change', render)

    resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.floor(entry.contentRect.width))
      const height = Math.max(1, Math.floor(entry.contentRect.height))
      renderer?.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      render()
    })
    resizeObserver.observe(canvas)

    const manager = new LoadingManager()
    manager.setURLModifier(() => {
      throw new Error('External model resources are blocked.')
    })
    const loader = new GLTFLoader(manager)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    loader.parse(
      buffer,
      '',
      (gltf) => {
        if (disposed) {
          disposeModel(gltf.scene)
          return
        }
        modelRoot = gltf.scene
        const material = new MeshStandardMaterial({
          color: 0x6ba2b5,
          emissive: 0x07151a,
          metalness: 0.24,
          roughness: 0.68,
          side: DoubleSide
        })
        modelRoot.traverse((object) => {
          if (!(object instanceof Mesh)) return
          const previous = Array.isArray(object.material) ? object.material : [object.material]
          for (const item of previous) item.dispose()
          object.material = material
          object.castShadow = false
          object.receiveShadow = false
        })
        scene.add(modelRoot)
        const framing = getModelFraming(modelRoot, camera.fov)
        controls!.minDistance = framing.minimumDistance
        controls!.maxDistance = framing.maximumDistance
        const reset = (): void => {
          resetModelCamera(camera, framing, controls!.target)
          controls!.update()
          render()
        }
        resetRef.current = reset
        reset()
        onReady()
      },
      (reason) => {
        if (!disposed) onError(`The converted model could not be opened: ${errorMessage(reason)}`)
      }
    )

    return () => {
      disposed = true
      resetRef.current = null
      interactionRef.current = null
      resizeObserver?.disconnect()
      controls?.removeEventListener('change', render)
      controls?.dispose()
      if (modelRoot) {
        scene.remove(modelRoot)
        disposeModel(modelRoot)
      }
      renderer?.dispose()
      renderer?.forceContextLoss()
    }
  }, [bytes, onError, onReady])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    const interaction = interactionRef.current
    if (!interaction) return
    const { camera, controls, render } = interaction
    const step = event.shiftKey ? 0.22 : 0.1
    if (event.key === 'Home') {
      event.preventDefault()
      resetRef.current?.()
      return
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomCamera(camera, controls, 0.88)
      render()
      return
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      zoomCamera(camera, controls, 1.14)
      render()
      return
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      const horizontal = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0
      const vertical = event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0
      orbitCameraFromKeyboard(camera, controls, horizontal, vertical)
      render()
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="blueprint-model__canvas"
      tabIndex={0}
      aria-label="Interactive 3D blueprint model. Drag to rotate, wheel or pinch to zoom, use arrow keys to rotate, plus or minus to zoom, and Home to reset."
      onKeyDown={handleKeyDown}
    />
  )
}

function orbitCameraFromKeyboard(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  horizontal: number,
  vertical: number
): void {
  const offset = camera.position.clone().sub(controls.target)
  const orbitSpace = new Quaternion().setFromUnitVectors(camera.up, new Vector3(0, 1, 0))
  const cameraSpace = orbitSpace.clone().invert()
  offset.applyQuaternion(orbitSpace)
  const spherical = new Spherical().setFromVector3(offset)
  spherical.theta += horizontal
  spherical.phi = Math.min(Math.max(spherical.phi - vertical, 0.05), Math.PI - 0.05)
  camera.position
    .copy(controls.target)
    .add(offset.setFromSpherical(spherical).applyQuaternion(cameraSpace))
  camera.lookAt(controls.target)
  controls.update()
}

function zoomCamera(camera: PerspectiveCamera, controls: OrbitControls, multiplier: number): void {
  const offset = camera.position.clone().sub(controls.target)
  const distance = Math.min(
    Math.max(offset.length() * multiplier, controls.minDistance),
    controls.maxDistance
  )
  camera.position.copy(controls.target).add(offset.setLength(distance))
  camera.lookAt(controls.target)
  controls.update()
}

function modelStatusTitle(status: string, message: string): string {
  if (status === 'preparing' || status === 'superseded') return 'Preparing local model'
  if (status === 'unsupported') return 'Static preview only'
  if (status === 'unavailable' && message.includes('Cryengine Converter')) {
    return 'Converter required'
  }
  if (status === 'unavailable') return 'Model unavailable'
  return 'Interactive preview failed'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
