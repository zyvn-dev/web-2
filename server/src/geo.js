const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_RADIUS_KM = 6371;
const KM_PER_NAUTICAL_MILE = 1.852;

export function haversineDistance(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearing(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const y = Math.sin(dLng) * Math.cos(lat2 * DEG_TO_RAD);
  const x =
    Math.cos(lat1 * DEG_TO_RAD) * Math.sin(lat2 * DEG_TO_RAD) -
    Math.sin(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.cos(dLng);
  return ((Math.atan2(y, x) * RAD_TO_DEG) + 360) % 360;
}

export function movePoint(lat, lng, headingDeg, distanceKm) {
  const d = distanceKm / EARTH_RADIUS_KM;
  const h = headingDeg * DEG_TO_RAD;
  const lat1 = lat * DEG_TO_RAD;
  const lng1 = lng * DEG_TO_RAD;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(h)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(h) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [lat2 * RAD_TO_DEG, lng2 * RAD_TO_DEG];
}

export function knotsToKmPerSecond(knots) {
  return (knots * KM_PER_NAUTICAL_MILE) / 3600;
}

export function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function segmentIntersectsPolygon(lat1, lng1, lat2, lng2, polygon) {
  for (let i = 0; i < polygon.length - 1; i++) {
    if (segmentsIntersect(
      lat1, lng1, lat2, lng2,
      polygon[i][0], polygon[i][1], polygon[i + 1][0], polygon[i + 1][1]
    )) return true;
  }
  return false;
}

function segmentsIntersect(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  const d1 = cross(bx1, by1, bx2, by2, ax1, ay1);
  const d2 = cross(bx1, by1, bx2, by2, ax2, ay2);
  const d3 = cross(ax1, ay1, ax2, ay2, bx1, by1);
  const d4 = cross(ax1, ay1, ax2, ay2, bx2, by2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

function cross(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function pathIntersectsZone(path, zone) {
  for (let i = 0; i < path.length - 1; i++) {
    if (pointInPolygon(path[i][0], path[i][1], zone)) return true;
    if (segmentIntersectsPolygon(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1], zone)) return true;
  }
  if (path.length > 0 && pointInPolygon(path[path.length - 1][0], path[path.length - 1][1], zone)) return true;
  return false;
}

export function distanceAlongPath(path) {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += haversineDistance(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
  }
  return total;
}
