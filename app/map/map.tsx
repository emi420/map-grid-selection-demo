import React, { useRef, useEffect, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';
import { osm } from './source.js';

// --------------------------------------------------------------
// Web Mercator tile helpers
// --------------------------------------------------------------
function tileToLng(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}

function tileToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) * 180 / Math.PI;
}

function latToTileY(lat, z) {
  const sinLat = Math.sin(lat * Math.PI / 180);
  const y = (1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2;
  return y * Math.pow(2, z);
}

function lonToTileX(lon, z) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}

function getTileBounds(x, y, z) {
  const west = tileToLng(x, z);
  const east = tileToLng(x + 1, z);
  const north = tileToLat(y, z);
  const south = tileToLat(y + 1, z);
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}

function getVisibleTileRange(bounds, z) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const minX = Math.floor(lonToTileX(sw.lng, z));
  const maxX = Math.floor(lonToTileX(ne.lng, z));
  const northY = latToTileY(ne.lat, z);
  const southY = latToTileY(sw.lat, z);
  const minY = Math.floor(Math.min(northY, southY));
  const maxY = Math.floor(Math.max(northY, southY));
  return { minX, maxX, minY, maxY };
}

function generateGridGeoJSON(bounds, z) {
  const { minX, maxX, minY, maxY } = getVisibleTileRange(bounds, z);
  const features = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const ring = getTileBounds(x, y, z);
      const featureId = `${z}|${x}|${y}`;
      features.push({
        type: 'Feature',
        id: featureId,                 // explicit top‑level ID
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { tileX: x, tileY: y, tileZ: z, id: featureId }
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

function areAdjacent(tile1, tile2) {
  const dx = Math.abs(tile1.x - tile2.x);
  const dy = Math.abs(tile1.y - tile2.y);
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

// --------------------------------------------------------------
// Main Component
// --------------------------------------------------------------
export default function Map() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [gridZoom, setGridZoom] = useState(17);
  const [selectedTiles, setSelectedTiles] = useState([]);
  const gridInitialized = useRef(false);
  const selectedTilesRef = useRef(selectedTiles);
  const maxSelections = gridZoom === 18 ? 20 : 10;

  useEffect(() => {
    selectedTilesRef.current = selectedTiles;
  }, [selectedTiles]);

  // Helper: build feature ID from tile coordinates
  const getTileId = (z, x, y) => `${z}|${x}|${y}`;

  // Sync feature states from React state to map
  const syncFeatureStates = useCallback(() => {
    if (!map.current || !gridInitialized.current) return;
    const source = map.current.getSource('grid-source');
    if (!source) {
      console.warn('syncFeatureStates: source not ready');
      return;
    }

    const currentSelected = selectedTilesRef.current;
    console.log('syncFeatureStates: applying selection', currentSelected);

    // Clear previous selection states
    if (syncFeatureStates.prevSelected) {
      syncFeatureStates.prevSelected.forEach(tile => {
        const id = getTileId(tile.z, tile.x, tile.y);
        map.current.setFeatureState({ source: 'grid-source', id }, { selected: false });
      });
    }

    // Apply new selection
    currentSelected.forEach(tile => {
      const id = getTileId(tile.z, tile.x, tile.y);
      map.current.setFeatureState({ source: 'grid-source', id }, { selected: true });
    });

    syncFeatureStates.prevSelected = [...currentSelected];
  }, []);

  // Update grid GeoJSON when map moves or zoom changes
  const updateGridData = useCallback(() => {
    if (!map.current || !gridInitialized.current) return;
    const bounds = map.current.getBounds();
    const geoJson = generateGridGeoJSON(bounds, gridZoom);
    const source = map.current.getSource('grid-source');
    if (source) {
      source.setData(geoJson);
      // After data is loaded, reapply selection states
      map.current.once('idle', () => {
        syncFeatureStates();
      });
    }
  }, [gridZoom, syncFeatureStates]);

  const updateGridDataRef = useRef(updateGridData);
  useEffect(() => {
    updateGridDataRef.current = updateGridData;
  }, [updateGridData]);

  // Click handler for grid cells
  const handleGridClick = useCallback((e) => {
    const feature = e.features[0];
    if (!feature) return;
    const { tileX, tileY, tileZ } = feature.properties;
    const clickedTile = { x: tileX, y: tileY, z: tileZ };
    const currentSelected = selectedTilesRef.current;
    const isSelected = currentSelected.some(
      t => t.x === clickedTile.x && t.y === clickedTile.y && t.z === clickedTile.z
    );

    if (isSelected) {
      setSelectedTiles(prev => prev.filter(
        t => !(t.x === clickedTile.x && t.y === clickedTile.y && t.z === clickedTile.z)
      ));
    } else {
      const adjacentOk = currentSelected.length === 0 ||
        currentSelected.some(t => areAdjacent(t, clickedTile));
      if (!adjacentOk) {
        alert('You can only select cells adjacent to the current selection.');
        return;
      }
      if (currentSelected.length >= maxSelections) {
        alert(`Maximum selection for zoom ${gridZoom} is ${maxSelections} tiles.`);
        return;
      }
      setSelectedTiles(prev => [...prev, clickedTile]);
    }
  }, [gridZoom, maxSelections]);

  const handleGridClickRef = useRef(handleGridClick);
  useEffect(() => {
    handleGridClickRef.current = handleGridClick;
  }, [handleGridClick]);

  // Setup map layers and events (called once after map loads)
  const setupGrid = useCallback(() => {
    if (!map.current) return;
    const mapObj = map.current;

    // Add source with promoteId so feature.id is used
    mapObj.addSource('grid-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      promoteId: 'id'
    });

    // Add fill layer (visible light gray by default, turns red/orange on state)
    mapObj.addLayer({
      id: 'grid-fill',
      type: 'fill',
      source: 'grid-source',
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          'rgba(255,0,0,.5)',
          ['boolean', ['feature-state', 'hover'], false],
          'rgba(255,0,0,.75)',
          'rgba(0,0,0,0)'        // light gray default so you can see the cells
        ],
        'fill-opacity': 0.7
      }
    });

    // Add line layer
    mapObj.addLayer({
      id: 'grid-line',
      type: 'line',
      source: 'grid-source',
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          'red',
          ['boolean', ['feature-state', 'hover'], false],
          'rgba(255,0,0,.75)',
          '#333333'
        ],
        'line-width': 1.5
      }
    });

    // Click event
    mapObj.on('click', 'grid-fill', (e) => {
      console.log('Click on grid-fill', e.features[0]?.properties);
      handleGridClickRef.current(e);
    });

    // Hover effect using feature.id (which is guaranteed by promoteId)
    let lastHoveredId = null;

    mapObj.on('mousemove', 'grid-fill', (e) => {
      if (!e.features || e.features.length === 0) {
        if (lastHoveredId) {
          mapObj.setFeatureState({ source: 'grid-source', id: lastHoveredId }, { hover: false });
          lastHoveredId = null;
        }
        return;
      }

      const feature = e.features[0];
      const featureId = feature.id;  // now safe because promoteId is set
      if (!featureId) return;

      if (lastHoveredId === featureId) return;

      if (lastHoveredId) {
        mapObj.setFeatureState({ source: 'grid-source', id: lastHoveredId }, { hover: false });
      }
      mapObj.setFeatureState({ source: 'grid-source', id: featureId }, { hover: true });
      lastHoveredId = featureId;
    });

    mapObj.on('mouseleave', 'grid-fill', () => {
      if (lastHoveredId) {
        mapObj.setFeatureState({ source: 'grid-source', id: lastHoveredId }, { hover: false });
        lastHoveredId = null;
      }
    });

    // Cursor feedback
    mapObj.on('mouseenter', 'grid-fill', () => {
      mapObj.getCanvas().style.cursor = 'pointer';
    });
    mapObj.on('mouseleave', 'grid-fill', () => {
      mapObj.getCanvas().style.cursor = '';
    });

    // Update grid when map moves
    mapObj.on('moveend', () => updateGridDataRef.current());

    gridInitialized.current = true;
    updateGridDataRef.current();
  }, []);

  // Initialize map only once
  useEffect(() => {
    if (map.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: osm,
      center: [139.753, 35.6844],
      zoom: 14
    });
    map.current.on('load', setupGrid);

    return () => {
      if (map.current) {
        if (gridInitialized.current) {
          if (map.current.getLayer('grid-fill')) map.current.removeLayer('grid-fill');
          if (map.current.getLayer('grid-line')) map.current.removeLayer('grid-line');
          if (map.current.getSource('grid-source')) map.current.removeSource('grid-source');
        }
        map.current.remove();
        map.current = null;
        gridInitialized.current = false;
      }
    };
  }, [setupGrid]);

  // When zoom changes, reset selection and refresh grid
  useEffect(() => {
    if (!gridInitialized.current) return;
    setSelectedTiles([]);
    updateGridDataRef.current();
  }, [gridZoom]);

  // Keep feature states in sync with selectedTiles
  useEffect(() => {
    if (gridInitialized.current) {
      syncFeatureStates();
    }
  }, [selectedTiles, syncFeatureStates]);

  return (
    <div className="map-wrap">
      <div className="grid-control">
        <label>Grid Zoom Level: </label>
        <select value={gridZoom} onChange={(e) => setGridZoom(parseInt(e.target.value))}>
          <option value={17}>17 (max 10 tiles)</option>
          <option value={18}>18 (max 20 tiles)</option>
        </select>
        <div className="selection-counter">
          Selected: {selectedTiles.length} / {maxSelections}
        </div>
      </div>
      <div ref={mapContainer} className="map" />
    </div>
  );
}