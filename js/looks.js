// Preset makeup looks and their step-by-step tutorials.
//
// Layer settings: color is a hex string, amount is 0..1 relative strength.
// Layers render in the order listed in LAYER_ORDER.

export const LAYER_ORDER = [
  "foundation",
  "contour",
  "brows",
  "eyeshadow",
  "lowerLid",
  "outerCorner",
  "eyeliner",
  "linerWing",
  "linerLower",
  "innerCorner",
  "aegyoSal",
  "underEyeShade",
  "lashes",
  "lowerLashes",
  "lenses",
  "blush",
  "lipstick",
];

/**
 * Named blush placements. Where blush sits changes the face as much as its
 * colour does, so each look picks one and the wearer can try the others.
 */
export const BLUSH_STYLES = [
  { id: "apples", name: "Apples", hint: "The classic: round, on the apples, blended toward the temple." },
  { id: "draping", name: "Draping", hint: "Swept from cheek up to the temple, doing the job of a blush and a contour at once." },
  { id: "eyeEnlarging", name: "Eye-enlarging", hint: "Sitting right under the lower lid, which pushes the eye open." },
  { id: "rabbit", name: "Rabbit", hint: "Under the eyes and across the nose bridge — flushed and youthful." },
  { id: "cheekbones", name: "High cheekbones", hint: "Round and high on the bone, with a touch on the nose tip." },
  { id: "sunkissed", name: "Sunkissed", hint: "One band running cheek to cheek across the nose." },
];

