import React, { useRef, useState } from 'react';

import ChargingHistoryChart from './ChargingHistoryChart';

/**
 * The charging graph in a modal - backdrop, header and zoom controls.
 *
 * `ChargingHistoryChart` was always shared, but the chrome around it wasn't,
 * so a second caller (the historic sessions list) silently ended up without
 * the "Reset zoom" affordance. Wrapping the whole thing means every caller
 * gets identical behaviour for free.
 *
 * The reset button lives here rather than inside the chart on purpose: this
 * header is a fixed-size row, so the button appearing and disappearing with
 * the zoom state doesn't reflow the chart (or resize the modal) underneath
 * the pointer mid-gesture.
 */
export default function ChargingGraphModal({
  kicker,
  title = 'Charging graph',
  history,
  height = 260,
  onClose,
}) {
  const chartRef = useRef(null);
  const [zoomed, setZoomed] = useState(false);

  return (
    <>
      <button type="button" className="menu-backdrop is-open" aria-label="Close graph" onClick={onClose} />
      <div className="modal-panel is-wide panel">
        <div className="modal-panel-header">
          <div>
            {kicker ? <p className="section-kicker">{kicker}</p> : null}
            <h3>{title}</h3>
          </div>
          <div className="modal-header-actions">
            {zoomed ? (
              <button className="ghost-button" type="button" onClick={() => chartRef.current?.resetZoom()}>
                Reset zoom
              </button>
            ) : null}
            <button className="ghost-button" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <ChargingHistoryChart ref={chartRef} history={history} height={height} onZoomChange={setZoomed} />
      </div>
    </>
  );
}
