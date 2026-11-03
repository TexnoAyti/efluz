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


## Clarity and contextual-help revision

The HD set under public/munfiz/v2 is rendered at 768px and cropped/resampled to 252x346: three source pixels per displayed pixel at the normal 84px character width. The static lossless frame loads first (~22KB). Nine animated poses use 48 frames over two seconds at 24fps: idle, walk, point, wave, sit, look, think, bow and victory. They load on demand. Reduced motion uses the HD static frame. Walking now follows actual displacement and direction; a persistent pose sequence survives walk-timer restarts. Opening help briefly waves, then thinks; finishing a contextual tour celebrates once.

Context includes the selected inner competition section, not just the top-level route. Default page tours include only known local actions, omit disabled controls and deduplicate controls by semantic key and target. A separate section-navigation tour explains other local tabs, excluding the active tab and avoiding the global category menu when local tabs exist. Global navigation remains in the first-visit tour only. Unknown controls receive no fabricated instructions. Each section has explicit explanations, relevant questions and, where appropriate, a checklist. Tour history is stored per account and per selected section.

The help panel keeps its main actions visible while long explanations and questions scroll. Current section changes reset the explanation and tour context. Match contacts, result review, table columns, view switches, round selection, local search and notifications now expose semantic help markers. Merely reading notifications is explicitly distinguished from confirming results.

Regression checks cover local-vs-global selection, active/disabled tabs, duplicate targets, route fallback and distinct localized explanations. Chromium at device scale factor3 was used on 320x568, 390x844 and 844x390 to verify HD images, changed explanations when switching fixtures/standings, unique local tour topics, on-screen Next actions and reduced motion without browser errors. Physical Telegram remains unverified.


## Roomy help and complete action catalog

The helper now opens as a modal sheet that uses the visible viewport and Telegram safe insets (up to 720px wide on desktop). It no longer subtracts 322px for a separate floating character. The character appears in the sheet header while the floating button is hidden. Background scrolling and interaction are paused, keyboard focus stays inside, and closing restores the background.

Three tabs separate explanation, all currently documented page controls, and related questions. The action catalog includes selected tabs and disabled controls with status labels, supports searching titles/descriptions and can highlight one chosen control. The main tours retain their page/section filtering but no longer truncate after five actions or six sections. Repeated instances of the same semantic action remain deduplicated. This exposes every documented control on the current rendered page; it does not invent instructions for unannotated controls or bypass permissions.

Validation adds 14-action/section regression cases and viewport-safe sheet bounds. Chromium checks cover 320x400, 390x600 and 844x390, 20px text, reaching the last catalog row, search, disabled-control explanations, focus trapping and background restoration. Previous DPR3 contextual tour tests also pass. Physical Telegram remains unverified.
