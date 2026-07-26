import type { CSSProperties } from 'react'
import { Crosshair, MapPin, Move } from 'lucide-react'

import type {
  AppSnapshot,
  BestMiningLocationState,
  MiningMaterial
} from '../../../shared/contracts'
import { buildClusterSignatures } from '../../../shared/signatures'
import { formatMiningProbability, formatMiningSiteName } from '../lib/mining-location-format'

const numberFormatter = new Intl.NumberFormat('en-US')

interface SignatureBoardProps {
  snapshot: AppSnapshot
  preview?: boolean
}

export default function SignatureBoard({
  snapshot,
  preview = false
}: SignatureBoardProps): React.JSX.Element {
  const { materials, bestMiningLocations, settings, dataStatus } = snapshot
  const selected = settings.selectedMaterialIds
    .map((id) => materials.find((material) => material.id === id))
    .filter((material): material is MiningMaterial => material !== undefined)
  const visibleMaterials = settings.spotlightMaterialId
    ? selected.filter((material) => material.id === settings.spotlightMaterialId)
    : selected

  const boardStyle = {
    '--overlay-opacity': settings.opacity,
    '--overlay-font-scale': settings.fontScale
  } as CSSProperties

  return (
    <section
      className={[
        'signature-board',
        settings.compact ? 'signature-board--compact' : '',
        preview ? 'signature-board--preview' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={boardStyle}
      aria-label="Mining signature overlay preview"
    >
      <header
        className={['signature-board__header', !preview ? 'signature-board__header--draggable' : '']
          .filter(Boolean)
          .join(' ')}
      >
        <div className="signature-board__identity">
          <span className="signal-mark" aria-hidden="true">
            <Crosshair size={16} strokeWidth={1.8} />
          </span>
          <div>
            <strong>Signature index</strong>
            <span>Mining scan reference</span>
          </div>
        </div>
        <div className="live-state">
          {!preview && <Move className="drag-indicator" size={12} aria-label="Drag overlay" />}
          <span className={`live-state__dot live-state__dot--${dataStatus.state}`} />
          <span>{settings.spotlightMaterialId ? 'Spotlight' : 'All targets'}</span>
          <span aria-hidden="true">·</span>
          <span>1–{settings.clusterMax} rocks</span>
        </div>
      </header>

      {visibleMaterials.length > 0 ? (
        <div className="signature-list">
          {visibleMaterials.map((material) => (
            <SignatureRow
              key={material.id}
              material={material}
              bestLocation={bestMiningLocations[material.id]}
              clusterMax={settings.clusterMax}
              compact={settings.compact}
            />
          ))}
        </div>
      ) : (
        <div className="signature-empty">
          <Crosshair size={24} strokeWidth={1.5} />
          <strong>No targets selected</strong>
          <span>Select up to four materials in Rockfall.</span>
        </div>
      )}
    </section>
  )
}

interface SignatureRowProps {
  material: MiningMaterial
  bestLocation?: BestMiningLocationState
  clusterMax: number
  compact: boolean
}

function SignatureRow({
  material,
  bestLocation,
  clusterMax,
  compact
}: SignatureRowProps): React.JSX.Element {
  const signatures = buildClusterSignatures(material.signature, clusterMax)
  const base = signatures[0]
  const clusters = signatures.slice(1)

  return (
    <article className="signature-row">
      <div className="signature-row__lead">
        <div className="signature-row__name">
          <strong>{material.name}</strong>
          {!compact && <span>{material.methods.join(' / ')}</span>}
        </div>
        <div className="base-signature">
          <span>Base</span>
          <strong>{numberFormatter.format(base.signature)}</strong>
        </div>
      </div>
      <BestSite state={bestLocation} />
      <div className="cluster-strip" aria-label={`${material.name} cluster signatures`}>
        {clusters.map((cluster) => (
          <div className="cluster-value" key={cluster.count}>
            <span>×{cluster.count}</span>
            <strong>{numberFormatter.format(cluster.signature)}</strong>
          </div>
        ))}
      </div>
    </article>
  )
}

function BestSite({ state }: { state?: BestMiningLocationState }): React.JSX.Element {
  const status = state?.status ?? 'loading'
  let site = 'Finding best site…'
  let probability = ''

  if (state?.status === 'ready') {
    site = formatMiningSiteName(state.location)
    probability = formatMiningProbability(state.location.highQualityProbability)
    if (state.source === 'cached') probability += ' · cached'
  } else if (state?.status === 'empty') {
    site = 'No 50%+ site reported'
  } else if (state?.status === 'error') {
    site = 'Site data unavailable'
  }

  return (
    <div
      className={`signature-row__site signature-row__site--${status}`}
      title={state?.message ?? 'Finding the best mining site'}
    >
      <MapPin aria-hidden="true" />
      <span className="signature-row__site-label">Best site</span>
      <strong>{site}</strong>
      {probability && <span className="signature-row__site-probability">{probability}</span>}
    </div>
  )
}
