import { useState, type FormEvent } from 'react'
import {
  KeyRound,
  Link2,
  Radio,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Wifi,
  WifiOff,
  X
} from 'lucide-react'

import {
  MAX_LAN_CONTROL_PORT,
  MAX_LAN_PAIRED_CLIENTS,
  MIN_LAN_CONTROL_PORT,
  type LanControlConfig,
  type LanControlState,
  type LanPairingSession
} from '../../../shared/lan-control'

interface LanControlSettingsProps {
  config: LanControlConfig
  state: LanControlState
  onConfigure: (config: LanControlConfig) => Promise<void>
  onBeginPairing: () => Promise<LanPairingSession | null>
  onCancelPairing: () => Promise<void>
  onRevokeClient: (clientId: string) => Promise<void>
  onResetIdentity: () => Promise<void>
}

export default function LanControlSettings({
  config,
  state,
  onConfigure,
  onBeginPairing,
  onCancelPairing,
  onRevokeClient,
  onResetIdentity
}: LanControlSettingsProps): React.JSX.Element {
  const [portDraft, setPortDraft] = useState(String(config.port))
  const [pairing, setPairing] = useState<LanPairingSession | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const parsedPort = Number(portDraft)
  const portValid =
    Number.isInteger(parsedPort) &&
    parsedPort >= MIN_LAN_CONTROL_PORT &&
    parsedPort <= MAX_LAN_CONTROL_PORT
  const listenerReady = ['listening', 'pairing', 'degraded'].includes(state.status)
  const pairingOpen = state.pairingExpiresAt !== null
  const activePairing = pairingOpen ? pairing : null

  const run = async (name: string, action: () => Promise<void>): Promise<void> => {
    setBusyAction(name)
    try {
      await action()
    } finally {
      setBusyAction(null)
    }
  }

  const toggleEnabled = (): void => {
    void run('toggle', () =>
      onConfigure({
        enabled: !config.enabled,
        port: config.port
      })
    )
  }

  const savePort = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!portValid || parsedPort === config.port) return
    void run('port', () => onConfigure({ enabled: false, port: parsedPort }))
  }

  const beginPairing = (): void => {
    setBusyAction('pair')
    void onBeginPairing()
      .then((session) => {
        if (session) setPairing(session)
      })
      .finally(() => setBusyAction(null))
  }

  const cancelPairing = (): void => {
    setPairing(null)
    void run('cancel-pair', onCancelPairing)
  }

  return (
    <section
      className="settings-section"
      id="settings-phone-control"
      aria-labelledby="lan-control-title"
    >
      <div className="settings-section__heading">
        <Wifi size={18} aria-hidden="true" />
        <div>
          <h2 id="lan-control-title">Phone control</h2>
          <p>Pair Android on this network to control the live mining overlay.</p>
        </div>
      </div>

      <div className="lan-settings" aria-busy={busyAction !== null}>
        <div className="lan-settings__header">
          <div>
            <span className="setting-label">Secure local listener</span>
            <span className="setting-help" role="status" aria-live="polite">
              {state.message}
            </span>
          </div>
          <LanStatus status={state.status} />
        </div>

        <div className="lan-enable-row">
          <div>
            <strong>{config.enabled ? 'Phone control enabled' : 'Phone control disabled'}</strong>
            <span>
              {config.enabled
                ? 'Rockfall accepts paired devices only from private local addresses.'
                : 'No network listener or discovery service runs until you enable it.'}
            </span>
          </div>
          <button
            className={`lan-power-button ${config.enabled ? 'is-enabled' : ''}`}
            type="button"
            aria-pressed={config.enabled}
            disabled={busyAction !== null}
            onClick={toggleEnabled}
          >
            {config.enabled ? <WifiOff size={15} /> : <Wifi size={15} />}
            {config.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>

        <form className="lan-port-form" onSubmit={savePort}>
          <div>
            <label htmlFor="lan-control-port">Listener port</label>
            <span>Change the port only while phone control is disabled.</span>
          </div>
          <div className="inline-field">
            <input
              id="lan-control-port"
              type="number"
              inputMode="numeric"
              min={MIN_LAN_CONTROL_PORT}
              max={MAX_LAN_CONTROL_PORT}
              value={portDraft}
              disabled={config.enabled || busyAction !== null}
              aria-invalid={!portValid}
              onChange={(event) => setPortDraft(event.target.value)}
            />
            <button
              type="submit"
              disabled={
                config.enabled || busyAction !== null || !portValid || parsedPort === config.port
              }
            >
              Apply
            </button>
          </div>
          {!portValid && (
            <span className="lan-field-error" role="alert">
              Enter a port from {MIN_LAN_CONTROL_PORT.toLocaleString()} to{' '}
              {MAX_LAN_CONTROL_PORT.toLocaleString()}.
            </span>
          )}
        </form>

        {state.status === 'error' && (
          <div className="cloud-notice cloud-notice--danger" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>
              {config.enabled
                ? 'Disable phone control, correct the port or protected-storage problem, then enable it again.'
                : 'Reset the pairing identity if its protected certificate can no longer be loaded.'}
            </span>
          </div>
        )}

        {config.enabled && (
          <>
            <div className="lan-connection-panel">
              <div className="lan-connection-panel__heading">
                <Link2 size={16} aria-hidden="true" />
                <div>
                  <strong>Direct connection</strong>
                  <span>Use one of these addresses if Android cannot discover Rockfall.</span>
                </div>
              </div>
              {state.endpoints.length > 0 ? (
                <ul className="lan-endpoint-list">
                  {state.endpoints.map((endpoint) => (
                    <li key={endpoint}>
                      <code>{endpoint}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lan-empty-state">
                  {state.status === 'starting'
                    ? 'Waiting for the secure listener...'
                    : 'No private IPv4 address is available. Check the Windows network profile.'}
                </p>
              )}
              <p className="lan-firewall-note">
                <ShieldCheck size={15} aria-hidden="true" />
                Allow Rockfall only on Windows Private networks if the firewall asks.
              </p>
            </div>

            {state.verificationCode && (
              <div className="lan-certificate-row">
                <ShieldCheck size={16} aria-hidden="true" />
                <div>
                  <span>Certificate comparison code</span>
                  <strong>{state.verificationCode}</strong>
                  <code>{state.tlsSpkiSha256}</code>
                  <small>Confirm this exact code on Android before entering a pairing code.</small>
                </div>
              </div>
            )}

            <div className="lan-pairing-panel">
              <div className="lan-pairing-panel__heading">
                <div>
                  <KeyRound size={16} aria-hidden="true" />
                  <div>
                    <strong>Pair a phone</strong>
                    <span>One code pairs one Android device and expires after five minutes.</span>
                  </div>
                </div>
                {pairingOpen ? (
                  <button
                    className="cloud-actions__secondary"
                    type="button"
                    disabled={busyAction !== null}
                    onClick={cancelPairing}
                  >
                    <X size={14} aria-hidden="true" />
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!listenerReady || busyAction !== null}
                    onClick={beginPairing}
                  >
                    <Radio size={14} aria-hidden="true" />
                    Pair device
                  </button>
                )}
              </div>

              {activePairing ? (
                <div className="lan-pairing-code" role="status" aria-live="polite">
                  <span>Enter on Android</span>
                  <strong>{activePairing.code}</strong>
                  <small>Expires {formatTime(activePairing.expiresAt)}</small>
                </div>
              ) : pairingOpen ? (
                <p className="lan-empty-state" role="status">
                  A pairing code is already active. Cancel it and start a new code if it is no
                  longer visible.
                </p>
              ) : (
                <p className="lan-empty-state">
                  Compare the certificate code first. Pairing never uses your Discord account.
                </p>
              )}
            </div>
          </>
        )}

        {(state.serverId || state.pairedClients.length > 0 || state.status === 'error') && (
          <>
            <div className="lan-client-panel">
              <div className="lan-client-panel__heading">
                <div>
                  <Smartphone size={16} aria-hidden="true" />
                  <div>
                    <strong>Paired devices</strong>
                    <span>Each phone has an independent credential you can revoke.</span>
                  </div>
                </div>
                <span>
                  {state.pairedClients.length} / {MAX_LAN_PAIRED_CLIENTS}
                </span>
              </div>

              {state.pairedClients.length > 0 ? (
                <ul className="lan-client-list">
                  {state.pairedClients.map((client) => (
                    <li key={client.id}>
                      <div>
                        <strong>{client.name}</strong>
                        <span>
                          {client.appVersion ? `Android ${client.appVersion}` : 'Android'} · Paired{' '}
                          {formatDate(client.pairedAt)}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() =>
                          void run(`revoke-${client.id}`, () => onRevokeClient(client.id))
                        }
                      >
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lan-empty-state lan-empty-state--clients">
                  No phones are paired. Start pairing when Android is on the same network.
                </p>
              )}
            </div>

            <div className="lan-reset-row">
              <div>
                <strong>Reset pairing identity</strong>
                <span>Use only if the certificate or a device credential may be compromised.</span>
              </div>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void run('reset', onResetIdentity)}
              >
                <RefreshCw size={14} aria-hidden="true" />
                Reset
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function LanStatus({ status }: { status: LanControlState['status'] }): React.JSX.Element {
  const label =
    status === 'disabled'
      ? 'Disabled'
      : status === 'starting'
        ? 'Starting'
        : status === 'listening'
          ? 'Ready'
          : status === 'pairing'
            ? 'Pairing'
            : status === 'degraded'
              ? 'Manual only'
              : 'Listener error'
  return (
    <span className={`cloud-status lan-status--${status}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  )
}

function formatTime(timestamp: string): string {
  const value = new Date(timestamp)
  return Number.isFinite(value.getTime())
    ? new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(value)
    : 'soon'
}

function formatDate(timestamp: string): string {
  const value = new Date(timestamp)
  return Number.isFinite(value.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value)
    : 'previously'
}
