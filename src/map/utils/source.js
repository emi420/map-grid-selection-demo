export const osm = {
  "version": 8,
	"sources": {
    "osm": {
			"type": "raster",
			"tiles": ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
			"tileSize": 256,
      "attribution": "&copy; OpenStreetMap Contributors",
      "maxzoom": 19
    }
  },
  "layers": [
    {
      "id": "osm",
      "type": "raster",
      "source": "osm" // This must match the source key above
    }
  ]
};


export const oam = {
      type: "raster",
      tiles: ["/oam-tiles/690585b76415e43597ffd7ea/0/690585b76415e43597ffd7eb/{z}/{x}/{y}"],
      tileSize: 256,
      attribution: "&copy; OpenAerialMap contributors",

};
