import { LOOKS, getLook, LAYER_ORDER, BLUSH_STYLES } from "./looks.js";
import { MakeupRenderer } from "./makeup.js";
import {
  buildPhotoLook, drawReferenceCrop, readEyes, lensAdvice,
} from "./photolook.js";
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
  refCaption: document.getElementById("ref-caption"),
  refInset: document.getElementById("ref-inset"),
  refInsetWrap: document.getElementById("ref-inset-wrap"),
  zoomBtn: document.getElementById("zoom-btn"),
  advicePanel: document.getElementById("advice-panel"),
  adviceList: document.getElementById("advice-list"),
  blushRow: document.getElementById("blush-row"),
  blushHint: document.getElementById("blush-hint"),
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
  previewing: false,
  stepIndex: 0,
  compare: false,
  running: false,
  mirrorMode: false,
  photoLook: null,
  photoImage: null,
  photoLandmarks: null,
  ghostActive: false,
  ghostOpacity: 0.55,
  zoomToStep: true,
  myEyes: null,
  blushStyle: null,
  advice: [],
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

function blushStyleFor() {
  return state.blushStyle ?? state.look.blushStyle ?? "apples";
}

function buildBlushRow() {
  els.blushRow.textContent = "";
  for (const style of BLUSH_STYLES) {
    const btn = document.createElement("button");
    btn.className = "look-btn blush-btn";
    btn.textContent = style.name;
    btn.dataset.blushId = style.id;
    btn.addEventListener("click", () => {
      state.blushStyle = style.id;
      refreshBlushRow();
    });
    els.blushRow.appendChild(btn);
  }
  refreshBlushRow();
}

function refreshBlushRow() {
  const active = blushStyleFor();
  for (const btn of els.blushRow.querySelectorAll(".blush-btn")) {
    btn.classList.toggle("active", btn.dataset.blushId === active);
  }
  els.blushHint.textContent =
    BLUSH_STYLES.find((b) => b.id === active)?.hint ?? "";
}

function selectLook(id) {
  state.look = id === "photo" && state.photoLook ? state.photoLook : getLook(id);
  state.stepIndex = 0;
  // A different look is a different finished face, so show it whole again.
  state.previewing = state.tutorialMode;
  // A look carries its own placement; picking a new look adopts it.
  state.blushStyle = null;
  refreshLookButtons();
  refreshBlushRow();
  refreshTutorial();
}

function stepBy(delta) {
  const last = state.look.steps.length - 1;
  // The preview sits one place before step 1: forward from it starts the
  // tutorial, back from it leaves altogether.
  if (state.previewing) {
    if (delta > 0) {
      state.previewing = false;
    } else {
      state.tutorialMode = false;
      state.previewing = false;
    }
    refreshTutorial();
    return;
  }
  const next = state.stepIndex + delta;
  if (next < 0) {
    state.previewing = true;
  } else if (next > last) {
    state.tutorialMode = false;
  } else {
    state.stepIndex = next;
  }
  refreshTutorial();
}

