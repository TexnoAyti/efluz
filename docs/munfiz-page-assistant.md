# Munfiz page assistant

A floating, draggable samurai provides local help after authentication and the welcome screen. It uses the account's own minimized state and completed contextual-tour history. It makes no API calls, submits no scores and changes no permissions.

Tap the character to see the current destination's explanation, a tour of actual available controls, and the existing public FAQ. Competition categories publish semantic markers; common competition tabs expose their own controls. The tour reuses FirstVisitGuide with explicit steps and does not navigate away from the user's current page. Missing/disabled controls are excluded. The existing first-visit FAQ plus global seven-step tour remain intact.

The character considers visible actionable controls when choosing an edge, yields on outside control interaction, supports dragging and minimizes to a small button. It yields to dialogs and existing guides. The help panel and character occupy different areas. Idle walking pauses for reduced motion, hidden documents, open help, minimized state and other dialogs. Reduced motion uses a static render, including inside the contextual tour.

## Character provenance

Frames were rendered from the user's Munfiz 0.21.0 Android source, specifically SamuraiScene.java (meshes and articulated poses), Mat4.java, EmotionCatalog.java and the exact SamuraiRenderer.java GLES shaders, via the source project's render_samurai.py. No replacement character or generated imitation was used. The web assets are transparent 192px renders cropped and resized to 96x132, 12 frames per two-second loop, WebP quality75. States used: idle, walk, point and wave; still.webp is the reduced-motion fallback. Native shaders and poses were rendered in software GLES and baked for the web to avoid a persistent WebGL context inside the Mini App. This is a web rendering adaptation, not the Android overlay service.

## Validation

- TypeScript lint; production build and startup bundle budget.
- Existing localized FAQ/global tour checks plus a contextual-step render check.
- Munfiz placement tests for 320/390/844 widths, short screens, obstacle avoidance and page category isolation.
- Local Chromium tests of the actual React component on 320x568, 390x844 and 844x390: character tap and drag, panel/tour bounds, character clear of panel, minimize/restore, Escape and context switch; no browser errors.

Physical Android Telegram appearance and touch behavior remain unverified. Free-text AI and voice interaction are not part of this component.
