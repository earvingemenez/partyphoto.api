require("dotenv").config();

const path = require("path");
const http = require("http");
const { URL } = require("url");
const express = require("express");

const PORT = Number(process.env.PORT) || 3000;
const API_URL = process.env.API_URL || "http://localhost:8000";
const ROOT = __dirname;

const apiTarget = new URL(API_URL);

function proxy(req, res) {
  const opts = {
    protocol: apiTarget.protocol,
    hostname: apiTarget.hostname,
    port: apiTarget.port || (apiTarget.protocol === "https:" ? 443 : 80),
    path: req.originalUrl,
    method: req.method,
    headers: { ...req.headers, host: apiTarget.host },
  };

  const upstream = http.request(opts, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });

  upstream.on("error", (e) => {
    console.error("Proxy error:", e.message);
    if (!res.headersSent) {
      res.status(502).json({ error: "API unavailable" });
    } else {
      res.end();
    }
  });

  req.pipe(upstream);
}

const app = express();

app.use("/api", proxy);
app.use("/uploads", proxy);

app.use(express.static(path.join(ROOT, "public")));

app.listen(PORT, () => {
  console.log(`Party photos at http://localhost:${PORT}`);
  console.log(`Proxying /api and /uploads to ${API_URL}`);
});
