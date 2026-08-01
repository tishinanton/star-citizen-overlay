import type { CSSProperties } from 'react'
import { Crosshair, MapPin, Move, Star } from 'lucide-react'

import type {
  AppSnapshot,
  BestMiningLocationState,
  MiningMaterial,
  SignatureOverrides
} from '../../../shared/contracts'
import { buildClusterSignatures, resolveMaterialSignature } from '../../../shared/signatures'
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
  const hasVisibleOverrides = visibleMaterials.some(
    (material) => settings.signatureOverrides[material.id] !== undefined
  )

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
            <span>Mining scan reference{hasVisibleOverrides ? ' · * manual' : ''}</span>
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
              favoriteLocationId={settings.favoriteMiningLocationIds[material.id]}
              clusterMax={settings.clusterMax}
              compact={settings.compact}
              signatureOverrides={settings.signatureOverrides}
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
  favoriteLocationId?: string
  clusterMax: number
  compact: boolean
  signatureOverrides: SignatureOverrides
}

function SignatureRow({
  material,
  bestLocation,
  favoriteLocationId,
  clusterMax,
  compact,
  signatureOverrides
}: SignatureRowProps): React.JSX.Element {
  const resolvedSignature = resolveMaterialSignature(material, signatureOverrides)
  const signatures = buildClusterSignatures(resolvedSignature.signature, clusterMax)
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
          <strong
            title={
              resolvedSignature.isOverridden
                ? `Manual override; source value ${numberFormatter.format(material.signature)}`
                : undefined
            }
          >
            {numberFormatter.format(base.signature)}
            {resolvedSignature.isOverridden && (
              <>
                <span className="signature-override-marker" aria-hidden="true">
                  *
                </span>
                <span className="sr-only">
                  {' '}
                  manual override from {numberFormatter.format(material.signature)}
                </span>
              </>
            )}
          </strong>
        </div>
      </div>
      <BestSite
        state={bestLocation}
        isFavorite={
          bestLocation?.status === 'ready' && bestLocation.location.id === favoriteLocationId
        }
      />
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

function BestSite({
  state,
  isFavorite
}: {
  state?: BestMiningLocationState
  isFavorite: boolean
}): React.JSX.Element {
  const status = state?.status ?? 'loading'
  let site = 'Finding best site…'
  let probability = ''

  if (state?.status === 'ready') {
    site = formatMiningSiteName(state.location)
    probability =
      state.location.highQualityProbability === null
        ? '50%+: unavailable'
        : `50%+: ${formatMiningProbability(state.location.highQualityProbability)}`
    if (state.source === 'cached') probability += ' · cached'
  } else if (state?.status === 'empty') {
    site = 'No mining site reported'
  } else if (state?.status === 'error') {
    site = 'Site data unavailable'
  }

  return (
    <div
      className={[
        'signature-row__site',
        `signature-row__site--${status}`,
        isFavorite ? 'signature-row__site--favorite' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      title={state?.message ?? 'Finding the best mining site'}
    >
      {isFavorite ? <Star aria-hidden="true" fill="currentColor" /> : <MapPin aria-hidden="true" />}
      <span className="signature-row__site-label">
        {isFavorite ? 'Favorite site' : 'Best site'}
      </span>
      <strong>{site}</strong>
      {probability && <span className="signature-row__site-probability">{probability}</span>}
    </div>
  )
}