function refreshTutorial() {
  const steps = state.look.steps;
  const step = state.previewing ? null : steps[state.stepIndex];
  els.tutorialPanel.classList.toggle("hidden", !state.tutorialMode);
  els.modeToggle.textContent = state.tutorialMode
    ? "Exit tutorial"
    : "Start tutorial";
  refreshHud();
  if (!state.tutorialMode || (!step && !state.previewing)) return;
  if (state.previewing) {
    // Nothing is being taught yet, so the panel says what the face is showing
    // instead of counting a step.
    els.stepCounter.textContent = "Preview";
    els.stepTitle.textContent = state.look.name;
    els.stepInstruction.textContent =
      `This is the finished look on your own face, all of it at once. ${steps.length} steps get you there for real — start when you like what you see.`;
    els.stepTip.textContent =
      "Tip: hold “Hold to compare” to see your bare face underneath, and the intensity slider sets how strong the look sits.";
    els.prevBtn.disabled = false;
    els.prevBtn.textContent = "Back";
    els.nextBtn.textContent = "Begin →";
  } else {
    els.stepCounter.textContent = `Step ${state.stepIndex + 1} of ${steps.length}`;
    els.stepTitle.textContent = step.title;
    els.stepInstruction.textContent = step.instruction;
    els.stepTip.textContent = `Tip: ${step.tip}`;
    // Never disabled: back from the first step returns to the preview.
    els.prevBtn.disabled = false;
    els.prevBtn.textContent = "← Back";
    els.nextBtn.textContent =
      state.stepIndex === steps.length - 1 ? "Finish ✓" : "Next step →";
  }

  // Photo-derived looks get a zoomed reference crop for the current step, or
  // the whole reference face while previewing, where no region is singled out.
  const showReference =
    state.look.id === "photo" && state.photoImage && state.photoLandmarks;
  els.referenceWrap.classList.toggle("hidden", !showReference);
  els.refInsetWrap.classList.toggle("hidden", !showReference);
  els.refCaption.textContent = step
    ? "Reference photo, zoomed to this step — trace the outlined shape on your face"
    : "Reference photo — the whole look you are about to learn";
  if (showReference) {
    for (const canvas of [els.referenceCanvas, els.refInset]) {
      drawReferenceCrop(canvas, state.photoImage, state.photoLandmarks,
        step?.layer ?? null, blushStyleFor());
    }
  }
}

// ---------- Mirror mode ----------

function setMirrorMode(on) {
  state.mirrorMode = on;
  document.body.classList.toggle("mirror-mode", on);
  els.mirrorBtn.textContent = on ? "Exit mirror mode" : "🪞 Mirror mode";
  refreshHud();
}


// Suggestions that are not steps to paint: things to wear.
function refreshAdvice() {
  const look = state.photoLook;
  const obs = look?.observed;
  const items = [];
  if (obs) {
    if (obs.lashDrama > 0.45) {
      items.push({
        icon: "👁️",
        title: "Dramatic lashes",
        text: "The lash line in your reference is much denser than bare lashes. That is either a strip of falsies or several coats of mascara on curled lashes — from a photo the two look the same, so try mascara first and add a half-strip on the outer corner if you want more.",
      });
    } else if (obs.lashDrama > 0.25) {
      items.push({
        icon: "👁️",
        title: "Defined lashes",
        text: "Your reference has noticeably darker lashes than bare ones. Curl, then two coats of mascara worked into the roots should get you there without falsies.",
      });
    }
    const lens = lensAdvice(obs.eyes, state.myEyes);
    if (lens) {
      const bits = [];
      if (lens.enlarged) {
        bits.push("the iris takes up more of the eye than yours does, which is what circle lenses do");
      }
      if (lens.recoloured) {
        bits.push("the iris colour is not close to your own");
      }
      items.push({
        icon: "🔮",
        title: "Contact lenses",
        swatch: `rgb(${Math.round(lens.color.r)},${Math.round(lens.color.g)},${Math.round(lens.color.b)})`,
        text: `Some of this look is the eyes themselves, not makeup: ${bits.join(", and ")}. The swatch is the shade measured from your reference. Only ever wear lenses fitted by an optometrist — cosmetic lenses sit on the cornea and ill-fitting ones scratch it.`,
      });
    }
  }
  state.advice = items;
  els.advicePanel.classList.toggle("hidden", items.length === 0);
  els.adviceList.textContent = "";
  for (const item of items) {
    const li = document.createElement("li");
    const h = document.createElement("p");
    h.className = "advice-title";
    if (item.swatch) {
      const sw = document.createElement("span");
      sw.className = "advice-swatch";
      sw.style.background = item.swatch;
      h.appendChild(sw);
    }
    h.appendChild(document.createTextNode(`${item.icon} ${item.title}`));
    const body = document.createElement("p");
    body.className = "advice-text";
    body.textContent = item.text;
    li.append(h, body);
    els.adviceList.appendChild(li);
  }
}

function refreshZoomBtn() {
  els.zoomBtn.textContent = state.zoomToStep
    ? "🔍 Zoom: following the step"
    : "🔍 Zoom: whole face";
  els.zoomBtn.classList.toggle("active-toggle", state.zoomToStep);
}

