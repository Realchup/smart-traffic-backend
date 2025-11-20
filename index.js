import express from "express";
import cors from "cors";
import { computeSafeRoute } from "./routing.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Smart Traffic Backend is running 🚦");
});

app.get("/route", (req, res) => {
  const { srcLat, srcLng, dstLat, dstLng } = req.query;

  if (!srcLat || !srcLng || !dstLat || !dstLng) {
    return res.status(400).json({
      error: "Missing parameters: srcLat, srcLng, dstLat, dstLng"
    });
  }

  const src = { lat: parseFloat(srcLat), lng: parseFloat(srcLng) };
  const dst = { lat: parseFloat(dstLat), lng: parseFloat(dstLng) };

  const route = computeSafeRoute(src, dst);
  res.json(route);
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
