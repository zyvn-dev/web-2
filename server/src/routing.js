import { haversineDistance, bearing, pointInPolygon, pathIntersectsZone, distanceAlongPath } from './geo.js';

const GRID_STEP = 0.3;

export function computeRoute(startLat, startLng, destLat, destLng, navigableWater, restrictedZones) {
  const start = [startLat, startLng];
  const dest = [destLat, destLng];

  const directPath = [start, dest];
  let blocked = false;
  for (const zone of restrictedZones) {
    if (pathIntersectsZone(directPath, zone.polygon)) { blocked = true; break; }
  }
  if (!blocked && pointInPolygon(destLat, destLng, navigableWater)) {
    return directPath;
  }

  const grid = buildGrid(navigableWater, restrictedZones);
  grid.push({ pos: start, neighbors: [] });
  grid.push({ pos: dest, neighbors: [] });

  const startIdx = grid.length - 2;
  const destIdx = grid.length - 1;

  for (let i = 0; i < grid.length; i++) {
    for (let j = i + 1; j < grid.length; j++) {
      const d = haversineDistance(grid[i].pos[0], grid[i].pos[1], grid[j].pos[0], grid[j].pos[1]);
      if (d < 120) {
        let edgeBlocked = false;
        for (const zone of restrictedZones) {
          if (pathIntersectsZone([grid[i].pos, grid[j].pos], zone.polygon)) {
            edgeBlocked = true; break;
          }
        }
        if (!edgeBlocked) {
          grid[i].neighbors.push({ idx: j, cost: d });
          grid[j].neighbors.push({ idx: i, cost: d });
        }
      }
    }
  }

  const path = astar(grid, startIdx, destIdx);
  if (!path) return null;
  return path.map(i => grid[i].pos);
}

function buildGrid(navigableWater, restrictedZones) {
  const nodes = [];
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lat, lng] of navigableWater) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }

  for (let lat = minLat; lat <= maxLat; lat += GRID_STEP) {
    for (let lng = minLng; lng <= maxLng; lng += GRID_STEP) {
      if (!pointInPolygon(lat, lng, navigableWater)) continue;
      let inZone = false;
      for (const zone of restrictedZones) {
        if (pointInPolygon(lat, lng, zone.polygon)) { inZone = true; break; }
      }
      if (!inZone) {
        nodes.push({ pos: [lat, lng], neighbors: [] });
      }
    }
  }
  return nodes;
}

function astar(grid, startIdx, destIdx) {
  const destPos = grid[destIdx].pos;
  const openSet = new Set([startIdx]);
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  gScore.set(startIdx, 0);
  fScore.set(startIdx, haversineDistance(grid[startIdx].pos[0], grid[startIdx].pos[1], destPos[0], destPos[1]));

  while (openSet.size > 0) {
    let current = -1;
    let minF = Infinity;
    for (const n of openSet) {
      const f = fScore.get(n) ?? Infinity;
      if (f < minF) { minF = f; current = n; }
    }

    if (current === destIdx) {
      const path = [current];
      let c = current;
      while (cameFrom.has(c)) { c = cameFrom.get(c); path.unshift(c); }
      return path;
    }

    openSet.delete(current);

    for (const { idx: neighbor, cost } of grid[current].neighbors) {
      const tentG = (gScore.get(current) ?? Infinity) + cost;
      if (tentG < (gScore.get(neighbor) ?? Infinity)) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentG);
        fScore.set(neighbor, tentG + haversineDistance(grid[neighbor].pos[0], grid[neighbor].pos[1], destPos[0], destPos[1]));
        openSet.add(neighbor);
      }
    }
  }
  return null;
}
