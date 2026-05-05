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
  const [gridZoom, setGridZoom] = useState(17);
  const [selectedTiles, setSelectedTiles] = useState([]);
  const selectedTilesRef = useRef(selectedTiles);

  // 👇 NEW: keep gridZoom in a ref so event handlers always see the latest value
  const gridZoomRef = useRef(gridZoom);
  useEffect(() => {
    gridZoomRef.current = gridZoom;
  }, [gridZoom]);

  const maxSelections = gridZoom === 18 ? 50 : 25;

  // drag state
  const dragState = useRef({
    active: false,
    dragOccurred: false,
    startSelected: [],
    startTileFrac: null,
  });

  useEffect(() => {
    selectedTilesRef.current = selectedTiles;
  }, [selectedTiles]);

  const getTileId = (z, x, y) => `${z}|${x}|${y}`;

  // Sync feature states (selected/hover) from React state to the map
  const syncFeatureStates = useCallback(() => {
    if (!map.current || !gridInitialized.current) return;
    const source = map.current.getSource("grid-source");
    if (!source) return;

    const currentSelected = selectedTilesRef.current;

    // clear previous selection states (stored on the function)
    if (syncFeatureStates.prevSelected) {
      syncFeatureStates.prevSelected.forEach((tile) => {
        const id = getTileId(tile.z, tile.x, tile.y);
        map.current.setFeatureState(
          { source: "grid-source", id },
          { selected: false }
        );
      });
    }

    // apply new selection
    currentSelected.forEach((tile) => {
      const id = getTileId(tile.z, tile.x, tile.y);
      map.current.setFeatureState(
        { source: "grid-source", id },
        { selected: true }
      );
    });

    syncFeatureStates.prevSelected = [...currentSelected];
  }, []);

  // Update grid GeoJSON when map moves or zoom changes
  const updateGridData = useCallback(() => {
    if (!map.current || !gridInitialized.current || map.current.getZoom() < 12)
      return;
    const bounds = map.current.getBounds();
    const geoJson = generateGridGeoJSON(bounds, gridZoomRef.current); // use ref
    const source = map.current.getSource("grid-source");
    if (source) {
      source.setData(geoJson);
      map.current.once("idle", () => {
        syncFeatureStates();
      });
    }
  }, [syncFeatureStates]); // gridZoomRef is stable, no need to re-run

  // Click handler (toggle selection) – only if drag did not occur
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

      const currentMaxSelections = gridZoomRef.current === 18 ? 50 : 25;

      if (isSelected) {
        setSelectedTiles((prev) =>
          prev.filter(
            (t) =>
              !(t.x === clickedTile.x && t.y === clickedTile.y && t.z === clickedTile.z)
          )
        );
      } else {
        const adjacentOk =
          currentSelected.length === 0 ||
          currentSelected.some((t) => areAdjacent(t, clickedTile));
        if (!adjacentOk) {
          alert("You can only select cells adjacent to the current selection.");
          return;
        }
        if (currentSelected.length >= currentMaxSelections) {
          alert(`Maximum selection for zoom ${gridZoomRef.current} is ${currentMaxSelections} tiles.`);
          return;
        }
        setSelectedTiles((prev) => [...prev, clickedTile]);
      }
    },
    [] // no dependency on gridZoom anymore
  );

  // Drag start logic
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

        // remove duplicates
        const uniqueMap = new Map();
        movedSelection.forEach((tile) => {
          const key = `${tile.z}|${tile.x}|${tile.y}`;
          if (!uniqueMap.has(key)) uniqueMap.set(key, tile);
        });
        setSelectedTiles(Array.from(uniqueMap.values()));
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
    [] // no dependency on gridZoom – uses ref
  );

  // Setup map layers and events (called once after map loads)
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
          "#333333",
        ],
        "line-width": 1.5,
      },
    });

    mapObj.on("click", "grid-fill", (e) => handleGridClick(e));
    mapObj.on("mousedown", "grid-fill", (e) => {
      if (!e.features || e.features.length === 0) return;
      const feature = e.features[0];
      const { tileX, tileY, tileZ } = feature.properties;
      startDrag(e, { tileX, tileY, tileZ });
    });

    // hover effect
    let lastHoveredId = null;
    mapObj.on("mousemove", "grid-fill", (e) => {
      if (!e.features || e.features.length === 0) {
        if (lastHoveredId) {
          mapObj.setFeatureState(
            { source: "grid-source", id: lastHoveredId },
            { hover: false }
          );
          lastHoveredId = null;
        }
        return;
      }
      const feature = e.features[0];
      const featureId = feature.id;
      if (!featureId) return;
      if (lastHoveredId === featureId) return;
      if (lastHoveredId) {
        mapObj.setFeatureState(
          { source: "grid-source", id: lastHoveredId },
          { hover: false }
        );
      }
      mapObj.setFeatureState(
        { source: "grid-source", id: featureId },
        { hover: true }
      );
      lastHoveredId = featureId;
    });

    mapObj.on("mouseleave", "grid-fill", () => {
      if (lastHoveredId) {
        mapObj.setFeatureState(
          { source: "grid-source", id: lastHoveredId },
          { hover: false }
        );
        lastHoveredId = null;
      }
    });

    mapObj.on("mouseenter", "grid-fill", () => {
      mapObj.getCanvas().style.cursor = "pointer";
    });
    mapObj.on("mouseleave", "grid-fill", () => {
      mapObj.getCanvas().style.cursor = "";
    });

    mapObj.on("moveend", () => updateGridData());

    gridInitialized.current = true;
    updateGridData();
  }, [handleGridClick, startDrag, updateGridData]);

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
      // 1. Add OpenAerialMap source
      map.current.addSource("oam-source", oam);

      // 2. Add OpenAerialMap layer above OSM but below future grid layers
      map.current.addLayer({
        id: "oam-layer",
        type: "raster",
        source: "oam-source",
      });

      // 3. Now set up the grid (which adds fill and line layers on top)
      setupGrid();
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
  }, [containerRef, setupGrid]);

  // When gridZoom changes, reset selection and refresh grid
  useEffect(() => {
    if (!gridInitialized.current) return;
    setSelectedTiles([]);
    updateGridData();
  }, [gridZoom, updateGridData]);

  // Keep feature states in sync with selectedTiles
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