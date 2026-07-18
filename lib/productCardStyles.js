/**
 * Named Gemini product-card design styles (shared by API + client).
 * Favorites kept: Apple Studio White, Noir Editorial, Industrial Mono, Steel Gradient.
 */

export const DEFAULT_PRODUCT_CARD_STYLE_ID = 'apple-studio-white';

export const PRODUCT_CARD_STYLES = [
  {
    id: 'apple-studio-white',
    name: 'Apple Studio White',
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
    blurb: 'Steel depth + strong mirror reflection under product',
    prompt: `STYLE NAME: Steel Gradient
Visual direction: Modern tech brochure. Smooth cool steel gradient background (slate-blue #1E293B → steel #64748B → soft silver highlights) — NOT purple, NOT neon.
HERO EFFECT (critical): crisp studio lighting PLUS a strong, beautiful mirror/floor reflection under the product — glossy reflective plane, elegant fade of the reflection downward (like premium product CGI). This reflection is a signature of the style — make it prominent and clean.
Typography: white and light-silver. Specs in dark translucent rounded rectangles with thin silver borders; small cyan/silver line icons next to labels optional.
One cyan accent (#22D3EE) only for small bullets or a thin underline. Premium PC hardware vibe. Square 1:1. No watermarks.`,
  },
];

export function getProductCardStyle(id) {
  const found = PRODUCT_CARD_STYLES.find((s) => s.id === id);
  return found || PRODUCT_CARD_STYLES.find((s) => s.id === DEFAULT_PRODUCT_CARD_STYLE_ID);
}
