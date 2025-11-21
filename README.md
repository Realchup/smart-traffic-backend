# Smart Traffic Backend

Express.js backend server for the Smart Traffic Routing System.

## Features

- Weather data fetching from Open-Meteo API
- Traffic data ingestion and storage
- Safe route computation using Dijkstra's algorithm
- Flood zone avoidance
- OSRM route fallback

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure Firebase:
   - Copy your Firebase service account key to this directory
   - For local dev: Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable
   - For production: Set `SERVICE_ACCOUNT_BASE64` environment variable

3. Start the server:
```bash
npm start
```

## API Endpoints

### `GET /`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "now": "2024-01-01T00:00:00.000Z"
}
```

### `GET /weather?lat={lat}&lon={lon}`
Fetches current weather data for a location.

**Query Parameters:**
- `lat` (required): Latitude
- `lon` (required): Longitude

**Response:**
```json
{
  "ok": true,
  "current": {
    "temperature": 25.5,
    "windspeed": 10.2,
    "weathercode": 0
  }
}
```

### `POST /traffic`
Ingests traffic data into Firestore.

**Request Body:**
```json
{
  "edgeId": "node1_node2",
  "congestionScore": 0.5,
  "path": [...]
}
```

**Response:**
```json
{
  "ok": true
}
```

### `POST /route`
Computes a safe route between two points.

**Request Body:**
```json
{
  "src": { "lat": 30.2679, "lng": 77.9950 },
  "dst": { "lat": 30.2762, "lng": 77.9991 }
}
```

**Response:**
```json
{
  "ok": true,
  "route": {
    "path": [
      { "lat": 30.2679, "lng": 77.9950, "id": "node1" },
      ...
    ],
    "start": "node1",
    "end": "node2",
    "distance_m": 1234.56
  }
}
```

### `GET /osrm-route?startLat={lat}&startLon={lon}&endLat={lat}&endLon={lon}`
Gets a route from OSRM (fallback).

**Query Parameters:**
- `startLat`, `startLon`: Start coordinates
- `endLat`, `endLon`: End coordinates

## Firestore Collections

- `roads`: Road network nodes
- `traffic`: Traffic congestion data
- `floods`: Flood zone polygons
- `weather_logs`: Weather data logs
- `route_requests`: Route computation logs

## Algorithm

The route computation uses Dijkstra's algorithm with:
- Base cost: Haversine distance between nodes
- Traffic penalty: `base * (1 + 2 * congestionScore)`
- Flood penalty: `base * (1 + 5 * severity)` if midpoint is in flood zone

