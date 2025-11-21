/**
 * backend/index.js
 *
 * Requirements:
 *  - Node 20 (we recommend v20.x)
 *  - npm install firebase-admin express cors
 *
 * Environment:
 *  - For local development: set GOOGLE_APPLICATION_CREDENTIALS=/full/path/to/serviceAccountKey.json
 *  - For Render (or other hosts): set SERVICE_ACCOUNT_BASE64 to base64(serviceAccountKey.json)
 *
 * Run:
 *  node index.js
 *
 * Endpoints:
 *  GET  /                 -> health check
 *  GET  /weather?lat=&lon=  -> fetch weather (Open-Meteo) and store log
 *  POST /traffic           -> ingest traffic doc into firestore (body contains edgeId, congestionScore, path, ...)
 *  GET  /osrm-route?startLat=&startLon=&endLat=&endLon=  -> diagnostic OSRM call
 *  POST /route             -> compute safe route using Dijkstra (body { src:{lat,lng}, dst:{lat,lng} })
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import { computeSafeRoute } from "./routing.js";


const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ---------- Firestore initialization ----------
function initFirebase() {
  // If SERVICE_ACCOUNT_BASE64 provided (Render/Deployed), write file and init with it
  if (process.env.SERVICE_ACCOUNT_BASE64) {
    const raw = Buffer.from(process.env.SERVICE_ACCOUNT_BASE64, "base64");
    const saPath = path.join(process.cwd(), "serviceAccount.json");
    fs.writeFileSync(saPath, raw);
    admin.initializeApp({
      credential: admin.credential.cert(saPath),
    });
    console.log("Initialized Firebase using SERVICE_ACCOUNT_BASE64 -> serviceAccount.json");
    return;
  }

  // Otherwise rely on GOOGLE_APPLICATION_CREDENTIALS (local dev) or default credentials in env
  try {
    admin.initializeApp();
    console.log("Initialized Firebase with default credentials (GOOGLE_APPLICATION_CREDENTIALS or metadata)");
  } catch (err) {
    console.error("Firebase initialization failed:", err);
    process.exit(1);
  }
}

initFirebase();
const db = admin.firestore();

// ---------- Routes ----------

// Health
app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    now: new Date().toISOString(),
    message: "Smart Traffic Backend is running"
  });
});

// Weather (Open-Meteo) — stores a log into 'weather_logs'
app.get("/weather", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: "lat and lon required" });

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Open-Meteo ${resp.status}`);
    const data = await resp.json();

    const log = {
      lat, lon,
      fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
      raw: data,
      current: data.current_weather || null
    };

    // store to firestore
    await db.collection("weather_logs").add(log);

    res.json({ ok: true, current: data.current_weather || null });
  } catch (err) {
    console.error("weather error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /traffic - ingest traffic info (client/simulator can POST here)
app.post("/traffic", async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.edgeId) return res.status(400).json({ error: "body.edgeId required" });

    const docRef = db.collection("traffic").doc(String(payload.edgeId));
    await docRef.set({
      ...payload,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("traffic ingest error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /osrm-route - diagnostic route from OSRM (useful for frontend fallback)
app.get("/osrm-route", async (req, res) => {
  try {
    const { startLat, startLon, endLat, endLon } = req.query;
    if (!startLat || !startLon || !endLat || !endLon) return res.status(400).json({ error: "startLat,startLon,endLat,endLon required" });

    const url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`OSRM ${resp.status}`);
    const data = await resp.json();

    res.json(data);
  } catch (err) {
    console.error("osrm error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /route - compute safe route using Dijkstra on roads in Firestore
// Body: { src: {lat,lng}, dst: {lat,lng} }
// Falls back to OSRM if no roads are available in Firestore
app.post("/route", async (req, res) => {
  try {
    const { src, dst } = req.body;
    if (!src || !dst || typeof src.lat !== "number" || typeof src.lng !== "number" || 
        typeof dst.lat !== "number" || typeof dst.lng !== "number") {
      return res.status(400).json({ error: "src and dst with valid lat/lng required in body" });
    }

    // load roads nodes
    const roadsSnap = await db.collection("roads").get();
    const nodes = {};
    roadsSnap.forEach(doc => {
      const d = doc.data();
      // ensure neighbors array is in correct format (ids)
      const neighbors = (d.neighbors || []).map(n => (typeof n === "string" ? n : (n.id || n)));
      nodes[doc.id] = { id: doc.id, lat: d.lat, lng: d.lng, neighbors };
    });

    // If no roads in Firestore, fallback to OSRM
    if (Object.keys(nodes).length === 0) {
      console.log("No roads in Firestore, falling back to OSRM");
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${src.lng},${src.lat};${dst.lng},${dst.lat}?overview=full&geometries=geojson`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`OSRM ${resp.status}`);
        const osrmData = await resp.json();
        
        if (osrmData.code === "Ok" && osrmData.routes && osrmData.routes.length > 0) {
          const route = osrmData.routes[0];
          const path = route.geometry.coordinates.map(coord => ({ lng: coord[0], lat: coord[1] }));
          
          // Store route request log
          await db.collection("route_requests").add({
            src, dst, 
            resultMeta: { 
              method: "OSRM", 
              distance_m: route.distance || null,
              duration_s: route.duration || null
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });

          return res.json({ 
            ok: true, 
            route: { 
              path: path.map(p => ({ lat: p.lat, lng: p.lng })),
              distance_m: route.distance,
              method: "OSRM"
            } 
          });
        } else {
          throw new Error("OSRM returned no route");
        }
      } catch (osrmErr) {
        console.error("OSRM fallback error:", osrmErr);
        return res.status(500).json({ error: "No roads available and OSRM fallback failed" });
      }
    }

    // load traffic docs
    const trafficSnap = await db.collection("traffic").get();
    const trafficList = trafficSnap.docs.map(d => d.data());

    // load floods docs (polygons)
    const floodsSnap = await db.collection("floods").get();
    const floodsList = floodsSnap.docs.map(d => d.data());

    const result = computeSafeRoute(nodes, trafficList, floodsList, src, dst);

    // If no path found, try OSRM fallback
    if (!result.path || result.path.length === 0) {
      console.log("No path found with Dijkstra, trying OSRM fallback");
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${src.lng},${src.lat};${dst.lng},${dst.lat}?overview=full&geometries=geojson`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`OSRM ${resp.status}`);
        const osrmData = await resp.json();
        
        if (osrmData.code === "Ok" && osrmData.routes && osrmData.routes.length > 0) {
          const route = osrmData.routes[0];
          const path = route.geometry.coordinates.map(coord => ({ lng: coord[0], lat: coord[1] }));
          
          await db.collection("route_requests").add({
            src, dst, 
            resultMeta: { 
              method: "OSRM", 
              distance_m: route.distance || null,
              duration_s: route.duration || null
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });

          return res.json({ 
            ok: true, 
            route: { 
              path: path.map(p => ({ lat: p.lat, lng: p.lng })),
              distance_m: route.distance,
              method: "OSRM"
            } 
          });
        }
      } catch (osrmErr) {
        console.error("OSRM fallback error:", osrmErr);
      }
    }

    // Optionally store route request log
    await db.collection("route_requests").add({
      src, dst, resultMeta: { 
        start: result.start, 
        end: result.end, 
        distance_m: result.distance_m || null,
        method: "Dijkstra"
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ ok: true, route: result });
  } catch (err) {
    console.error("route compute error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Smart-traffic backend listening on ${PORT}`);
});
