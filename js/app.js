import { LOOKS, getLook, LAYER_ORDER } from "./looks.js";
import { MakeupRenderer } from "./makeup.js";
import { buildPhotoLook, drawReferenceCrop } from "./photolook.js";
import {
  packSteps, encodePayload, buildCompanionUrl, parseCompanionHash,
} from "./companion.js";
import { qrcode } from "../vendor/qrcode/qrcode.mjs";

// MediaPipe is vendored locally (see vendor/) so the app is fully
// self-contained — no CDN dependency, nothing fetched from third parties.
const MEDIAPIPE_WASM = "./vendor/tasks-vision/wasm";
const MODEL_URL = "./vendor/models/face_landmarker.task";

const els = {
  video: document.getElementById("camera"),
  canvas: document.getElementById("stage"),
  status: document.getElementById("status"),
  startBtn: document.getElementById("start-btn"),
  startPanel: document.getElementById("start-panel"),
  lookList: document.getElementById("look-list"),
  lookDescription: document.getElementById("look-description"),
  photoBtn: document.getElementById("photo-btn"),
  photoInput: document.getElementById("photo-input"),
  intensity: document.getElementById("intensity"),
  compareBtn: document.getElementById("compare-btn"),
  snapshotBtn: document.getElementById("snapshot-btn"),
  mirrorBtn: document.getElementById("mirror-btn"),
  modeToggle: document.getElementById("mode-toggle"),
  tutorialPanel: document.getElementById("tutorial-panel"),
  stepCounter: document.getElementById("step-counter"),
  stepTitle: document.getElementById("step-title"),
  stepInstruction: document.getElementById("step-instruction"),
  stepTip: document.getElementById("step-tip"),
  referenceWrap: document.getElementById("reference-wrap"),
  referenceCanvas: document.getElementById("reference-canvas"),
  prevBtn: document.getElementById("prev-step"),
  nextBtn: document.getElementById("next-step"),
  sendPhoneBtn: document.getElementById("send-phone-btn"),
  qrModal: document.getElementById("qr-modal"),
  qrBox: document.getElementById("qr-box"),
  qrClose: document.getElementById("qr-close"),
  hud: document.getElementById("mirror-hud"),
  hudChip: document.getElementById("hud-chip"),
  hudPrev: document.getElementById("hud-prev"),
  hudNext: document.getElementById("hud-next"),
  hudExit: document.getElementById("hud-exit"),
  hudHint: document.getElementById("hud-hint"),
  companionView: document.getElementById("companion-view"),
};

const state = {
  look: getLook("natural"),
  intensity: 0.8,
  tutorialMode: false,
  stepIndex: 0,
  compare: false,
  running: false,
  mirrorMode: false,
  photoLook: null,
  photoImage: null,
  photoLandmarks: null,
  ghostActive: false,
  ghostOpacity: 0.55,
};

let renderer = null;
let visionModule = null;
let visionFileset = null;
let faceLandmarker = null;     // VIDEO mode, for the live camera
let photoLandmarker = null;    // IMAGE mode, for uploaded reference photos
let lastVideoTime = -1;
let lastResult = null;

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
  els.status.classList.toggle("hidden", !text);
}

// ---------- UI wiring ----------

function buildLookButtons() {
  els.lookList.textContent = "";
  const entries = [...LOOKS];
  if (state.photoLook) entries.push(state.photoLook);
  for (const look of entries) {
    const btn = document.createElement("button");
    btn.className = "look-btn";
    btn.textContent = look.id === "photo" ? "📷 From your photo" : look.name;
    btn.dataset.lookId = look.id;
    btn.addEventListener("click", () => selectLook(look.id));
    els.lookList.appendChild(btn);
  }
  refreshLookButtons();
}

function refreshLookButtons() {
  for (const btn of els.lookList.querySelectorAll(".look-btn")) {
    btn.classList.toggle("active", btn.dataset.lookId === state.look.id);
  }
  els.lookDescription.textContent = state.look.description;
}

function selectLook(id) {
  state.look = id === "photo" && state.photoLook ? state.photoLook : getLook(id);
  state.stepIndex = 0;
  refreshLookButtons();
  refreshTutorial();
}

function stepBy(delta) {
  const last = state.look.steps.length - 1;
  const next = state.stepIndex + delta;
  if (next < 0) return;
  if (next > last) {
    state.tutorialMode = false;
  } else {
    state.stepIndex = next;
  }
  refreshTutorial();
}

