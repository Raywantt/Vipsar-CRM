const PRESETS = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
]

function DateRangeSelector({
  preset,
  onPresetChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
}) {
  return (
    <div className="vip-stack-s">
      <div className="vip-seg vip-seg-outline">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={preset === p.value ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
            onClick={() => onPresetChange(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="vip-grid-2">
          <label className="vip-field">
            From
            <input
              className="vip-input"
              type="date"
              value={customStart}
              onChange={(e) => onCustomStartChange(e.target.value)}
            />
          </label>
          <label className="vip-field">
            To
            <input
              className="vip-input"
              type="date"
              value={customEnd}
              onChange={(e) => onCustomEndChange(e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  )
}

export default DateRangeSelector
