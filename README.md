# Party Photos

A simple shared photo wall: anyone who opens the URL can see all uploaded photos, take a picture with the device camera (capture → retake → save), download, or delete. No login.

## Run locally

```bash
cd Party
npm install
npm start
```

Open **http://localhost:3000** in your browser (desktop or phone on the same Wi‑Fi: use your computer’s LAN IP and the same port, e.g. `http://192.168.1.10:3000`).

Camera capture uses `getUserMedia`, which requires a **secure context**: `localhost`, `127.0.0.1`, or HTTPS.

## Behaviour

- **Center button** opens the camera UI with **Capture**, **Retake**, and **Save**. Saving uploads the JPEG to the server and adds it to the wall.
- **Photos** animate from the **center** into random positions (staggered), then each tile **spins** randomly **clockwise or counter‑clockwise**.
- **Tap/click a photo** to open the viewer modal with **Download** and **Delete**.
- **Wallpaper** is `public/assets/wall-background.png` (cover). Replace that file or re-copy from `Assets/Image/` when the design asset changes.

Uploads are stored under `uploads/` (ignored by git except `.gitkeep`).

## Environment

- `PORT` — optional, default `3000`.