function refreshTutorial() {
  const steps = state.look.steps;
  const step = steps[state.stepIndex];
  els.tutorialPanel.classList.toggle("hidden", !state.tutorialMode);
  els.modeToggle.textContent = state.tutorialMode
    ? "Exit tutorial"
    : "Start tutorial";
  refreshHud();
  if (!state.tutorialMode || !step) return;
  els.stepCounter.textContent = `Step ${state.stepIndex + 1} of ${steps.length}`;
  els.stepTitle.textContent = step.title;
  els.stepInstruction.textContent = step.instruction;
  els.stepTip.textContent = `Tip: ${step.tip}`;
  els.prevBtn.disabled = state.stepIndex === 0;
  els.nextBtn.textContent =
    state.stepIndex === steps.length - 1 ? "Finish ✓" : "Next step →";

  // Photo-derived looks get a zoomed reference crop for the current step.
  const showReference =
    state.look.id === "photo" && state.photoImage && state.photoLandmarks;
  els.referenceWrap.classList.toggle("hidden", !showReference);
  if (showReference) {
    drawReferenceCrop(
      els.referenceCanvas,
      state.photoImage,
      state.photoLandmarks,
      step.layer,
    );
  }
}

// ---------- Mirror mode ----------

function setMirrorMode(on) {
  state.mirrorMode = on;
  document.body.classList.toggle("mirror-mode", on);
  els.mirrorBtn.textContent = on ? "Exit mirror mode" : "🪞 Mirror mode";
  refreshHud();
}

function refreshHud() {
  if (!state.mirrorMode) return;
  const step = state.tutorialMode ? state.look.steps[state.stepIndex] : null;
  els.hudChip.textContent = step
    ? `${state.stepIndex + 1}/${state.look.steps.length} · ${step.title}`
    : state.look.name;
  els.hudPrev.classList.toggle("hidden", !state.tutorialMode);
  els.hudNext.classList.toggle("hidden", !state.tutorialMode);
  els.hudHint.classList.toggle("hidden", !state.photoImage);
}

// ---------- Ghost overlay gesture ----------
// Press and hold the mirror to overlay the uploaded photo on your face;
// drag left/right while holding to change its opacity. A quick tap in
// mirror mode steps the tutorial (left edge back, right edge forward).

const HOLD_MS = 250;
const TAP_SLOP_PX = 12;

function bindStageGestures() {
  const gesture = {
    active: false, pointerId: null,
    downX: 0, downY: 0, downTime: 0, moved: false, timer: null, startOpacity: 0,
  };

  els.canvas.addEventListener("pointerdown", (e) => {
    if (!state.running) return;
    gesture.active = true;
    gesture.pointerId = e.pointerId;
    gesture.downX = e.clientX;
    gesture.downY = e.clientY;
    gesture.downTime = performance.now();
    gesture.moved = false;
    els.canvas.setPointerCapture(e.pointerId);
    if (state.photoImage && state.photoLandmarks) {
      gesture.timer = setTimeout(() => {
        if (!gesture.moved) {
          state.ghostActive = true;
          gesture.startOpacity = state.ghostOpacity;
          gesture.downX = e.clientX; // re-anchor drag at activation
        }
      }, HOLD_MS);
    }
  });

  els.canvas.addEventListener("pointermove", (e) => {
    // Only a pointer that went down on the mirror drives the gesture;
    // hovering across the canvas must not disturb its state.
    if (!gesture.active || e.pointerId !== gesture.pointerId) return;
    const dx = e.clientX - gesture.downX;
    const dy = e.clientY - gesture.downY;
    if (!state.ghostActive && Math.hypot(dx, dy) > TAP_SLOP_PX) gesture.moved = true;
    if (state.ghostActive) {
      const rect = els.canvas.getBoundingClientRect();
      state.ghostOpacity = Math.min(0.95, Math.max(0.05,
        gesture.startOpacity + (dx / rect.width) * 1.2));
    }
  });

  const end = (e) => {
    if (!gesture.active) return;
    gesture.active = false;
    clearTimeout(gesture.timer);
    if (state.ghostActive) {
      state.ghostActive = false;
      return;
    }
    const quickTap =
      performance.now() - gesture.downTime < 300 && !gesture.moved;
    if (quickTap && state.mirrorMode && state.tutorialMode) {
      const rect = els.canvas.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      if (fx < 0.35) stepBy(-1);
      else if (fx > 0.65) stepBy(1);
    }
  };
  els.canvas.addEventListener("pointerup", end);
  els.canvas.addEventListener("pointercancel", () => {
    gesture.active = false;
    clearTimeout(gesture.timer);
    state.ghostActive = false;
  });
}

