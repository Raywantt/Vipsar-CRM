import '../pages/Dashboard.css'

const PRESETS = [
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
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
    <div className="dashboard-range">
      <div className="dashboard-range-presets">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={
              preset === p.value ? 'dashboard-range-btn dashboard-range-btn-active' : 'dashboard-range-btn'
            }
            onClick={() => onPresetChange(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="dashboard-range-custom">
          <label>
            From
            <input type="date" value={customStart} onChange={(e) => onCustomStartChange(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={customEnd} onChange={(e) => onCustomEndChange(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  )
}

export default DateRangeSelector
