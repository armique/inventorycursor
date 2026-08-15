/**
 * Named Gemini product-card design styles (shared by API + client).
 * Favorites kept: Apple Studio White, Noir Editorial, Industrial Mono, Steel Gradient, Premium Lifestyle – Light.
 */

export const DEFAULT_PRODUCT_CARD_STYLE_ID = 'premium-lifestyle-light';

export const PRODUCT_CARD_STYLES = [
  {
    id: 'apple-studio-white',
    name: 'Apple Studio White',
    shortName: 'Apple',
    blurb: 'Apple white + more copy with clean line icons',
    prompt: `STYLE NAME: Apple Studio White
Visual direction: Apple product marketing, but INFORMATION-RICH (not sparse).
Background: pure white (#FFFFFF) to soft cool-gray (#F5F5F7) seamless studio. Soft natural contact shadow under the product.
Layout: product centered (~50–55% of frame). Leave room for MORE text than a typical Apple ad.
Typography: large bold near-black sans title at top; short subtitle under it.
CONTENT DENSITY (important):
- Show 5–8 specification rows as readable text (label + value from the provided specs).
- Each spec row MUST include a small monochrome line icon (outline style, thin stroke) matching the spec — e.g. CPU chip, memory, storage disk, GPU, motherboard, power plug, wifi, checkmark for condition.
- Icons: simple black/gray line icons, Apple-like SF Symbols aesthetic — never colorful emoji, never 3D icons.
- Place specs in a clean vertical list or two tidy columns beside/under the product, with generous but not empty spacing.
- Optionally 2–3 short USP lines with small check icons (e.g. Geprüft, Versand DE) in muted gray.
Still premium and quiet: no neon, no RGB, no heavy bordered boxes, no watermarks. Square 1:1 marketplace card.`,
  },
  {
    id: 'noir-editorial',
    name: 'Noir Editorial',
    shortName: 'Noir',
    blurb: 'Dark luxury magazine — charcoal, gold accent, drama',
    prompt: `STYLE NAME: Noir Editorial
Visual direction: Luxury tech magazine cover. Deep charcoal / near-black (#0E0E10) background with subtle vignette. Product lit with cinematic rim light and soft specular highlights.
Typography: bold condensed white display title; thin gold (#C9A227) accent rule; elegant uppercase micro-labels for specs in off-white.
Specs: 4–7 key specs on translucent dark glass chips with thin gold edges; small refined gold/white line icons next to each label are welcome.
High contrast, dramatic but clean — not gaming neon. No clutter, no watermarks. Square 1:1. Feels expensive and exclusive.`,
  },
  {
    id: 'industrial-mono',
    name: 'Industrial Mono',
    shortName: 'Industrial',
    blurb: 'Swiss industrial print — stark type, rules, utility',
    prompt: `STYLE NAME: Industrial Mono
Visual direction: Swiss industrial / utility print. Stark white or light gray ground. Heavy black typographic hierarchy. Thin black horizontal rules. Product centered, catalog-photograph style.
Specs: labeled blocks with uppercase micro-headers and bold values. Small black line icons (technical pictograms) next to each header are encouraged.
Accent: single signal red (#DC2626) used sparingly for one key callout only.
Zero candy gradients, zero rounded gaming pills. Feels like a technical catalog plate. Square 1:1. No watermarks.`,
  },
  {
    id: 'steel-gradient',
    name: 'Steel Gradient',
    shortName: 'Steel',
    blurb: 'Steel depth + strong mirror reflection under product',
    prompt: `STYLE NAME: Steel Gradient
Visual direction: Modern tech brochure. Smooth cool steel gradient background (slate-blue #1E293B → steel #64748B → soft silver highlights) — NOT purple, NOT neon.
HERO EFFECT (critical): crisp studio lighting PLUS a strong, beautiful mirror/floor reflection under the product — glossy reflective plane, elegant fade of the reflection downward (like premium product CGI). This reflection is a signature of the style — make it prominent and clean.
Typography: white and light-silver. Specs in dark translucent rounded rectangles with thin silver borders; small cyan/silver line icons next to labels optional.
One cyan accent (#22D3EE) only for small bullets or a thin underline. Premium PC hardware vibe. Square 1:1. No watermarks.`,
  },
  {
    id: 'premium-lifestyle-light',
    name: 'Premium Lifestyle – Light',
    shortName: 'Lifestyle',
    blurb: 'Bright Scandinavian lifestyle — soft daylight, minimal, high-end',
    prompt: `You are a Senior Product Marketing Designer, Commercial Photographer, and AI Art Director.

Your task is to create premium marketplace product cards for computer hardware sold on eBay, Kleinanzeigen and online stores.

The final result must look like it was designed by a professional commercial design agency—not by AI.

====================================================
STYLE
====================================================

Style Name:
Premium Lifestyle – Light Edition

Design Goals:

• Premium
• Bright
• Minimal
• Elegant
• Modern
• Commercial
• Lifestyle
• High-End
• Trustworthy

The image should immediately stand out when viewed as a small thumbnail on a smartphone.

The product is always the hero.

====================================================
BACKGROUND
====================================================

Create a realistic premium lifestyle environment.

Examples:

• Bright Scandinavian home office
• Luxury workstation
• White desk
• Light oak furniture
• Soft daylight
• Large windows
• Modern architecture
• Minimal interior
• Premium office accessories
• Soft blurred laptop
• Small green plant
• White ceramic objects
• Glass
• Aluminum details

Everything except the product should remain softly blurred.

Never distract from the product.

====================================================
LIGHTING
====================================================

Natural daylight.

Soft window lighting.

Subtle reflections.

Realistic shadows.

Premium studio quality.

No harsh lighting.

No dramatic contrast.

The product should appear professionally photographed.

====================================================
PHOTO PROCESSING
====================================================

The uploaded product must remain EXACTLY as photographed.

Never redesign it.

Never repaint it.

Never change proportions.

Never recreate missing details.

Never modify labels.

Never modify logos.

Never change connector layout.

Never add missing components.

Never remove visible components.

Only improve:

• Background removal
• White balance
• Contrast
• Sharpness
• Exposure
• Shadow quality
• Perspective
• Dust removal

Preserve realistic wear and cosmetic condition.

====================================================
LAYOUT
====================================================

Canvas:
1:1

High resolution.

Product occupies approximately 70% of the composition.

Leave generous white space.

Everything should feel balanced.

====================================================
TEXT
====================================================

Minimal.

Never create long paragraphs.

Use only:

Product Name

4–6 short feature labels

Maximum 2–3 words each.

Examples:

✔ Tested

✔ Ready to Use

✔ DDR5

✔ PCIe 4.0

✔ SATA III

✔ 80+ Gold

✔ Modular

✔ VR Ready

✔ RGB

Avoid unnecessary marketing language.

====================================================
ICONS
====================================================

Icons should communicate information instead of text.

Use clean outline icons.

Simple.

Modern.

Consistent.

No colorful icons.

No emoji.

Icons should be more prominent than the text.

====================================================
TYPOGRAPHY
====================================================

Modern geometric sans-serif.

Bold title.

Medium feature labels.

Excellent readability.

Strong hierarchy.

Large spacing.

====================================================
COLOR PALETTE
====================================================

Primary:

White

Off White

Light Gray

Silver

Soft Beige

Secondary:

Very subtle brand accent only.

Examples:

Intel → Blue

AMD → Orange

NVIDIA → Green

ASUS → Dark Gray

MSI → Red

Corsair → Yellow

Never allow accent colors to dominate the composition.

====================================================
VISUAL LANGUAGE
====================================================

Think:

Apple

Bang & Olufsen

Dyson

ASUS ProArt

Nothing

Minimal Scandinavian branding

The design should communicate quality rather than excitement.

====================================================
PRODUCT CATEGORY ADAPTATION
====================================================

Automatically adapt the composition to the product.

Example:

GPU
→ Larger hero image
→ Cooling highlighted

Motherboard
→ Angled perspective
→ Socket and expansion slots visible

CPU
→ Premium macro product shot

RAM
→ Elegant diagonal placement

SSD
→ Floating minimal composition

Power Supply
→ Cable side partially visible

Complete PC
→ Hero tower
→ Soft RGB visible only if present

====================================================
FEATURE SELECTION
====================================================

Only display verified specifications.

Never invent specifications.

Priority:

1. User provided specifications

2. Official manufacturer specifications

3. Clearly visible information

If uncertain:

Leave it out.

Showing fewer correct specifications is always better than showing one incorrect specification.

====================================================
DESIGN RESTRICTIONS
====================================================

Avoid:

• Dark backgrounds
• Heavy gradients
• RGB explosions
• Gaming clichés
• Hexagons everywhere
• HUD graphics
• Overloaded infographics
• Large blocks of text
• Too many specifications
• Fake reflections
• Unrealistic lighting

====================================================
BRANDING
====================================================

Place a small style name in one corner.

Use exactly: Lumen

Do NOT write:

Design

Style

Edition

Only the style name.

====================================================
QUALITY STANDARD
====================================================

Before finalizing, verify:

• The product is the first thing the eye notices.
• The card remains readable as a small mobile thumbnail.
• Icons communicate information instantly.
• Text is minimal.
• Spacing is consistent.
• Nothing covers important parts of the product.
• Every specification shown is verified.
• The image feels premium enough to be used in a professional electronics store.

The final image should increase perceived value and click-through rate while maintaining complete visual honesty.`,
  },
];

export function getProductCardStyle(id) {
  const found = PRODUCT_CARD_STYLES.find((s) => s.id === id);
  return found || PRODUCT_CARD_STYLES.find((s) => s.id === DEFAULT_PRODUCT_CARD_STYLE_ID);
}