// ---------- Send instructions to phone ----------

async function showCompanionQr() {
  els.sendPhoneBtn.disabled = true;
  try {
    const payload = await encodePayload(packSteps(state.look));
    const url = buildCompanionUrl(location.href, payload);
    const qr = qrcode(0, "L");
    qr.addData(url);
    qr.make();
    els.qrBox.innerHTML = qr.createImgTag(3, 8);
    els.qrBox.dataset.url = url;
    els.qrModal.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    setStatus("Could not build the phone link: " + (err?.message ?? err), true);
  } finally {
    els.sendPhoneBtn.disabled = false;
  }
}

// ---------- Companion (phone) mode ----------

function renderCompanion(data) {
  document.body.classList.add("companion");
  let index = 0;
  const total = data.steps.length;
  const el = (id) => document.getElementById(id);

  const show = () => {
    const s = data.steps[index];
    el("companion-name").textContent = data.name;
    el("companion-counter").textContent = `Step ${index + 1} of ${total}`;
    el("companion-title").textContent = s.t;
    el("companion-instruction").textContent = s.i;
    el("companion-tip").textContent = `Tip: ${s.p}`;
    const swatch = el("companion-swatch");
    swatch.style.background = s.c ?? "transparent";
    swatch.classList.toggle("hidden", !s.c);
    el("companion-prev").disabled = index === 0;
    el("companion-next").textContent = index === total - 1 ? "Done ✓" : "Next step →";
  };

  el("companion-prev").addEventListener("click", () => {
    if (index > 0) index--;
    show();
  });
  el("companion-next").addEventListener("click", () => {
    if (index < total - 1) index++;
    show();
  });
  show();
}

// ---------- Reference photo analysis ----------

async function loadReferencePhoto(file) {
  els.photoBtn.disabled = true;
  try {
    setStatus("Analyzing your photo…");
    const image = await createImageBitmap(file);
    const landmarker = await getPhotoLandmarker();
    const result = landmarker.detect(image);
    const landmarks = result?.faceLandmarks?.[0];
    if (!landmarks) {
      setStatus("No face found in that photo — try a clear, front-facing shot.", true);
      setTimeout(() => {
        if (els.status.classList.contains("error")) setStatus("");
      }, 6000);
      return;
    }
    state.photoImage = image;
    state.photoLandmarks = landmarks;
    state.photoLook = buildPhotoLook(image, landmarks);
    buildLookButtons();
    selectLook("photo");
    state.tutorialMode = true;
    state.stepIndex = 0;
    refreshTutorial();
    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus("Could not analyze that photo: " + (err?.message ?? err), true);
  } finally {
    els.photoBtn.disabled = false;
  }
}

function bindControls() {
  els.intensity.addEventListener("input", () => {
    state.intensity = Number(els.intensity.value) / 100;
  });

  els.modeToggle.addEventListener("click", () => {
    state.tutorialMode = !state.tutorialMode;
    state.stepIndex = 0;
    refreshTutorial();
  });

  els.prevBtn.addEventListener("click", () => stepBy(-1));
  els.nextBtn.addEventListener("click", () => stepBy(1));

  const startCompare = () => (state.compare = true);
  const endCompare = () => (state.compare = false);
  els.compareBtn.addEventListener("pointerdown", startCompare);
  els.compareBtn.addEventListener("pointerup", endCompare);
  els.compareBtn.addEventListener("pointerleave", endCompare);

  els.snapshotBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = `makeup-${state.look.id}-${Date.now()}.png`;
    link.href = els.canvas.toDataURL("image/png");
    link.click();
  });

  els.photoBtn.addEventListener("click", () => els.photoInput.click());
  els.photoInput.addEventListener("change", () => {
    const file = els.photoInput.files?.[0];
    if (file) loadReferencePhoto(file);
    els.photoInput.value = "";
  });

  els.mirrorBtn.addEventListener("click", () => setMirrorMode(!state.mirrorMode));
  els.hudExit.addEventListener("click", () => setMirrorMode(false));
  els.hudPrev.addEventListener("click", () => stepBy(-1));
  els.hudNext.addEventListener("click", () => stepBy(1));

  els.sendPhoneBtn.addEventListener("click", showCompanionQr);
  els.qrClose.addEventListener("click", () => els.qrModal.classList.add("hidden"));
  els.qrModal.addEventListener("click", (e) => {
    if (e.target === els.qrModal) els.qrModal.classList.add("hidden");
  });

  bindStageGestures();
}

