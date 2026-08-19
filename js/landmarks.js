// MediaPipe Face Landmarker region definitions (478-point face mesh).
// All values are landmark indices; polygons are ordered loops.

export const LIPS_OUTER = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
  409, 270, 269, 267, 0, 37, 39, 40, 185,
];

export const LIPS_INNER = [
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308,
  415, 310, 311, 312, 13, 82, 81, 80, 191,
];

export const LEFT_EYE = [
  33, 7, 163, 144, 145, 153, 154, 155, 133,
  173, 157, 158, 159, 160, 161, 246,
];

export const RIGHT_EYE = [
  263, 249, 390, 373, 374, 380, 381, 382, 362,
  398, 384, 385, 386, 387, 388, 466,
];

export const LEFT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
export const RIGHT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];

// Upper lash lines, outer corner -> inner corner.
export const LEFT_LASH = [33, 246, 161, 160, 159, 158, 157, 173, 133];
export const RIGHT_LASH = [263, 466, 388, 387, 386, 385, 384, 398, 362];

// Lower lash lines, outer corner -> inner corner (same ordering as above,
// so the outer end is always index 0 for both eyes).
export const LEFT_LOWER_LASH = [33, 7, 163, 144, 145, 153, 154, 155, 133];
export const RIGHT_LOWER_LASH = [263, 249, 390, 373, 374, 380, 381, 382, 362];

// Iris ring: centre first, then four rim points. Present because the face
// landmarker refines irises — this is what makes lens colour and iris size
// measurable.
export const LEFT_IRIS = [468, 469, 470, 471, 472];
export const RIGHT_IRIS = [473, 474, 475, 476, 477];

// For each lash-line point, the brow point roughly above it. The eyeshadow
// band is built by lerping from the lash line toward these.
export const LEFT_LASH_BROW = [46, 46, 53, 52, 52, 65, 65, 55, 55];
export const RIGHT_LASH_BROW = [276, 276, 283, 282, 282, 295, 295, 285, 285];

// Blush anchors: a pair of points per cheek whose midpoint is the blush center.
export const LEFT_CHEEK = [205, 50];
export const RIGHT_CHEEK = [425, 280];

// Anchors the blush placements are laid out against.
export const LEFT_TEMPLE = 234;
export const RIGHT_TEMPLE = 454;
export const NOSE_BRIDGE = 6;
export const NOSE_TIP = 4;

// Face width reference (ear to ear) used to scale brush sizes.
export const FACE_WIDTH_REF = [234, 454];

// Contour strokes: each pair is [near-ear anchor, mouth-corner anchor];
// the shading stroke runs along a segment between them (see makeup.js).
export const LEFT_CONTOUR = [234, 61];
export const RIGHT_CONTOUR = [454, 291];

export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

export const MAX_LANDMARK_INDEX = 477;