export const LOOKS = [
  {
    id: "natural",
    name: "Natural / Everyday",
    description: "A barely-there look that evens skin and adds a healthy flush. The best place to start if you're new to makeup.",
    layers: {
      foundation: { color: "#f0cdb4", amount: 0.18 },
      brows: { color: "#6b5140", amount: 0.3 },
      eyeshadow: { color: "#c19a86", amount: 0.3 },
      eyeliner: { color: "#5c4436", amount: 0.4 },
      blush: { color: "#e8a48f", amount: 0.32 },
      lipstick: { color: "#c58a80", amount: 0.45 },
    },
    steps: [
      {
        layer: "foundation",
        title: "Prep & even the skin",
        instruction: "Start with moisturizer, then apply a light layer of tinted moisturizer or BB cream. Dot it on your forehead, cheeks, nose and chin, then blend outward with fingertips or a damp sponge.",
        tip: "Less is more — you want skin to still look like skin.",
      },
      {
        layer: "brows",
        title: "Groom the brows",
        instruction: "Brush brows upward with a spoolie. Fill sparse spots with short, hair-like strokes using a pencil one shade lighter than your hair. Follow the highlighted shape.",
        tip: "Start filling from the arch outward; keep the inner edge soft.",
      },
      {
        layer: "eyeshadow",
        title: "Wash of neutral shadow",
        instruction: "Sweep a single warm neutral shade across the whole lid, staying inside the highlighted area. Blend upward into the crease with a fluffy brush so there are no hard edges.",
        tip: "Tap excess powder off the brush before it touches your lid.",
      },
      {
        layer: "eyeliner",
        title: "Tightline the lashes",
        instruction: "Draw a thin brown line as close to the upper lash line as possible — the highlighted line on your face. Wiggle the pencil between lashes rather than drawing one stroke.",
        tip: "Brown reads softer than black for daytime.",
      },
      {
        layer: "blush",
        title: "Blush on the apples",
        instruction: "Smile to find the apples of your cheeks — the highlighted circles. Tap blush there and blend up toward your temples in light strokes.",
        tip: "Build in two sheer layers instead of one heavy one.",
      },
      {
        layer: "lipstick",
        title: "Finish the lips",
        instruction: "Apply a your-lips-but-better shade straight from the bullet or with a finger, staying inside the highlighted lip line. Blot once with a tissue.",
        tip: "Dab color in with a fingertip for the most natural finish.",
      },
    ],
  },
  {
    id: "soft-glam",
    name: "Soft Glam",
    description: "Warm shimmery lids, sculpted cheeks and a rosy lip — polished but wearable, great for dinners and events.",
    layers: {
      foundation: { color: "#eec3a6", amount: 0.22 },
      contour: { color: "#b58a70", amount: 0.4 },
      brows: { color: "#5a4334", amount: 0.4 },
      eyeshadow: { color: "#a9704a", amount: 0.5 },
      eyeliner: { color: "#33251c", amount: 0.6 },
      blush: { color: "#dc8f83", amount: 0.4 },
      lipstick: { color: "#b06f6c", amount: 0.6 },
    },
    steps: [
      {
        layer: "foundation",
        title: "Full-coverage base",
        instruction: "Apply foundation with a damp sponge, starting at the center of the face and blending outward. Set your T-zone with a light dusting of powder.",
        tip: "Match your foundation at your jawline, not your wrist.",
      },
      {
        layer: "contour",
        title: "Sculpt the cheekbones",
        instruction: "Suck in your cheeks to find the hollow beneath the bone, then sweep a cool-toned contour along the highlighted line, starting at your ear and stopping level with the outer corner of your eye.",
        tip: "Stop the contour before it reaches the corner of your mouth — going further drags the face down.",
      },
      {
        layer: "brows",
        title: "Define the brows",
        instruction: "Outline the lower edge of the brow inside the highlighted shape, then fill with strokes and blend with a spoolie. Clean the edges with a little concealer.",
        tip: "The tail of the brow should align with the corner of your nose and eye.",
      },
      {
        layer: "eyeshadow",
        title: "Warm crease + shimmer lid",
        instruction: "Blend a warm brown through the crease using windshield-wiper motions in the highlighted zone. Pat a shimmer shade on the center of the lid with your finger.",
        tip: "Blend the crease color before adding shimmer so edges stay soft.",
      },
      {
        layer: "eyeliner",
        title: "Soft winged liner",
        instruction: "Draw a line along the upper lash line, thickening slightly toward the outer corner, and flick up at a small angle following the highlight.",
        tip: "Use short dashes first, then connect them.",
      },
      {
        layer: "blush",
        title: "Sculpt and flush",
        instruction: "Apply blush slightly higher than the apples — on the highlighted area over the cheekbones — and blend back toward the hairline for lift.",
        tip: "A tiny bit of blush on the bridge of the nose ties the look together.",
      },
      {
        layer: "lipstick",
        title: "Rosy satin lip",
        instruction: "Line lips just at your natural edge, then fill with a rosy satin lipstick inside the highlighted area. Press lips together and tidy corners.",
        tip: "Lip liner all over the lip makes lipstick last much longer.",
      },
    ],
  },
  {
    id: "smokey",
    name: "Smokey Eye",
    description: "The classic evening look: deep blended shadow and bold liner with a muted lip so the eyes do the talking.",
    layers: {
      foundation: { color: "#ecc0a4", amount: 0.2 },
      contour: { color: "#a8806a", amount: 0.36 },
      brows: { color: "#4a3729", amount: 0.45 },
      eyeshadow: { color: "#544c52", amount: 0.62 },
      eyeliner: { color: "#1a171c", amount: 0.75 },
      linerLower: { color: "#221d24", amount: 0.55 },
      blush: { color: "#cf948a", amount: 0.28 },
      lipstick: { color: "#b98f85", amount: 0.4 },
    },
    steps: [
      {
        layer: "foundation",
        title: "Base and under-eye prep",
        instruction: "Apply foundation, then an extra thin layer of concealer under the eyes — smokey shadow can drop fallout, and a clean base makes cleanup easy.",
        tip: "Do your eyes before your base if you're worried about fallout.",
      },
      {
        layer: "contour",
        title: "Quiet sculpting",
        instruction: "Add a soft contour along the highlighted line under the cheekbones to give the face structure that holds up against a dark eye, then blend the edges upward until no line remains.",
        tip: "Under warm evening light, blend contour further than you think you need to.",
      },
      {
        layer: "brows",
        title: "Strong brows",
        instruction: "A smokey eye needs structure: fill brows fully inside the highlighted shape, slightly darker and sharper than you would for daytime.",
        tip: "Set them with brow gel so they last the night.",
      },
      {
        layer: "eyeshadow",
        title: "Build the smoke",
        instruction: "Pack a deep shade on the lid inside the highlight, then blend the edge upward and outward with a clean fluffy brush. Repeat in thin layers: pack, blend, pack, blend.",
        tip: "The secret to smokey is blending the edge until there is no edge.",
      },
      {
        layer: "eyeliner",
        title: "Smudged black liner",
        instruction: "Draw thick black liner along the highlighted lash line, then smudge it with a small brush before it sets so it melts into the shadow above.",
        tip: "A kohl pencil smudges better than liquid liner.",
      },
      {
        layer: "linerLower",
        title: "Smoke the lower lash line",
        instruction: "Work the same pencil along the outlined lower lash line, from the outer corner in toward the middle, then smudge it upward to meet the shadow so the eye is ringed rather than outlined.",
        tip: "Leave the inner third bare — carrying it all the way in shrinks the eye.",
      },
      {
        layer: "blush",
        title: "Quiet cheeks",
        instruction: "Keep cheeks minimal — a light dusting on the highlighted area, more of a contour tone than a pop of color.",
        tip: "When eyes are dark, everything else whispers.",
      },
      {
        layer: "lipstick",
        title: "Nude balance",
        instruction: "Finish with a muted nude inside the lip highlight. Blot it down so it's a stain rather than a statement.",
        tip: "Pick a nude one shade deeper than your natural lip so you don't look washed out.",
      },
    ],
  },
  {
    id: "puppy-liner",
    name: "Korean Everyday Eye",
    description: "The soft Korean eye, in the order the tutorials actually teach it: a wash of pink-brown over the lid and under the lower lashes, depth wrapped around the outer corner, a fine line and a low tail, then shimmer at the inner corner and along the aegyo-sal. Nothing harsh — every step is about opening the eye.",
    blushStyle: "eyeEnlarging",
    layers: {
      foundation: { color: "#f4d3bd", amount: 0.2 },
      brows: { color: "#7a5b45", amount: 0.32 },
      eyeshadow: { color: "#cd9a83", amount: 0.42 },
      lowerLid: { color: "#c99182", amount: 0.34 },
      outerCorner: { color: "#a2685c", amount: 0.4 },
      eyeliner: { color: "#4a3128", amount: 0.62 },
      linerWing: { color: "#4a3128", amount: 0.6 },
      linerLower: { color: "#6b4a3a", amount: 0.4 },
      innerCorner: { color: "#fff2e8", amount: 0.5 },
      aegyoSal: { color: "#fff0e4", amount: 0.38 },
      underEyeShade: { color: "#c2a091", amount: 0.3 },
      lashes: { color: "#2c211c", amount: 0.7 },
      lowerLashes: { color: "#3a2c25", amount: 0.5 },
      blush: { color: "#e79b90", amount: 0.34 },
      lipstick: { color: "#c9757a", amount: 0.5 },
    },
    steps: [
      {
        layer: "foundation",
        title: "Dewy, light base",
        instruction: "Keep skin looking like skin: a thin layer of light-coverage foundation or cushion, pressed on with a damp sponge. Powder only where you get shiny.",
        tip: "This look leans dewy — resist mattifying the whole face.",
      },
      {
        layer: "brows",
        title: "Soft straight brows",
        instruction: "Brush the hairs up and out, then fill with light feathery strokes following the outlined shape, keeping the brow flatter and more horizontal than an arched shape.",
        tip: "A shade lighter than your hair is what keeps the whole look gentle.",
      },
      {
        layer: "eyeshadow",
        title: "Wash the lid in pink-brown",
        instruction: "Take a pink-brown over a large area of the lid, working from the lash roots outward and upward inside the outlined band. This is a base, not a defined shape — it should have no edge you can point to.",
        tip: "Build it in several light passes; one heavy pass is what creates a visible edge.",
      },
      {
        layer: "lowerLid",
        title: "Carry it under the lower lashes",
        instruction: "Sweep the same shade along the outlined area under your lower lashes, heaviest at the outer third and fading before the inner corner. This is what makes the eye look larger rather than just lined.",
        tip: "Use whatever is left on the brush — the lower lid needs far less than the lid.",
      },
      {
        layer: "outerCorner",
        title: "Deepen the outer corner",
        instruction: "With a deeper shade on a small brush, press colour into the outlined outer corner, joining the lid and the lower lid so the two wrap around into a soft V.",
        tip: "Small amounts, many times. Deepening the outer corner is the single step that shapes the eye.",
      },
      {
        layer: "eyeliner",
        title: "Line the upper lashes",
        instruction: "Draw a fine line along the outlined upper lash line, hugging the roots, and fill any pale gaps between the lashes. Keep it thin at the inner corner and let it thicken slightly outward.",
        tip: "Brown, not black — black is what tips this look from soft into severe.",
      },
      {
        layer: "linerWing",
        title: "Pull the tail out low",
        instruction: "From the highest point of your eye, draw the liner back and outward along the outlined tail, following your own eye shape and lifting only very slightly at the end.",
        tip: "Draw it with your eye open and looking straight ahead, or it sits wrong once you stop squinting.",
      },
      {
        layer: "linerLower",
        title: "Lower lash line",
        instruction: "Run a fine line under the outer half of your lower lashes, following the outline, and join it to the tail at the corner. Stop around the middle — never carry it to the inner corner.",
        tip: "Soften it immediately with a cotton bud; a crisp line under the eye reads harsh.",
      },
      {
        layer: "innerCorner",
        title: "Brighten the inner corner",
        instruction: "Press a pearly shimmer into the small outlined patch at the inner corner of each eye. It takes almost nothing, and it is what makes the eyes look further apart and awake.",
        tip: "Pat with a fingertip or a tiny flat brush — a fluffy brush scatters it everywhere.",
      },
      {
        layer: "aegyoSal",
        title: "Light up the aegyo-sal",
        instruction: "Smile to find the ridge that puffs up under your lower lashes, then press shimmer along the outlined band on top of it. This is the step that gives the rounded, smiling eye.",
        tip: "Highlight only the part that actually rises when you smile, or it reads as puffiness.",
      },
      {
        layer: "underEyeShade",
        title: "Shade beneath the ridge",
        instruction: "Draw the faintest cool taupe line along the lower outlined curve, just under the ridge, and blend until it is barely a shadow. The shadow is what gives the highlight its roundness.",
        tip: "Cool taupe, never warm brown — warm tones here read as a dark circle.",
      },
      {
        layer: "lashes",
        title: "Curl and coat the upper lashes",
        instruction: "Clamp the curler at the roots for a few seconds and walk it out to the tips, then coat from the base upward, wiggling into the roots and concentrating the outer third.",
        tip: "If you want more, a half-strip of falsies on the outer corner is far easier to place than a full strip.",
      },
      {
        layer: "lowerLashes",
        title: "Define the lower lashes",
        instruction: "Take the wand vertically and touch each lower lash separately, following the short fan shown on your face. Keep them fine and separated rather than heavy.",
        tip: "A smaller wand, or the tip of a used one, gives you far more control down here.",
      },
      {
        layer: "blush",
        title: "Blush under the eyes",
        instruction: "This look uses eye-enlarging placement: keep the colour high and close to the lower lid, inside the outlined area, rather than down on the apples. Tap it on and blend outward gently.",
        tip: "Try the other placements in the panel — where blush sits changes the face more than which pink you use.",
      },
      {
        layer: "lipstick",
        title: "Blurred gradient lip",
        instruction: "Press a rosy tint into the centre of the lips with your finger and blend outward, letting the colour fade before the edge instead of lining it.",
        tip: "A blurred edge is the gradient lip; a defined edge is a different look entirely.",
      },
    ],
  },
  {
    id: "bold",
    name: "Bold Lip",
    description: "Clean minimal eyes with one show-stopping red lip. Deceptively simple — precision is the skill you'll practice here.",
    layers: {
      foundation: { color: "#f0c8ac", amount: 0.2 },
      brows: { color: "#5a4536", amount: 0.35 },
      eyeshadow: { color: "#cfa892", amount: 0.22 },
      eyeliner: { color: "#2b211a", amount: 0.5 },
      blush: { color: "#dfa08c", amount: 0.25 },
      lipstick: { color: "#c0243a", amount: 0.8 },
    },
    steps: [
      {
        layer: "foundation",
        title: "Flawless matte base",
        instruction: "A bold lip magnifies everything else, so blend foundation carefully and set it with powder. Check blending at the jaw and around the nose.",
        tip: "Natural light is the most honest mirror.",
      },
      {
        layer: "brows",
        title: "Tidy brows",
        instruction: "Brush up and lightly fill inside the highlighted shape — groomed but not dramatic. The lip is the star.",
        tip: "Clear brow gel alone may be enough here.",
      },
      {
        layer: "eyeshadow",
        title: "Skin-tone lid",
        instruction: "Sweep a matte shade barely deeper than your skin across the highlighted lid, just to even out the eyelid tone.",
        tip: "This 'non-look' makes the whole face look intentional.",
      },
      {
        layer: "eyeliner",
        title: "Thin classic line",
        instruction: "One thin, neat line along the upper lashes following the highlight. No wing needed — stop at the outer corner.",
        tip: "Rest your elbow on a table for a steadier hand.",
      },
      {
        layer: "blush",
        title: "Just a whisper",
        instruction: "The lightest touch of neutral blush on the highlighted zone, blended high on the cheekbone.",
        tip: "If you can clearly see the blush, it's too much for this look.",
      },
      {
        layer: "lipstick",
        title: "The red lip",
        instruction: "Line your lips carefully following the highlighted edge — start at the cupid's bow. Fill with red lipstick, blot, and apply a second layer. Clean edges with concealer on a flat brush.",
        tip: "Blue-toned reds make teeth look whiter.",
      },
    ],
  },
];

export function getLook(id) {
  return LOOKS.find((look) => look.id === id) ?? LOOKS[0];
}
