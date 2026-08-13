// Preset makeup looks and their step-by-step tutorials.
//
// Layer settings: color is a hex string, amount is 0..1 relative strength.
// Layers render in the order listed in LAYER_ORDER.

export const LAYER_ORDER = [
  "foundation",
  "contour",
  "brows",
  "eyeshadow",
  "eyeliner",
  "blush",
  "lipstick",
];

export const LOOKS = [
  {
    id: "natural",
    name: "Natural / Everyday",
    description: "A barely-there look that evens skin and adds a healthy flush. The best place to start if you're new to makeup.",
    layers: {
      foundation: { color: "#e8b89a", amount: 0.35 },
      brows: { color: "#5b4232", amount: 0.4 },
      eyeshadow: { color: "#c98d6b", amount: 0.35 },
      eyeliner: { color: "#4a3427", amount: 0.35 },
      blush: { color: "#e88a7a", amount: 0.45 },
      lipstick: { color: "#c96f6b", amount: 0.5 },
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
      foundation: { color: "#e5ad8c", amount: 0.5 },
      brows: { color: "#4c3728", amount: 0.55 },
      eyeshadow: { color: "#b0653f", amount: 0.55 },
      eyeliner: { color: "#2e2018", amount: 0.55 },
      blush: { color: "#e0766a", amount: 0.55 },
      lipstick: { color: "#b85560", amount: 0.65 },
    },
    steps: [
      {
        layer: "foundation",
        title: "Full-coverage base",
        instruction: "Apply foundation with a damp sponge, starting at the center of the face and blending outward. Set your T-zone with a light dusting of powder.",
        tip: "Match your foundation at your jawline, not your wrist.",
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
      foundation: { color: "#e2a988", amount: 0.5 },
      brows: { color: "#3c2b1f", amount: 0.6 },
      eyeshadow: { color: "#4a3648", amount: 0.7 },
      eyeliner: { color: "#14100d", amount: 0.8 },
      blush: { color: "#c97f6f", amount: 0.35 },
      lipstick: { color: "#b98a80", amount: 0.45 },
    },
    steps: [
      {
        layer: "foundation",
        title: "Base and under-eye prep",
        instruction: "Apply foundation, then an extra thin layer of concealer under the eyes — smokey shadow can drop fallout, and a clean base makes cleanup easy.",
        tip: "Do your eyes before your base if you're worried about fallout.",
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
        instruction: "Draw thick black liner along the highlighted lash line, then smudge it with a small brush before it sets. Add liner to the outer third of the lower lash line too.",
        tip: "A kohl pencil smudges better than liquid liner.",
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
    id: "bold",
    name: "Bold Lip",
    description: "Clean minimal eyes with one show-stopping red lip. Deceptively simple — precision is the skill you'll practice here.",
    layers: {
      foundation: { color: "#e8b294", amount: 0.45 },
      brows: { color: "#543d2c", amount: 0.5 },
      eyeshadow: { color: "#d8b49a", amount: 0.25 },
      eyeliner: { color: "#241a14", amount: 0.5 },
      blush: { color: "#dd8474", amount: 0.3 },
      lipstick: { color: "#c22b3d", amount: 0.85 },
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
