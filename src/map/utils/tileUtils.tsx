// utils/tileUtils.js

export function tileToLng(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}

export function tileToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) * (180 / Math.PI);
}

export function latToTileY(lat, z) {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2;
  return y * Math.pow(2, z);
}

export function lonToTileX(lon, z) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}

export function getTileBounds(x, y, z) {
  const west = tileToLng(x, z);
  const east = tileToLng(x + 1, z);
  const north = tileToLat(y, z);
  const south = tileToLat(y + 1, z);
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

export function getVisibleTileRange(bounds, z) {
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

export function generateGridGeoJSON(bounds, z) {
  const { minX, maxX, minY, maxY } = getVisibleTileRange(bounds, z);
  const features = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const ring = getTileBounds(x, y, z);
      const featureId = `${z}|${x}|${y}`;
      features.push({
        type: "Feature",
        id: featureId,
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { tileX: x, tileY: y, tileZ: z, id: featureId },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export function areAdjacent(tile1, tile2) {
  const dx = Math.abs(tile1.x - tile2.x);
  const dy = Math.abs(tile1.y - tile2.y);
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

export function getLngLatFromClientEvent(map, clientX, clientY) {
  const rect = map.getCanvas().getBoundingClientRect();
  const pixelX = clientX - rect.left;
  const pixelY = clientY - rect.top;
  return map.unproject([pixelX, pixelY]);
}

export function getFracTileCoords(lngLat, z) {
  const x = lonToTileX(lngLat.lng, z);
  const y = latToTileY(lngLat.lat, z);
  return { x, y };
}