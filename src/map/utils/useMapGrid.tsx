// hooks/useMapGrid.js
import { useRef, useEffect, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { osm, oam } from "./source.js";
import {
  areAdjacent,
  generateGridGeoJSON,
  getFracTileCoords,
  getLngLatFromClientEvent,
} from "../utils/tileUtils";

export function useMapGrid(containerRef) {
  const map = useRef(null);
  const gridInitialized = useRef(false);
  const defaultSelectionSet = useRef(false);
  const [gridZoom, setGridZoom] = useState(17);

  const [selectionsByZoom, setSelectionsByZoom] = useState({
    17: [],
    18: [],
  });

  const selectedTiles = selectionsByZoom[gridZoom] || [];
  const selectedTilesRef = useRef(selectedTiles);
  useEffect(() => {
    selectedTilesRef.current = selectedTiles;
  }, [selectedTiles]);

  const gridZoomRef = useRef(gridZoom);
  useEffect(() => {
    gridZoomRef.current = gridZoom;
  }, [gridZoom]);

  const maxSelections = 25;

  const dragState = useRef({
    active: false,
    dragOccurred: false,
    startSelected: [],
    startTileFrac: null,
  });

  const getTileId = (z, x, y) => `${z}|${x}|${y}`;

  const syncFeatureStates = useCallback(() => {
    if (!map.current || !gridInitialized.current) return;
    const source = map.current.getSource("grid-source");
    if (!source) return;

    const currentSelected = selectedTilesRef.current;

    if (syncFeatureStates.prevSelected) {
      syncFeatureStates.prevSelected.forEach((tile) => {
        const id = getTileId(tile.z, tile.x, tile.y);
        map.current.setFeatureState(
          { source: "grid-source", id },
          { selected: false }
        );
      });
    }

    currentSelected.forEach((tile) => {
      const id = getTileId(tile.z, tile.x, tile.y);
      map.current.setFeatureState(
        { source: "grid-source", id },
        { selected: true }
      );
    });

    syncFeatureStates.prevSelected = [...currentSelected];
  }, []);

  const updateGridData = useCallback(() => {
    if (!map.current || !gridInitialized.current || map.current.getZoom() < 12)
      return;
    const bounds = map.current.getBounds();
    const geoJson = generateGridGeoJSON(bounds, gridZoomRef.current);
    const source = map.current.getSource("grid-source");
    if (source) {
      source.setData(geoJson);
      map.current.once("idle", () => {
        syncFeatureStates();
      });
    }
  }, [syncFeatureStates]);

  const handleGridClick = useCallback(
    (e) => {
      if (dragState.current.dragOccurred) {
        dragState.current.dragOccurred = false;
        return;
      }

      const feature = e.features[0];
      if (!feature) return;
      const { tileX, tileY, tileZ } = feature.properties;
      const clickedTile = { x: tileX, y: tileY, z: tileZ };
      const currentSelected = selectedTilesRef.current;
      const isSelected = currentSelected.some(
        (t) => t.x === clickedTile.x && t.y === clickedTile.y && t.z === clickedTile.z
      );

      if (isSelected) {
        setSelectionsByZoom((prev) => ({
          ...prev,
          [gridZoomRef.current]: prev[gridZoomRef.current].filter(
            (t) =>
              !(t.x === clickedTile.x && t.y === clickedTile.y && t.z === clickedTile.z)
          ),
        }));
      } else {
        const adjacentOk =
          currentSelected.length === 0 ||
          currentSelected.some((t) => areAdjacent(t, clickedTile));
        if (!adjacentOk) {
          alert("You can only select cells adjacent to the current selection.");
          return;
        }
        if (currentSelected.length >= maxSelections) {
          alert(`Maximum selection for zoom ${gridZoomRef.current} is ${maxSelections} tiles.`);
          return;
        }
        setSelectionsByZoom((prev) => ({
          ...prev,
          [gridZoomRef.current]: [...prev[gridZoomRef.current], clickedTile],
        }));
      }
    },
    [maxSelections]
  );

  const startDrag = useCallback(
    (e, clickedFeatureProps) => {
      const { tileX, tileY, tileZ } = clickedFeatureProps;
      const isSelected = selectedTilesRef.current.some(
        (t) => t.x === tileX && t.y === tileY && t.z === tileZ
      );
      if (!isSelected) return;

      e.preventDefault();
      map.current.dragPan.disable();

      const startMapPoint = e.lngLat;
      const startTileFrac = getFracTileCoords(startMapPoint, gridZoomRef.current);

      dragState.current.active = true;
      dragState.current.dragOccurred = false;
      dragState.current.startSelected = [...selectedTilesRef.current];
      dragState.current.startTileFrac = startTileFrac;

      const onMouseMove = (moveEvent) => {
        if (!dragState.current.active) return;

        const currentMapPoint = getLngLatFromClientEvent(
          map.current,
          moveEvent.clientX,
          moveEvent.clientY
        );
        const currentTileFrac = getFracTileCoords(currentMapPoint, gridZoomRef.current);
        const start = dragState.current.startTileFrac;
        const deltaX = Math.round(currentTileFrac.x - start.x);
        const deltaY = Math.round(currentTileFrac.y - start.y);

        if (deltaX !== 0 || deltaY !== 0) {
          dragState.current.dragOccurred = true;
        }

        const movedSelection = dragState.current.startSelected.map((tile) => ({
          ...tile,
          x: tile.x + deltaX,
          y: tile.y + deltaY,
        }));

        const uniqueMap = new Map();
        movedSelection.forEach((tile) => {
          const key = `${tile.z}|${tile.x}|${tile.y}`;
          if (!uniqueMap.has(key)) uniqueMap.set(key, tile);
        });
        const newSelection = Array.from(uniqueMap.values());

        setSelectionsByZoom((prev) => ({
          ...prev,
          [gridZoomRef.current]: newSelection,
        }));
      };

      const onMouseUp = () => {
        if (!dragState.current.active) return;
        dragState.current.active = false;
        map.current.dragPan.enable();

        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    []
  );

  const setupGrid = useCallback(() => {
    if (!map.current) return;
    const mapObj = map.current;

    mapObj.addSource("grid-source", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      promoteId: "id",
    });

    mapObj.addLayer({
      id: "grid-fill",
      type: "fill",
      source: "grid-source",
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "rgba(255,0,0,.2)",
          ["boolean", ["feature-state", "hover"], false],
          "rgba(255,0,0,.75)",
          "rgba(0,0,0,0)",
        ],
        "fill-opacity": 0.7,
      },
    });

    mapObj.addLayer({
      id: "grid-line",
      type: "line",
      source: "grid-source",
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "red",
          ["boolean", ["feature-state", "hover"], false],
          "rgba(255,0,0,.5)",
          "rgba(255,255,255,.25)",
        ],
        "line-width": 1,
      },
    });

    mapObj.on("click", "grid-fill", (e) => handleGridClick(e));
    mapObj.on("mousedown", "grid-fill", (e) => {
      if (!e.features || e.features.length === 0) return;
      const feature = e.features[0];
      const { tileX, tileY, tileZ } = feature.properties;
      startDrag(e, { tileX, tileY, tileZ });
    });

    let lastHoveredId = null;
    mapObj.on("mousemove", "grid-fill", (e) => {
      // Reset hover state for previous tile
      if (lastHoveredId) {
        mapObj.setFeatureState(
          { source: "grid-source", id: lastHoveredId },
          { hover: false }
        );
        lastHoveredId = null;
      }

      if (!e.features || e.features.length === 0) {
        // No tile under cursor: reset cursor to default
        mapObj.getCanvas().style.cursor = "";
        return;
      }

      const feature = e.features[0];
      const featureId = feature.id;
      if (!featureId) return;

      // Set hover state for the new tile
      mapObj.setFeatureState(
        { source: "grid-source", id: featureId },
        { hover: true }
      );
      lastHoveredId = featureId;

      // Determine cursor style based on whether tile is selected
      const { tileX, tileY, tileZ } = feature.properties;
      const isSelected = selectedTilesRef.current.some(
        (t) => t.x === tileX && t.y === tileY && t.z === tileZ
      );
      mapObj.getCanvas().style.cursor = isSelected ? "move" : "pointer";
    });

    mapObj.on("mouseleave", "grid-fill", () => {
      if (lastHoveredId) {
        mapObj.setFeatureState(
          { source: "grid-source", id: lastHoveredId },
          { hover: false }
        );
        lastHoveredId = null;
      }
      mapObj.getCanvas().style.cursor = "";
    });

    mapObj.on("moveend", () => updateGridData());

    gridInitialized.current = true;
    updateGridData();
  }, [handleGridClick, startDrag, updateGridData]);

  // Set default 5x5 selections for both zoom 17 and 18
  const setDefaultSelections = useCallback(() => {
    if (!map.current || defaultSelectionSet.current) return;

    const center = map.current.getCenter();

    const generateDefaultBlock = (zoom) => {
      const tileCoords = getFracTileCoords(center, zoom);
      const centerX = Math.floor(tileCoords.x);
      const centerY = Math.floor(tileCoords.y);
      const radius = 2; // 5x5
      const tiles = [];
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          tiles.push({ x: centerX + dx, y: centerY + dy, z: zoom });
        }
      }
      return tiles.slice(0, maxSelections);
    };

    const defaultZoom17 = generateDefaultBlock(17);
    const defaultZoom18 = generateDefaultBlock(18);

    setSelectionsByZoom((prev) => ({
      17: defaultZoom17,
      18: defaultZoom18,
    }));

    defaultSelectionSet.current = true;
  }, [maxSelections]);

  // Initialize map (once)
  useEffect(() => {
    if (map.current || !containerRef.current) return;

    map.current = new maplibregl.Map({
      container: containerRef.current,
      style: osm,
      center: [-13.2591, 8.4837],
      zoom: 14,
    });

    map.current.on("load", () => {
      map.current.addSource("oam-source", oam);
      map.current.addLayer({
        id: "oam-layer",
        type: "raster",
        source: "oam-source",
      });

      setupGrid();
      setDefaultSelections();
    });

    return () => {
      if (map.current) {
        if (gridInitialized.current) {
          if (map.current.getLayer("grid-fill")) map.current.removeLayer("grid-fill");
          if (map.current.getLayer("grid-line")) map.current.removeLayer("grid-line");
          if (map.current.getLayer("oam-layer")) map.current.removeLayer("oam-layer");
          if (map.current.getSource("grid-source")) map.current.removeSource("grid-source");
          if (map.current.getSource("oam-source")) map.current.removeSource("oam-source");
        }
        map.current.remove();
        map.current = null;
        gridInitialized.current = false;
      }
    };
  }, [containerRef, setupGrid, setDefaultSelections]);

  // When gridZoom changes, refresh grid data
  useEffect(() => {
    if (!gridInitialized.current) return;
    updateGridData();
  }, [gridZoom, updateGridData]);

  // Keep feature states in sync
  useEffect(() => {
    if (gridInitialized.current) {
      syncFeatureStates();
    }
  }, [selectedTiles, syncFeatureStates]);

  return {
    gridZoom,
    setGridZoom,
    selectedTiles,
    maxSelections,
  };
}