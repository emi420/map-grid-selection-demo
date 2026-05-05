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
        <label>Grid Zoom Level: </label>
        <select
          value={gridZoom}
          onChange={(e) => setGridZoom(parseInt(e.target.value))}
        >
          <option value={17}>17 (max 25 tiles)</option>
          <option value={18}>18 (max 25 tiles)</option>
        </select>
        <div className="selection-counter">
          Selected: {selectedTiles.length} / {maxSelections}
        </div>
      </div>
      <div ref={mapContainer} className="map" />
    </div>
  );
}