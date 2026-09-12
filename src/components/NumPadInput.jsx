import { useRef, useState } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'

// Digits laid out with 0 centered on the bottom row and the variant-specific
// key (decimal point, or nothing) beside it, backspace on the far side —
// the same corner a calculator/POS keypad puts it, so it reads as familiar
// rather than invented.
const DIGIT_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
]

// Mobile-only on-screen keypad for numeric fields (money, probability,
// targets, mobile numbers) — desktop renders the plain original <input>,
// see the isMobile branch below. The one addition on that branch is
// onWheel blurring the field: a focused type="number" input changes value
// on trackpad/mouse-wheel scroll by default, which reads as the field
// editing itself while the rep is just scrolling the page.
//
// The underlying <input> stays a real, focusable, screen-reader-visible
// control at every width; the only thing that changes on mobile is
// inputMode="none", the standard way to keep a field editable/selectable
// while suppressing the OS's own virtual keyboard (a hardware/bluetooth
// keyboard, autofill, or paste still reaches the field through the normal
// onChange prop — this component only ever ADDS the tap keypad, it never
// removes another way of getting a value in).
//
// A drop-in swap for a plain <input>: pressing a key calls the passed
// onChange with the same {target: {value}} shape a real typing event would,
// so every call site's existing state/validation (Number(x) at save time,
// etc.) needs no changes at all — only the JSX tag itself is swapped.
//
// variant: 'decimal' (money/target fields — adds a "." key) or 'integer'
// (probability, mobile numbers — digits + backspace only, no decimal).
//
// maxLength (optional) caps the value's length — passed through as the
// native HTML attribute for the desktop input and typed/hardware-keyboard
// entry, and enforced in pressDigit/pressPaste for the on-screen keypad's
// own key presses, since those write via a synthetic onChange the native
// attribute never sees. Mobile-number fields pass 10.
//
// A Paste button sits in the sheet's header rather than relying on the
// field's own long-press paste gesture — inputMode="none" makes that
// gesture unreliable on several mobile browsers. It reads the clipboard,
// strips everything but digits (plus one "." for the decimal variant), and
// commits the result — trimmed to maxLength when one is set.
function NumPadInput({
  value,
  onChange,
  variant = 'decimal',
  label,
  type = 'number',
  className = '',
  disabled = false,
  maxLength,
  ...rest
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [pasteNote, setPasteNote] = useState('')
  const inputRef = useRef(null)

  if (!isMobile) {
    return (
      <input
        type={type}
        className={`vip-input ${className}`.trim()}
        value={value}
        onChange={onChange}
        onWheel={(e) => e.currentTarget.blur()}
        disabled={disabled}
        maxLength={maxLength}
        {...rest}
      />
    )
  }

  function openPad() {
    if (!disabled) setOpen(true)
  }

  function closePad() {
    setOpen(false)
    inputRef.current?.blur()
  }

  // The input can lose focus for reasons our own Done/backdrop handlers
  // never see — most notably the device's own keyboard dismissing itself
  // (inputMode="none" isn't honored by every OS keyboard in practice), but
  // also tapping straight into another field. Any of those left the sheet
  // stuck open before, since nothing but our own explicit close call ever
  // toggled it. Closing on blur covers all of them generically.
  function handleBlur() {
    setOpen(false)
  }

  // Tapping a key must not steal focus from the input — if it did, the
  // blur above would close the sheet mid-keystroke (or unmount the very
  // button being pressed before its click fires). preventDefault on
  // pointerdown stops the browser's default focus-shift while leaving the
  // subsequent click untouched.
  function keepFocus(e) {
    e.preventDefault()
  }

  function commit(next) {
    setPasteNote('')
    onChange({ target: { value: next } })
  }

  function withinLimit(next) {
    return maxLength == null || next.length <= maxLength
  }

  function pressDigit(d) {
    const current = value ?? ''
    // Replaces a lone leading "0" instead of producing "05" — the one bit of
    // input-shaping a real keypad does that a plain text field wouldn't.
    const next = current === '0' && d !== '0' ? d : current + d
    if (!withinLimit(next)) return
    commit(next)
  }

  function pressDecimal() {
    const current = value ?? ''
    if (current.includes('.')) return
    const next = current === '' ? '0.' : `${current}.`
    if (!withinLimit(next)) return
    commit(next)
  }

  function pressBackspace() {
    commit((value ?? '').slice(0, -1))
  }

  // A paste button rather than relying on the field's own long-press paste
  // gesture — inputMode="none" suppresses the OS keyboard, and on several
  // mobile browsers that also makes the native paste/selection menu
  // unreliable on this field. Sanitizes to digits (decimal variant also
  // allows one '.') so a copied "+91 98765-43210" or "₹1,25,000" lands as
  // clean input rather than the raw punctuation.
  function sanitizePaste(text) {
    if (variant === 'decimal') {
      const cleaned = text.replace(/[^0-9.]/g, '')
      const firstDot = cleaned.indexOf('.')
      if (firstDot === -1) return cleaned
      return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
    }
    return text.replace(/\D/g, '')
  }

  async function pressPaste() {
    if (!navigator.clipboard?.readText) {
      setPasteNote('Long-press the field above and choose Paste.')
      return
    }
    try {
      const text = await navigator.clipboard.readText()
      const cleaned = sanitizePaste(text)
      if (!cleaned) {
        setPasteNote('Clipboard has no number to paste.')
        return
      }
      commit(maxLength != null ? cleaned.slice(0, maxLength) : cleaned)
    } catch {
      setPasteNote("Couldn't paste — check clipboard permission and try again.")
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        inputMode="none"
        className={`vip-input ${className}`.trim()}
        value={value}
        onChange={onChange}
        onFocus={openPad}
        onClick={openPad}
        onBlur={handleBlur}
        disabled={disabled}
        maxLength={maxLength}
        {...rest}
      />
      {open && (
        <>
          <div className="vip-numpad-backdrop" onClick={closePad} />
          <div className="vip-numpad-sheet" role="dialog" aria-label={label ? `${label} keypad` : 'Number keypad'}>
            <div className="vip-numpad-head">
              <div className="vip-numpad-head-text">
                {label && <span className="vip-numpad-label">{label}</span>}
                <span className={`vip-numpad-value ${value ? '' : 'vip-numpad-value-empty'}`}>
                  {value || rest.placeholder || '0'}
                </span>
              </div>
              <div className="vip-numpad-head-actions">
                <button type="button" className="vip-btn-link" onMouseDown={keepFocus} onClick={pressPaste}>
                  Paste
                </button>
                <button type="button" className="vip-btn-link" onClick={closePad}>
                  Done
                </button>
              </div>
            </div>
            {pasteNote && <p className="vip-form-note">{pasteNote}</p>}
            <div className="vip-numpad-grid">
              {DIGIT_ROWS.flatMap((row) =>
                row.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="vip-numpad-key"
                    onMouseDown={keepFocus}
                    onClick={() => pressDigit(d)}
                  >
                    {d}
                  </button>
                ))
              )}
              {variant === 'decimal' ? (
                <button
                  type="button"
                  className="vip-numpad-key vip-numpad-key-muted"
                  onMouseDown={keepFocus}
                  onClick={pressDecimal}
                >
                  .
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="vip-numpad-key"
                onMouseDown={keepFocus}
                onClick={() => pressDigit('0')}
              >
                0
              </button>
              <button
                type="button"
                className="vip-numpad-key vip-numpad-key-muted"
                onMouseDown={keepFocus}
                onClick={pressBackspace}
                aria-label="Backspace"
              >
                ⌫
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

export default NumPadInput
