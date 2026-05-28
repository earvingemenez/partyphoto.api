/**
 * Party Photos — fetch wall, camera capture (getUserMedia), viewer modal.
 */

/** @typedef {{ id: string, url: string, createdAt: number }} Photo */

const wall = document.getElementById("wall");
const openCameraBtn = document.getElementById("openCamera");

const cameraModal = document.getElementById("cameraModal");
const cameraError = document.getElementById("cameraError");
const cameraVideo = document.getElementById("cameraVideo");
const cameraCanvas = document.getElementById("cameraCanvas");
const btnCapture = document.getElementById("btnCapture");
const btnRetake = document.getElementById("btnRetake");
const btnSave = document.getElementById("btnSave");
const btnCloseCamera = document.getElementById("btnCloseCamera");

const viewerModal = document.getElementById("viewerModal");
const viewerImage = document.getElementById("viewerImage");
const btnCloseViewer = document.getElementById("btnCloseViewer");
const btnDownload = document.getElementById("btnDownload");
const btnDelete = document.getElementById("btnDelete");

/** @type {MediaStream | null} */
let liveStream = null;
/** @type {Photo | null} */
let viewerPhoto = null;
/** @type {Blob | null} */
let pendingBlob = null;

function setCaptureReady(ready) {
  if (btnCapture) btnCapture.disabled = !ready;
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) || 1;
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stable layout per photo id; keeps center clear for the FAB.
 * @param {string} id
 * @param {number} index
 */
function layoutForPhoto(id, index) {
  const rnd = mulberry32(hashString(`${id}:${index}`));
  const centerX = 50;
  const centerY = 50;
  /** Minimum distance (% of viewport diagonal) between tile center & screen center */
  const minDist = window.matchMedia("(max-width: 480px)").matches ? 26 : 24;

  let cx = 50;
  let cy = 50;

  for (let attempt = 0; attempt < 48; attempt++) {
    cx = 6 + rnd() * 88;
    cy = 6 + rnd() * 88;
    const dx = cx - centerX;
    const dy = cy - centerY;
    if (Math.hypot(dx, dy) >= minDist) break;
  }

  const sizeVmin = 11 + rnd() * 12;
  const baseRot = -22 + rnd() * 44;
  const duration = 48 + rnd() * 56;
  /** Each tile: clockwise vs counter-clockwise (50/50). */
  const spinCCW = rnd() >= 0.5;

  return {
    cx,
    cy,
    sizeVmin,
    baseRot,
    duration,
    spinCCW,
  };
}

/**
 * @param {Photo[]} photos
 */
function renderWall(photos) {
  wall.textContent = "";
  photos.forEach((photo, index) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tile";
    tile.dataset.id = photo.id;

    const { cx, cy, sizeVmin, baseRot, duration, spinCCW } = layoutForPhoto(
      photo.id,
      index
    );

    tile.style.setProperty("--tile-cx", `${cx}%`);
    tile.style.setProperty("--tile-cy", `${cy}%`);
    tile.style.setProperty("--pop-delay", `${index * 0.065}s`);
    tile.style.width = `${sizeVmin}vmin`;
    tile.style.height = `${sizeVmin}vmin`;
    tile.style.zIndex = String(10 + photos.length - index);
    tile.setAttribute("aria-label", "Open photo");

    const rotor = document.createElement("span");
    rotor.className = "tile__rotor tile__rotor--spin";
    rotor.style.setProperty("--base-rot", `${baseRot.toFixed(2)}deg`);
    rotor.style.animationDuration = `${duration.toFixed(1)}s`;
    rotor.style.animationDirection = spinCCW ? "reverse" : "normal";

    const img = document.createElement("img");
    img.className = "tile__img";
    img.src = photo.url;
    img.alt = "Uploaded photo";
    img.loading = "lazy";
    img.decoding = "async";

    rotor.appendChild(img);
    tile.appendChild(rotor);
    tile.addEventListener("click", () => openViewer(photo));
    wall.appendChild(tile);
  });
}

async function refreshPhotos() {
  const res = await fetch("/api/photos", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load photos");
  /** @type {Photo[]} */
  const photos = await res.json();
  renderWall(photos);
}

function showEl(el) {
  el.hidden = false;
}

function hideEl(el) {
  el.hidden = true;
}

function setCameraError(msg) {
  if (!msg) {
    cameraError.hidden = true;
    cameraError.textContent = "";
    return;
  }
  cameraError.textContent = msg;
  cameraError.hidden = false;
}

async function startCamera() {
  setCameraError("");
  if (liveStream) {
    liveStream.getTracks().forEach((t) => t.stop());
    liveStream = null;
  }

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };

  try {
    liveStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    try {
      liveStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
    } catch (e2) {
      setCameraError(
        "Could not access the camera. Allow permission, use HTTPS or localhost, and try again."
      );
      console.error(e, e2);
      return false;
    }
  }

  cameraVideo.srcObject = liveStream;
  await cameraVideo.play().catch(() => {});
  cameraVideo.hidden = false;
  cameraCanvas.hidden = true;

  setCaptureReady(cameraVideo.videoWidth > 0);
  const markReady = () => {
    if (cameraVideo.videoWidth > 0) setCaptureReady(true);
  };
  cameraVideo.addEventListener("loadedmetadata", markReady, { once: true });
  queueMicrotask(markReady);

  btnCapture.hidden = false;
  btnRetake.hidden = true;
  btnSave.hidden = true;
  pendingBlob = null;
  return true;
}

