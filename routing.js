/**
 * routing.js
 * Contains only routing utilities + Dijkstra algorithm.
 */

function haversine(a, b) {
  const R = 6371e3; // meters
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const A = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A));
}

// Ray-casting
function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;

  const x = point.lng;
  const y = point.lat;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }

  return inside;
}

function computeSafeRoute(nodes, trafficList, floodsList, srcPoint, dstPoint) {
  const trafficMap = {};

  for (const t of trafficList || []) {
    if (!t || !t.edgeId) continue;
    trafficMap[t.edgeId] = t.congestionScore ?? t.score ?? 0;
  }

  const nodeArray = Object.values(nodes);

  function closestNode(point) {
    let best = null;
    let bestDist = Infinity;

    for (const n of nodeArray) {
      const d = haversine(point, { lat: n.lat, lng: n.lng });
      if (d < bestDist) {
        best = n;
        bestDist = d;
      }
    }
    return best;
  }

  const start = closestNode(srcPoint);
  const end = closestNode(dstPoint);

  if (!start || !end) return { path: [], start: null, end: null };

  // Build clean adjacency list
  const adj = {};
  for (const n of nodeArray) {
    adj[n.id] = (n.neighbors || []).map(m => typeof m === "string" ? m : m.id);
  }

  const dist = {};
  const prev = {};
  const visited = new Set();

  for (const n of nodeArray) {
    dist[n.id] = Infinity;
    prev[n.id] = null;
  }
  dist[start.id] = 0;

  function edgeCost(aId, bId) {
    const a = nodes[aId];
    const b = nodes[bId];
    if (!a || !b) return Infinity;

    let base = haversine(a, b);

    const e1 = `${aId}_${bId}`;
    const e2 = `${bId}_${aId}`;
    const traffic = trafficMap[e1] ?? trafficMap[e2] ?? 0;

    // traffic penalty
    base *= (1 + 2 * traffic);

    // flood penalty
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    for (const f of floodsList || []) {
      if (pointInPolygon(mid, f.polygon)) {
        base *= (1 + 5 * (f.severity || 1));
      }
    }

    return base;
  }

  function extractMin() {
    let best = null;
    for (const id in dist) {
      if (!visited.has(id)) {
        if (best === null || dist[id] < dist[best]) {
          best = id;
        }
      }
    }
    return best;
  }

  while (true) {
    const u = extractMin();
    if (u === null) break;
    if (u === end.id) break;

    visited.add(u);

    for (const v of adj[u] || []) {
      if (visited.has(v)) continue;
      const alt = dist[u] + edgeCost(u, v);
      if (alt < dist[v]) {
        dist[v] = alt;
        prev[v] = u;
      }
    }
  }

  // reconstruct route
  const path = [];
  let cur = end.id;

  if (dist[cur] === Infinity) {
    return { path: [], start: start.id, end: end.id };
  }

  while (cur) {
    path.unshift(nodes[cur]);
    cur = prev[cur];
  }

  return {
    start: start.id,
    end: end.id,
    distance_m: dist[end.id],
    path: path.map((n) => ({ lat: n.lat, lng: n.lng, id: n.id }))
  };
}

export { computeSafeRoute, haversine, pointInPolygon };
