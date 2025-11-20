export function computeSafeRoute(src, dst) {
  const steps = 6;
  const path = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push({
      lat: src.lat + (dst.lat - src.lat) * t,
      lng: src.lng + (dst.lng - src.lng) * t
    });
  }

  return {
    start: src,
    end: dst,
    path,
    distance_m: Math.round(
      Math.hypot(
        (dst.lat - src.lat) * 111000,
        (dst.lng - src.lng) * 111000
      )
    ),
    notes: "Route is demo. Replace with real Dehradun routing later."
  };
}