function stopCameraTracks() {
  if (liveStream) {
    liveStream.getTracks().forEach((t) => t.stop());
    liveStream = null;
  }
  cameraVideo.srcObject = null;
}

async function openCameraUi() {
  showEl(cameraModal);
  document.body.style.overflow = "hidden";
  setCaptureReady(false);
  btnSave.disabled = false;
  pendingBlob = null;
  cameraCanvas.hidden = true;
  cameraVideo.hidden = false;

  await startCamera();
}

function closeCameraUi() {
  hideEl(cameraModal);
  document.body.style.overflow = "";
  stopCameraTracks();
  setCameraError("");
  cameraCanvas.getContext("2d")?.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
  btnCapture.hidden = false;
  btnRetake.hidden = true;
  btnSave.hidden = true;
}

function captureFrame() {
  const v = cameraVideo;
  const w = v.videoWidth;
  const h = v.videoHeight;
  if (!w || !h) {
    setCameraError("Camera is not ready yet — try again in a moment.");
    return;
  }

  cameraCanvas.width = w;
  cameraCanvas.height = h;
  const ctx = cameraCanvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(v, 0, 0, w, h);

  cameraCanvas.hidden = false;
  cameraVideo.hidden = true;
  btnCapture.hidden = true;
  btnRetake.hidden = false;
  btnSave.hidden = false;

  pendingBlob = null;
}

function retake() {
  cameraCanvas.hidden = true;
  cameraVideo.hidden = false;
  btnCapture.hidden = false;
  btnRetake.hidden = true;
  btnSave.hidden = true;
  pendingBlob = null;
  setCameraError("");
  setCaptureReady(cameraVideo.videoWidth > 0);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No blob"))), "image/jpeg", 0.92);
  });
}

async function saveCapture() {
  if (cameraCanvas.hidden) return;
  setCameraError("");
  btnSave.disabled = true;

  try {
    pendingBlob = await canvasToBlob(cameraCanvas);
    const fd = new FormData();
    fd.append("photo", pendingBlob, "capture.jpg");

    const res = await fetch("/api/photos", {
      method: "POST",
      body: fd,
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "Upload failed");
    }

    /** @type {Photo} */
    const item = await res.json();
    closeCameraUi();
    await refreshPhotos();
    openViewer(item);
  } catch (e) {
    console.error(e);
    setCameraError(e instanceof Error ? e.message : "Save failed.");
  } finally {
    btnSave.disabled = false;
  }
}

/** @param {Photo} photo */
function openViewer(photo) {
  viewerPhoto = photo;
  viewerImage.src = photo.url;
  viewerImage.alt = "Photo";
  const base = photo.id.replace(/[^a-zA-Z0-9._-]/g, "_") || "photo.jpg";
  btnDownload.href = photo.url;
  btnDownload.download = base;
  showEl(viewerModal);
  document.body.style.overflow = "hidden";
}

function closeViewer() {
  hideEl(viewerModal);
  document.body.style.overflow = "";
  viewerPhoto = null;
  viewerImage.removeAttribute("src");
}

async function deleteViewerPhoto() {
  if (!viewerPhoto) return;
  const id = viewerPhoto.id;
  btnDelete.disabled = true;
  try {
    const res = await fetch(`/api/photos/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      throw new Error("Delete failed.");
    }
    closeViewer();
    await refreshPhotos();
  } catch (e) {
    console.error(e);
    alert(e instanceof Error ? e.message : "Delete failed.");
  } finally {
    btnDelete.disabled = false;
  }
}

openCameraBtn?.addEventListener("click", () => openCameraUi());
btnCloseCamera?.addEventListener("click", () => closeCameraUi());
btnCapture?.addEventListener("click", () => captureFrame());
btnRetake?.addEventListener("click", () => retake());
btnSave?.addEventListener("click", () => saveCapture());

btnCloseViewer?.addEventListener("click", () => closeViewer());
viewerModal?.addEventListener("click", (e) => {
  if (e.target === viewerModal) closeViewer();
});
btnDelete?.addEventListener("click", () => deleteViewerPhoto());

cameraModal?.addEventListener("click", (e) => {
  if (e.target === cameraModal) closeCameraUi();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!viewerModal.hidden) closeViewer();
    else if (!cameraModal.hidden) closeCameraUi();
  }
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    refreshPhotos().catch(console.error);
  }, 200);
});

refreshPhotos().catch((e) => {
  console.error(e);
  wall.textContent = "";
  const p = document.createElement("p");
  p.style.cssText =
    "position:fixed;left:50%;top:40%;transform:translateX(-50%);color:#64748b;padding:1rem;text-align:center;max-width:20rem";
  p.textContent = "Could not load photos. Is the server running?";
  document.body.appendChild(p);
});
