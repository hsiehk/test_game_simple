import { LOOKS, getLook, LAYER_ORDER } from "./looks.js";
import { MakeupRenderer } from "./makeup.js";
import { buildPhotoLook, drawReferenceCrop } from "./photolook.js";

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
};

const state = {
  look: getLook("natural"),
  intensity: 0.8,
  tutorialMode: false,
  stepIndex: 0,
  compare: false,
  running: false,
  photoLook: null,
  photoImage: null,
  photoLandmarks: null,
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

function refreshTutorial() {
  const steps = state.look.steps;
  const step = steps[state.stepIndex];
  els.tutorialPanel.classList.toggle("hidden", !state.tutorialMode);
  els.modeToggle.textContent = state.tutorialMode
    ? "Exit tutorial"
    : "Start tutorial";
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

function bindControls() {
  els.intensity.addEventListener("input", () => {
    state.intensity = Number(els.intensity.value) / 100;
  });

  els.modeToggle.addEventListener("click", () => {
    state.tutorialMode = !state.tutorialMode;
    state.stepIndex = 0;
    refreshTutorial();
  });

  els.prevBtn.addEventListener("click", () => {
    if (state.stepIndex > 0) state.stepIndex--;
    refreshTutorial();
  });

  els.nextBtn.addEventListener("click", () => {
    if (state.stepIndex < state.look.steps.length - 1) {
      state.stepIndex++;
    } else {
      state.tutorialMode = false;
    }
    refreshTutorial();
  });

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

  renderer.render(els.video, landmarks, state.look, {
    intensity: state.intensity,
    enabledLayers,
    highlightLayer: step?.layer ?? null,
    compare: state.compare,
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

buildLookButtons();
bindControls();
refreshTutorial();
els.startBtn.addEventListener("click", start);

// Expose a minimal hook for smoke tests.
window.__app = { state, looks: LOOKS, layerOrder: LAYER_ORDER };