// ---------- Camera + tracking ----------

async function loadVision() {
  if (!visionModule) {
    visionModule = await import("../vendor/tasks-vision/vision_bundle.mjs");
  }
  if (!visionFileset) {
    visionFileset = await visionModule.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
  }
  return visionModule;
}

async function getPhotoLandmarker() {
  if (!photoLandmarker) {
    const vision = await loadVision();
    photoLandmarker = await vision.FaceLandmarker.createFromOptions(visionFileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "IMAGE",
      numFaces: 1,
    });
  }
  return photoLandmarker;
}

async function loadTracker() {
  const vision = await loadVision();
  faceLandmarker = await vision.FaceLandmarker.createFromOptions(visionFileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
  });
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
    audio: false,
  });
  els.video.srcObject = stream;
  await new Promise((resolve) => {
    els.video.onloadedmetadata = resolve;
  });
  await els.video.play();
  els.canvas.width = els.video.videoWidth;
  els.canvas.height = els.video.videoHeight;
}

function frameLoop(time) {
  if (!state.running) return;

  if (els.video.currentTime !== lastVideoTime) {
    lastVideoTime = els.video.currentTime;
    try {
      lastResult = faceLandmarker.detectForVideo(els.video, performance.now());
    } catch {
      lastResult = null;
    }
  }

  const landmarks = lastResult?.faceLandmarks?.[0] ?? null;
  const step = state.tutorialMode ? state.look.steps[state.stepIndex] : null;

  // In tutorial mode, only layers up to the current step are applied,
  // so the look builds up as the user progresses.
  let enabledLayers = null;
  if (step) {
    enabledLayers = new Set(
      state.look.steps.slice(0, state.stepIndex + 1).map((s) => s.layer),
    );
  }

  const ghost =
    state.ghostActive && state.photoImage && state.photoLandmarks
      ? {
          image: state.photoImage,
          landmarks: state.photoLandmarks,
          opacity: state.ghostOpacity,
        }
      : null;

  renderer.render(els.video, landmarks, state.look, {
    intensity: state.intensity,
    enabledLayers,
    highlightLayer: step?.layer ?? null,
    compare: state.compare,
    ghost,
    time,
  });

  // Never stomp an error message (e.g. from a failed photo upload); those
  // clear themselves after a few seconds.
  if (!els.status.classList.contains("error")) {
    if (!landmarks) {
      setStatus("No face detected — center your face in the frame.");
    } else {
      setStatus("");
    }
  }

  requestAnimationFrame(frameLoop);
}

async function start() {
  els.startBtn.disabled = true;
  try {
    setStatus("Loading face tracker (first load downloads ~5 MB)…");
    await loadTracker();
    setStatus("Requesting camera…");
    await startCamera();
  } catch (err) {
    console.error(err);
    const msg = String(err?.name || err);
    if (msg.includes("NotAllowed")) {
      setStatus("Camera permission was denied. Allow camera access and reload.", true);
    } else if (msg.includes("NotFound")) {
      setStatus("No camera found on this device.", true);
    } else {
      setStatus("Could not start: " + (err?.message ?? err), true);
    }
    els.startBtn.disabled = false;
    return;
  }
  els.startPanel.classList.add("hidden");
  renderer = new MakeupRenderer(els.canvas);
  state.running = true;
  setStatus("");
  requestAnimationFrame(frameLoop);
}

// ---------- Init ----------

async function init() {
  const companionData = await parseCompanionHash(location.hash);
  if (companionData) {
    renderCompanion(companionData);
    window.__app = { companion: companionData };
    return;
  }
  buildLookButtons();
  bindControls();
  refreshTutorial();
  els.startBtn.addEventListener("click", start);
  // Expose a minimal hook for smoke tests.
  window.__app = { state, looks: LOOKS, layerOrder: LAYER_ORDER };
}

init();
