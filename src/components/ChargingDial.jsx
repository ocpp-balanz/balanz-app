import React from 'react';

import './ChargingDial.css';

const SIZE = 200;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A circular ring gauge for a single charger connector.
 *
 * Balanz does not expose battery state-of-charge (OCPP 1.6 / the balanz
 * model has no such field), so the ring shows the same metric balanz-ui's
 * own group-level Gauge uses: current offer as a fraction of the charger's
 * maximum current (conn_max), in Amps. That is a real, backend-sourced
 * number rather than an invented percentage.
 *
 * The ring only holds the headline number. The status pill and any longer
 * caption (e.g. "of 16 A max") render underneath instead of inside the
 * ring, so long OCPP status strings (e.g. "SuspendedEVSE") never have to
 * fight the curve of the ring for space.
 */
export default function ChargingDial({
  value,
  max,
  unit = 'A',
  tone = 'tone-neutral',
  statusLabel,
  subLabel,
}) {
  const safeMax = Number(max) > 0 ? Number(max) : 0;
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const fraction = safeMax > 0 ? Math.min(1, safeValue / safeMax) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - fraction);
  const displayValue = Number.isFinite(value) ? formatValue(value) : '--';

  return (
    <div className="charging-dial-wrap">
      <div className="charging-dial">
        <svg
          className="charging-dial-svg"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={statusLabel ? `${statusLabel}, ${displayValue} ${unit}` : `${displayValue} ${unit}`}
        >
          <circle className="charging-dial-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} />
          <circle
            className={`charging-dial-progress ${tone}`}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            strokeWidth={STROKE}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </svg>

        <div className="charging-dial-center">
          <span className="charging-dial-value">
            {displayValue}
            <span className="charging-dial-unit">{unit}</span>
          </span>
        </div>
      </div>
      {statusLabel ? <span className={`charging-dial-status ${tone}`}>{statusLabel}</span> : null}
      {subLabel ? <p className="charging-dial-caption">{subLabel}</p> : null}
    </div>
  );
}

function formatValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '--';
  }
  return Math.abs(number) >= 10 ? number.toFixed(0) : number.toFixed(1);
}
