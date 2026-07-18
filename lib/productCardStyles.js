/**
 * Named Gemini product-card design styles (shared by API + client).
 */

export const DEFAULT_PRODUCT_CARD_STYLE_ID = 'apple-studio-white';

export const PRODUCT_CARD_STYLES = [
  {
    id: 'apple-studio-white',
    name: 'Apple Studio White',
    blurb: 'Pure white Apple-like minimalism, huge air, soft shadows',
    prompt: `STYLE NAME: Apple Studio White
Visual direction: Apple product marketing. Pure white (#FFFFFF) to soft cool-gray (#F5F5F7) seamless studio backdrop. Product centered, occupying ~60% of frame. Extremely generous negative space. Typography: large bold near-black sans-serif title at top; thin elegant secondary line; tiny muted gray captions. Specs as small refined labels with hairline separators — never boxes with heavy borders. Soft natural contact shadow under product only. No neon, no RGB, no watermarks, no logos of brands unless already on the product. Square 1:1 marketplace card. Premium, quiet, expensive.`,
  },
  {
    id: 'noir-editorial',
    name: 'Noir Editorial',
    blurb: 'Dark luxury magazine cover — charcoal, gold accent, drama',
    prompt: `STYLE NAME: Noir Editorial
Visual direction: Luxury tech magazine cover. Deep charcoal / near-black (#0E0E10) background with subtle vignette. Product lit with cinematic rim light and soft specular highlights. Typography: bold condensed white display title; thin gold (#C9A227) accent rule; elegant uppercase micro-labels for specs in off-white. Spec chips as translucent dark glass with thin gold edges. High contrast, dramatic but clean — not gaming neon. No clutter. Square 1:1. Feels expensive and exclusive.`,
  },
  {
    id: 'tech-spec-grid',
    name: 'Tech Spec Grid',
    blurb: 'Engineering datasheet — precise columns, monospace accents',
    prompt: `STYLE NAME: Tech Spec Grid
Visual direction: Precision engineering product sheet. Cool light gray background (#EEF1F4) with a faint subtle grid. Product centered in a clean white panel. Title in strong geometric sans. Specs arranged in a clear two-column key/value grid with thin rules, like a datasheet. Small accent color: electric blue (#2563EB) for section markers only. Monospace or technical feel for values. Minimal icons if any. No decorative fluff. Square 1:1. Looks trustworthy and technical for PC hardware listings.`,
  },
  {
    id: 'marketplace-hero',
    name: 'Marketplace Hero',
    blurb: 'Bold eBay/KA sales card — clear hierarchy, high conversion',
    prompt: `STYLE NAME: Marketplace Hero
Visual direction: High-converting German marketplace listing card (eBay.de / Kleinanzeigen). Clean white card with a strong top title band. Product large and centered. 3–5 short German-friendly USP pills below title (e.g. Geprüft, Versand DE) in solid dark slate — not rainbow. Specs in readable bold chips around the product without covering it. Clear visual hierarchy: NAME → product → key specs. Slight soft drop shadow on the whole composition optional. Friendly, commercial, crystal-clear at thumbnail size. Square 1:1. No watermarks.`,
  },
  {
    id: 'soft-nordic',
    name: 'Soft Nordic',
    blurb: 'Scandinavian calm — warm paper, muted sage, airy type',
    prompt: `STYLE NAME: Soft Nordic
Visual direction: Scandinavian product catalog. Warm off-white / paper (#F7F4EF) background with very soft sage or clay accent (#8FA89A). Product centered with gentle natural shadow. Typography: refined humanist sans, medium weight title, airy letter-spacing on small labels. Specs as quiet text lines, not loud badges. Calm, honest, handcrafted-premium feel. No neon, no chrome gradients, no busy patterns. Square 1:1 marketplace card.`,
  },
  {
    id: 'frosted-glass',
    name: 'Frosted Glass',
    blurb: 'Layered frosted panels, soft blur, modern translucent UI',
    prompt: `STYLE NAME: Frosted Glass
Visual direction: Modern translucent UI product card. Soft cool gradient backdrop (pale sky to light steel — NOT purple). Product floating above frosted-glass panels (semi-transparent white, subtle blur, thin white border, soft shadow). Title on a frosted bar. Specs on smaller glass chips. Clean sans typography. Ethereal but still readable for marketplace thumbnails. No heavy chrome, no gaming RGB. Square 1:1.`,
  },
  {
    id: 'industrial-mono',
    name: 'Industrial Mono',
    blurb: 'Swiss/industrial print — stark type, rules, utility aesthetic',
    prompt: `STYLE NAME: Industrial Mono
Visual direction: Swiss industrial / utility print. Stark white or light gray ground. Heavy black typographic hierarchy. Thin black horizontal rules. Product centered, almost catalog-photograph style. Specs as labeled blocks with uppercase micro-headers and bold values. Accent: single signal red (#DC2626) used sparingly for one key callout only. Zero decoration, zero gradients, zero rounded candy pills. Feels like a technical catalog plate. Square 1:1.`,
  },
  {
    id: 'steel-gradient',
    name: 'Steel Gradient',
    blurb: 'Cool steel-blue depth, modern tech without neon clutter',
    prompt: `STYLE NAME: Steel Gradient
Visual direction: Modern tech brochure. Smooth cool steel gradient background (slate-blue #1E293B → steel #64748B → soft silver highlights) — NOT purple, NOT neon. Product with crisp studio lighting and subtle reflection. White and light-silver typography. Specs in dark translucent rounded rectangles with thin silver borders. One cyan accent (#22D3EE) only for small bullets or a thin underline. Premium PC hardware vibe. Square 1:1.`,
  },
  {
    id: 'catalog-classic',
    name: 'Catalog Classic',
    blurb: 'Print catalog page — photo left/center, typed specs tidy',
    prompt: `STYLE NAME: Catalog Classic
Visual direction: Premium print retail catalog page adapted to square card. Cream-white page feel. Product photograph-style presentation with soft even lighting. Classic serif OR elegant sans for the product title; body specs in clean readable columns beneath or beside the product. Thin ornamental divider line under the title. Muted ink colors (charcoal, warm gray). Looks like a high-end electronics catalog, not a gamer poster. Square 1:1. Clear and timeless.`,
  },
  {
    id: 'blueprint-precision',
    name: 'Blueprint Precision',
    blurb: 'CAD blueprint mood — cyan lines, technical callouts',
    prompt: `STYLE NAME: Blueprint Precision
Visual direction: Technical blueprint / CAD presentation. Deep navy blueprint field (#0B1F3A) with faint cyan grid and construction lines. Product rendered cleanly in the center (realistic product, not a wireframe of the hardware). Title in white technical sans. Spec callouts as thin cyan leader lines to labeled boxes (key/value). Corner crop marks or small registration crosshairs optional and subtle. Feels engineered and precise. Avoid cluttered schematics that hide the product. Square 1:1.`,
  },
];

export function getProductCardStyle(id) {
  const found = PRODUCT_CARD_STYLES.find((s) => s.id === id);
  return found || PRODUCT_CARD_STYLES.find((s) => s.id === DEFAULT_PRODUCT_CARD_STYLE_ID);
}
