# Munfiz: direct page walkthrough

Tapping the samurai starts guidance immediately. The first card contains one short sentence explaining the current page/selected section. Show proceeds to the actual controls. Tapping a highlighted area or Next advances; Got it closes the last step. The floating character has no explanation/catalog/questions menu. Existing first-visit onboarding remains separate and unchanged.

Tutorial taps are read-only overlays. They do not navigate, submit results, confirm scores, modify settings or run the underlying button's handler. Escape and the close control end guidance. Focus containment and background inert/scroll restoration use the shared FirstVisitGuide implementation.

## Coverage and context

The route, current competition category and selected inner section determine the purpose. Known local action markers supply short, explicit control descriptions. Steps are deduplicated and uncapped; the currently selected section is already explained by the purpose card. Disabled controls remain explainable with a clear unavailable note. Parent categories are omitted when local tabs exist, avoiding a global menu loop. Unknown controls are not assigned fabricated instructions. Controls that disappear during a walkthrough are skipped after a brief recheck.

Additional semantic markers cover league selection, opening clubs/cards/match details, notification and match filters, and authorized team management. Fixture-open guidance prefers an explicitly highlighted own fixture when available. The walkthrough does not click into new sections or change permissions.

Cards choose above, below or—on wide short screens—a side placement so they do not cover the highlighted tap target. Short descriptions, a hand marker and a single Next/Show action keep the flow compact. The original global tour also benefits from non-overlapping placement.

## Character

The floating character remains draggable/minimizable per account and yields to dialogs and walkthroughs. The existing HD original-samurai WebP assets and reduced-motion static fallback are retained. Rendering and source provenance are from the user's Munfiz Android meshes, articulated poses and GLES shaders; these are web adaptations rather than the native Android overlay service. No voice or free-text AI is introduced.

## Validation

- TypeScript lint, production build/deployment checks and startup bundle budget.
- Existing FAQ/global tour checks plus direct-purpose, empty-selector, deduplication, uncapped-control and locked-state regressions.
- Geometry checks covering mobile and short landscape target separation.
- Actual React component in Chromium at DPR3 on 320x568, 390x844 and 844x390: one character tap opens the purpose, no help menu appears, target taps advance through distinct controls, the underlying page receives zero clicks, Next stays on screen, closing restores background interaction and changing to standings gives its own purpose. No browser errors.

Physical Telegram behavior remains unverified.
