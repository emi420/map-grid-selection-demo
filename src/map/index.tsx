// components/MapView.jsx
import { useRef } from "react";
import { useMapGrid } from "./utils/useMapGrid";
import "./map.css";         // your existing map styles

export default function MapView() {
  const mapContainer = useRef(null);
  const { gridZoom, setGridZoom, selectedTiles, maxSelections } =
    useMapGrid(mapContainer);

  return (
    <div className="map-wrap">
      <div className="grid-control">
        <label>Zoom level: </label>
        <select
          value={gridZoom}
          className="zoom-level-selection"
          onChange={(e) => setGridZoom(parseInt(e.target.value))}
        >
          <option value={17}>17</option>
          <option value={18}>18</option>
        </select>
        <div className="selection-counter">
          Selected: {selectedTiles.length} / {maxSelections}
        </div>
        <div>
          <button className="predict-button">Generate predictions</button>
        </div>
      </div>
      <div ref={mapContainer} className="map" />
    </div>
  );
}