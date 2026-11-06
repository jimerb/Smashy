# Runtime notices

The production build collects notice files from packages actually bundled into the player and emits `LICENSES.txt`. Smashy artwork and procedurally synthesized sound are documented separately in the asset guide.

The `@pixi/colord` 2.9.6 package declares MIT and the `omgovich/colord` repository but omits the notice file from its npm payload. [colord-MIT.txt](colord-MIT.txt) preserves the upstream [v2.9 notice](https://github.com/omgovich/colord/blob/v2.9/LICENSE.md), retrieved November 5, 2026. The build fallback is limited to that exact package/version.
