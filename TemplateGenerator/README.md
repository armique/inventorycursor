# TemplateGenerator

Premium template editor scaffold for product cards and visual assets. Built as a standalone Next.js 15 app inside the monorepo for future integration with the main inventory application.

## Stack

- **Next.js 15** — App Router, TypeScript, Turbopack
- **Tailwind CSS** — utility-first styling with custom dark theme
- **shadcn/ui** — accessible component primitives
- **Framer Motion** — layout and entrance animations
- **Zustand** — client state management
- **Lucide React** — icon system
- **react-dropzone** — file upload (wired in future)
- **html-to-image** — export pipeline (wired in future)

## Project Structure

```
src/
├── app/              # Next.js App Router (layout, page, globals)
├── components/       # Shared UI and layout components
│   ├── layout/       # App shell, structural layout
│   └── ui/           # shadcn/ui primitives
├── editor/           # Left panel — layers, properties, assets, themes
├── preview/          # Right panel — canvas preview and zoom controls
├── themes/           # Theme presets and palette definitions
├── hooks/            # React hooks and Zustand stores
├── lib/              # Utilities, constants, helpers
├── assets/           # Static assets (images, fonts, icons)
└── types/            # Shared TypeScript types
```

## Layout

Two-column editor shell:

| Column | Width | Purpose |
|--------|-------|---------|
| Left (Editor) | 420px fixed | Panel navigation, layers, properties |
| Right (Preview) | flex-1 | Canvas preview with grid background |

Background: `#0B1020`

## Getting Started

```bash
cd TemplateGenerator
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** If you see `EPERM` errors on Windows, stop all Node processes and delete the `.next` / `.next-build` folders inside `TemplateGenerator/`, then run `npm run dev` again. The project uses `.next-build` as `distDir` to avoid conflicts with a locked default `.next` cache.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## Integration Notes

This module is intentionally isolated under `TemplateGenerator/` so it can be:

1. Developed and tested independently
2. Merged into the main Vite app as a micro-frontend or route
3. Deployed as a separate Vercel project

Future work: wire editor panels, dropzone uploads, html-to-image export, and theme application.
