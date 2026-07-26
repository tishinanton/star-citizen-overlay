import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { RotateCcw } from 'lucide-react'

import type { MiningMaterial } from '../../../shared/contracts'

const numberFormatter = new Intl.NumberFormat('en-US')

interface SignatureOverrideEditorProps {
  material: MiningMaterial
  signature: number
  isOverridden: boolean
  onApply: (signature: number) => void
  onCancel: () => void
  onReset: () => void
}

export default function SignatureOverrideEditor({
  material,
  signature,
  isOverridden,
  onApply,
  onCancel,
  onReset
}: SignatureOverrideEditorProps): React.JSX.Element {
  const descriptionId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(String(signature))
  const normalizedDraft = draft.trim()
  const parsedSignature = Number(normalizedDraft)
  const isValid =
    /^\d+$/.test(normalizedDraft) && Number.isSafeInteger(parsedSignature) && parsedSignature > 0

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (isValid) onApply(parsedSignature)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onCancel()
  }

  return (
    <form
      id={`signature-override-editor-${material.id}`}
      className="signature-override-editor"
      onSubmit={submit}
      onKeyDown={handleKeyDown}
    >
      <div className="signature-override-editor__heading">
        <strong>Correct signature</strong>
        <span>
          {material.name} · source {numberFormatter.format(material.signature)}
        </span>
      </div>

      <label className="signature-override-editor__field">
        <span>Manual value</span>
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          min="1"
          max={Number.MAX_SAFE_INTEGER}
          step="1"
          value={draft}
          aria-invalid={!isValid}
          aria-describedby={descriptionId}
          onChange={(event) => setDraft(event.target.value)}
        />
        <small id={descriptionId} className={!isValid ? 'is-error' : ''}>
          {isValid ? 'Cluster values update automatically.' : 'Enter a positive whole number.'}
        </small>
      </label>

      <div className="signature-override-editor__actions">
        {isOverridden && (
          <button
            className="signature-override-editor__button signature-override-editor__button--reset"
            type="button"
            aria-label="Reset to source signature"
            title="Reset to source signature"
            onClick={onReset}
          >
            <RotateCcw size={13} />
          </button>
        )}
        <button className="signature-override-editor__button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="signature-override-editor__button signature-override-editor__button--primary"
          type="submit"
          disabled={!isValid}
        >
          Apply
        </button>
      </div>
    </form>
  )
}