function refreshHud() {
  if (!state.mirrorMode) return;
  const step = state.tutorialMode && !state.previewing
    ? state.look.steps[state.stepIndex]
    : null;
  let chip = state.look.name;
  if (step) chip = `${state.stepIndex + 1}/${state.look.steps.length} · ${step.title}`;
  else if (state.tutorialMode) chip = `Preview · ${state.look.name}`;
  els.hudChip.textContent = chip;
  // The arrows stay up during the preview: a tap forward is what begins it.
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
    refreshAdvice();
    state.tutorialMode = true;
    state.previewing = true;
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
    // Every tutorial opens on the preview of the finished look.
    state.previewing = state.tutorialMode;
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

  els.zoomBtn.addEventListener("click", () => {
    state.zoomToStep = !state.zoomToStep;
    refreshZoomBtn();
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
  sizeCanvas();
}

/**
 * Rendering above the size the canvas is displayed at is wasted fill rate,
 * and fill rate is what makes a phone hot. Match the display, capped so a
 * desktop does not push the per-frame cost up for no visible gain.
 */
const MAX_RENDER_WIDTH = 720;

function sizeCanvas() {
  const vw = els.video.videoWidth || 960;
  const vh = els.video.videoHeight || 720;
  const displayed = els.canvas.clientWidth * (window.devicePixelRatio || 1);
  const target = Math.max(320, Math.min(vw, MAX_RENDER_WIDTH, displayed || vw));
  const width = Math.round(target);
  const height = Math.round((vh / vw) * width);
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
  }
}

// A mirror does not need to redraw at a phone's full refresh rate. Half
// the frames is half the work and half the heat, and at this cadence the
// difference is not visible.
const FRAME_INTERVAL_MS = 1000 / 30;
let lastFrameAt = 0;

function frameLoop(time) {
  if (!state.running) return;

  // Nothing to show while the page is hidden; keep the loop alive but idle.
  if (document.hidden) {
    requestAnimationFrame(frameLoop);
    return;
  }
  if (time - lastFrameAt < FRAME_INTERVAL_MS) {
    requestAnimationFrame(frameLoop);
    return;
  }
  lastFrameAt = time;

  if (els.video.currentTime !== lastVideoTime) {
    lastVideoTime = els.video.currentTime;
    try {
      lastResult = faceLandmarker.detectForVideo(els.video, performance.now());
    } catch {
      lastResult = null;
    }
  }

  const landmarks = lastResult?.faceLandmarks?.[0] ?? null;

  if (landmarks && !state.myEyes) {
    try {
      state.myEyes = readEyes(els.video, landmarks, els.canvas.width, els.canvas.height);
      if (state.myEyes && state.photoLook) refreshAdvice();
    } catch {
      state.myEyes = null;
    }
  }

  // The preview has no current step, which is exactly what paints the whole
  // look with nothing highlighted and nothing zoomed.
  const step = state.tutorialMode && !state.previewing
    ? state.look.steps[state.stepIndex]
    : null;

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
    blushStyle: blushStyleFor(),
    zoomLayer: state.zoomToStep && step ? step.layer : null,
    compare: state.compare,
    ghost,
    time,
  });

  // Never stomp an error message (e.g. from a failed photo upload); those
  // clear themselves after a few seconds.
  if (!els.status.classList.contains("error")) {
    if (!landmarks) {
      setStatus("No face detected — center your face in the frame.");
    } else if (renderer.withheld > 0) {
      // Say why half a guide went missing, or turning your head looks like
      // the app losing track of you.
      setStatus("One side of your face is turned away or out of frame — "
        + "its guide is hidden until you can see it to work on it.");
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
  // The panel was covering the canvas; now it has its real displayed size.
  sizeCanvas();
  window.addEventListener("resize", sizeCanvas);
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
  buildBlushRow();
  bindControls();
  refreshZoomBtn();
  refreshTutorial();
  els.startBtn.addEventListener("click", start);
  // Expose a minimal hook for smoke tests.
  window.__app = { state, looks: LOOKS, layerOrder: LAYER_ORDER };
}

init();
