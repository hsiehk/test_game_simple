import { LOOKS, getLook, LAYER_ORDER } from "./looks.js";
import { MakeupRenderer } from "./makeup.js";

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
  intensity: document.getElementById("intensity"),
  compareBtn: document.getElementById("compare-btn"),
  snapshotBtn: document.getElementById("snapshot-btn"),
  modeToggle: document.getElementById("mode-toggle"),
  tutorialPanel: document.getElementById("tutorial-panel"),
  stepCounter: document.getElementById("step-counter"),
  stepTitle: document.getElementById("step-title"),
  stepInstruction: document.getElementById("step-instruction"),
  stepTip: document.getElementById("step-tip"),
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
};

let renderer = null;
let faceLandmarker = null;
let lastVideoTime = -1;
let lastResult = null;

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
  els.status.classList.toggle("hidden", !text);
}

// ---------- UI wiring ----------

function buildLookButtons() {
  for (const look of LOOKS) {
    const btn = document.createElement("button");
    btn.className = "look-btn";
    btn.textContent = look.name;
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
  state.look = getLook(id);
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
}

// ---------- Camera + tracking ----------

async function loadTracker() {
  const vision = await import("../vendor/tasks-vision/vision_bundle.mjs");
  const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
  faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
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

  if (!landmarks) {
    setStatus("No face detected — center your face in the frame.");
  } else {
    setStatus("");
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
