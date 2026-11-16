# ADR-005: Design system across web and mobile

- Status: Accepted (2026-11-16)

## Decision

- **Tokens are the single source** (`@hrm/design-tokens`): semantic colours for light/dark (hex, so
  React Native can use them), compact type scale (13 px body on web), 4 px spacing grid, radii,
  density modes (compact 30/34 px, comfortable 36/44 px control/row heights), motion durations.
  Every text/surface pair is unit-tested against WCAG AA (4.5:1 text, 3:1 focus ring).
- **Web:** tokens emitted as CSS custom properties (`tokens.css`); Tailwind 4 `@theme inline` maps
  them to utilities (`bg-primary`, `h-control`, `h-row`, …). Dark mode = `.dark` on `<html>`;
  density = `data-density`. Components in `@hrm/ui-web` follow shadcn/ui conventions on Radix
  primitives (unified `radix-ui` package), `class-variance-authority`, `tailwind-merge`, Lucide.
  Components are owned source code, not a runtime dependency on shadcn.
- **Mobile:** native primitives (`Text`, `Card`, `Button`, `StatusPill`) consume the same tokens via
  `useTheme()` following the OS appearance. **NativeWind is not used**: NativeWind 4 requires
  Tailwind 3 (the web uses Tailwind 4) and NativeWind 5 is a release candidate. The master prompt
  allows "NativeWind or reusable native components".
- **Data tables:** `DataTable` on **TanStack Table v9** (v8 is no longer maintained). Implemented in
  Phase 01: client/server pagination & sorting, row selection + bulk actions, column visibility,
  column resizing, sticky header, keyboard row navigation (↑ ↓ Home End Enter Space),
  loading/empty/error states, aria-sort/aria-busy. Planned with the first list-heavy module
  (Phase 03/04): filtering UI, global search wiring, column reordering, saved views, inline
  editing, export, context menus, virtualization for large pages.
- **Fonts:** Inter Variable self-hosted via `@fontsource-variable/inter` (no third-party CDN).
- **Motion:** CSS transitions only for now; Framer Motion (`motion`) is added when a feature needs
  orchestrated animation. `prefers-reduced-motion` is respected globally.
