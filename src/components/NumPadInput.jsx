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
function NumPadInput({
  value,
  onChange,
  variant = 'decimal',
  label,
  type = 'number',
  className = '',
  disabled = false,
  ...rest
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
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

  function commit(next) {
    onChange({ target: { value: next } })
  }

  function pressDigit(d) {
    const current = value ?? ''
    // Replaces a lone leading "0" instead of producing "05" — the one bit of
    // input-shaping a real keypad does that a plain text field wouldn't.
    commit(current === '0' && d !== '0' ? d : current + d)
  }

  function pressDecimal() {
    const current = value ?? ''
    if (current.includes('.')) return
    commit(current === '' ? '0.' : `${current}.`)
  }

  function pressBackspace() {
    commit((value ?? '').slice(0, -1))
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
        disabled={disabled}
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
              <button type="button" className="vip-btn-link" onClick={closePad}>
                Done
              </button>
            </div>
            <div className="vip-numpad-grid">
              {DIGIT_ROWS.flatMap((row) =>
                row.map((d) => (
                  <button key={d} type="button" className="vip-numpad-key" onClick={() => pressDigit(d)}>
                    {d}
                  </button>
                ))
              )}
              {variant === 'decimal' ? (
                <button type="button" className="vip-numpad-key vip-numpad-key-muted" onClick={pressDecimal}>
                  .
                </button>
              ) : (
                <span />
              )}
              <button type="button" className="vip-numpad-key" onClick={() => pressDigit('0')}>
                0
              </button>
              <button
                type="button"
                className="vip-numpad-key vip-numpad-key-muted"
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
