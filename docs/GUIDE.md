# The doke guide

This is the guide to using, developing and hosting doke.

## Explore

The top navigation chooses **Brain**, **Synapse**, **Neural circuit** or **Messengers**. Each scene has its own lower dock. Drag to orbit, scroll or pinch to zoom, Shift-drag or right-drag to pan. Keyboard arrows rotate, +/− zoom, and Home resets the view. The ⋯ button opens display and camera tools.

| Scene          | Lower controls                                                       | What to look for                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brain          | Anatomy, Activities, Neurons                                         | Select a region or a study-led story. Neurons opens a small teaching window; Focus the cells zooms into it. Toggle Neurons again to restore the surface.                  |
| Synapse        | Play/pause, four stages, Focus cleft, Inspect messenger, explanation | Follow packaging, release, receptor action and clearance. Selecting a stage starts that stage's animation clock at zero. Pausing freezes it; playing resumes immediately. |
| Neural circuit | Play/pause, Send a signal, Tune the network, model evidence          | See the interaction of excitatory and inhibitory populations. Drive and coupling controls change the numerical model.                                                     |
| Messengers     | Dopamine, glutamate's conjugate acid, GABA, explanation              | Rotate sourced molecular conformers. Oxygen has a muted warm accent; nitrogen a blue accent. Atom letters remain available without color.                                 |

All explanations use the floating panel on the **left**. About, source records, anatomy regions, activity stories, messenger explanations and model evidence open as named tabs. Reopening an item reuses its tab. Select an earlier tab to return; its reading position is preserved. The × button closes the current tab and returns to the document that opened it; the downward chevron hides the panel without discarding its tabs. Arrow keys, Home and End navigate the tab strip, which scrolls horizontally when needed. Only one document is visible, and tools automatically dismiss the reader on narrow screens. Scene changes hide the reader; its open tabs remain available. Animation updates do not replace a source being read.

## Silicon

Choose **Silicon ↗** in the brain navigation, or open `silicon.html`. CPU, GPU and Tensor process the same painted 8 × 8 image using a fixed difference filter. Run animates execution; Step advances one declared model tick; ⇥ calculates the completed result. Drag or use arrow keys to orbit; scroll or +/− zoom. Select a block to inspect its current state. Source records stay in the same floating tab panel.

Change Packed to Strided on GPU to see memory-sector traffic change while the answer stays the same. Toggle the CPU’s tiny cache to expose operand reuse. Tensor shows operands passing through a 4 × 4 array. In Switch ASIC, block A, inject traffic to A and B, then compare FIFO with per-destination VOQ. Queue changes preserve packets; the 32-packet capacity includes in-flight transfers. Reset clears the experiment.

Reference selections show documented product facts. The small models demonstrate mechanisms, not proprietary layouts or timing. Model ticks, bytes and packet counts describe the explicit teaching rules. They are not benchmarks, die floorplans, a CPU instruction emulator or an execution trace captured on the named product. The [research and roadmap](SILICON.md) records the primary sources and next steps.

The standalone silicon page does not need generated anatomy. For a quick hardware-only preview, build Wasm with `cargo build -p doke-web --target wasm32-unknown-unknown --release --locked`, run the matching `wasm-bindgen` command from `tools/build.sh`, then serve `public/`. Use the complete setup below for the human brain and all original scenes.

## Neurons and scientific interpretation

The optional tissue window contains four procedural branching neurons, dendritic spines, axonal terminals, receiving processes and visible contact gaps. It occupies a localized area of the reference brain and is off initially. The cells are deliberately enlarged; **their positions, numbers, shapes and connectivity do not come from the atlas**. Flashing particles illustrate signaling and are not computed action potentials. This presentation draws on the structural distinctions discussed in [Spruston's review of pyramidal neurons](https://pubmed.ncbi.nlm.nih.gov/18270515/).

Brain surfaces derive from the Allen Human Reference Atlas 2020. Overview has 270,212 triangles; Fine has 2,100,796; Native uses original 0.5 mm annotations and has 5,080,888. These remain grouped, smoothed anatomical teaching surfaces. Native detail downloads about 79 MB on demand; it is not the default.

Four activities retain their study-linked explanations: music/anticipation, reward prediction, visual recognition and finger movement. Highlights and connecting traces are editorial teaching emphasis. No activity predicts a visitor's neurotransmitter levels.

The synapse distinguishes calcium-associated release, receptor action and clearance. Dopamine uses a metabotropic illustration; glutamate and GABA show representative ionotropic mechanisms without claiming those are their only receptor families. Particle trajectories and teaching time are authored. PubChem coordinates represent individual molecular conformers, not molecular dynamics. The glutamate-related structure is **L-glutamic acid**, explicitly labeled as the conjugate acid rather than physiological glutamate protonation.

The neural circuit is a Wilson–Cowan-inspired two-population rate model, integrated with a fixed 1 ms Heun step. Its twelve visible cell symbols stand for two populations, not twelve individually simulated neurons. Parameters are pedagogical, not fitted to human recordings. All 20 source records are available in the interface. Scientific material has editorial source review, not independent expert validation.

## Display and motion

**Adaptive/HDR** retains floating-point render targets, extended-range WebGPU presentation and emissive heading overlays. The color accents are preserved through RGB glow passes rather than converted to grayscale. Eligible browser/OS/display combinations and localhost or HTTPS are required. Ordinary HTTP origins other than localhost use WebGL2 and SDR.

**SDR glow** uses contrast and bloom within the display's existing range. **Quiet light** reduces bloom. **Subtle color accents** can be disabled for an entirely grayscale rendering. The atom labels do not rely on color alone.

Reduced motion disables automatic orbit and initial playback. Explicitly pressing Play starts the chosen synapse or circuit animation; pausing is immediate. The synapse cycles through five-second teaching stages, with visible movement in each stage. These timings are not biological kinetics.

## Building from a fresh clone

From the repository root, use Rust (tested with 1.92), Node 18 or newer (tested with 23), Python (tested with 3.10) and a browser supporting WebGL2/WebGPU:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.100 --locked
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r tools/requirements-atlas.txt
bash tools/build_assets.sh
bash tools/build.sh
python3 tools/serve.py
```

`tools/build_assets.sh` downloads the source annotations, generates all three detail tiers and molecules, then validates the results. Native atlas conversion is a substantial one-time data operation requiring several GB of available memory. It is separate from routine Rust/interface builds. Generated anatomy binaries are ignored by Git; manifests, processing scripts and provenance are retained. `tools/build.sh` regenerates source records, dependency notices, Wasm and the release manifest. Its `wasm-bindgen` CLI version must match the pinned library. Rendering and integration run in each visitor's browser, not on the server.

## Verify changes

Browser checks use Chrome on macOS by default. On another installation, set `CHROME_PATH` to the Chrome/Chromium executable. Confirm `node --version` is at least 18 in the same shell used for `npm`. Set `DOKE_URL` to override the local URL for the main browser and refinement checks.

With the local server running:

```sh
cargo test -p doke-core --locked
node tests/hardware-catalog.mjs
node tests/silicon-wasm.mjs
DOKE_URL=http://127.0.0.1:4173 node tests/silicon-browser.mjs
.venv/bin/python tools/validate_assets.py
npm test
node tests/refinement.mjs
node tests/panels.mjs
node tests/hdr.mjs
npm run test:performance
python3 tools/package_demo.py
node tests/portable.mjs
```

`npm test` exercises anatomy, activities, sources, chemistry, numerical controls, detail tiers, mobile navigation and fallbacks. Refinement checks cover exclusive left panels, contextual docks, rendered-frame pause/resume in all four synapse stages, tissue geometry, color switching and mobile panel separation. HDR tests exercise an actual float16 GPU pipeline with the display-capability signal emulated. They do not measure physical display luminance.

`tests/panels.mjs` covers About/source return paths, reading position, tab reuse, anatomy history, keyboard navigation, playback while reading evidence, and narrow-screen layout.

Generated JSON reports and screenshots live in `test-results/`. Performance numbers from any test are specific to its machine, viewport and browser. No universal frame-rate guarantee is implied.

## Optional server deployment

The app needs only static hosting. `tools/deploy.sh` supports an existing dedicated Incus container with Nginx on an SSH host. Provision the container, install Nginx and configure its port forwarding separately; the script does not provision infrastructure or expose ports.

```sh
cp ops/deploy.env.example ops/deploy.local.env
# Edit deploy.local.env to identify your SSH host, container and root directory.
bash tools/build.sh
bash tools/deploy.sh
DOKE_URL=https://your-demo.example npm run test:deployed
```

`ops/deploy.local.env` is ignored by Git. Keep addresses and machine-specific settings there, and authenticate through SSH keys/your SSH agent. The default container and installation directory are `doke` and `/opt/doke`; existing installations can override both without renaming a running container. `ops/nginx.conf` is the generic Nginx template.

The script uploads a timestamped static release, switches the `current` symlink, validates Nginx, restarts the dedicated container and checks health through the configured loopback port. It retains older releases. For rollback, use SSH and Incus to repoint `<DOKE_ROOT>/current` to a retained `<DOKE_ROOT>/releases/<release>` directory, then restart that container and verify health. The template serves HTTP; arrange HTTPS at your reverse proxy for public use and WebGPU/HDR eligibility.

## Public sharing

The recommended public demo is **Cloudflare Pages**, with source on GitHub and a compiled static artifact uploaded to Pages. It can use a free HTTPS `pages.dev` address; no domain purchase or public access to the home server is necessary. The Mac can be off. [Current static-request pricing](https://developers.cloudflare.com/pages/functions/pricing/) and [platform limits](https://developers.cloudflare.com/pages/platform/limits/) apply.

```sh
python3 tools/package_demo.py
# After selecting a Cloudflare account/project for public publication:
npx wrangler pages deploy dist/doke --project-name doke
```

The portable artifact includes all runtime assets, source attribution and a compatible security-header policy, and excludes redundant oversized meshes. Anatomy downloads are split below the 25 MiB per-file Pages limit. `tests/portable.mjs` verifies a project subdirectory and the intended CSP locally. GitHub Pages is another option; it does not apply Cloudflare's `_headers` file. Accounts or leaderboards would require a separate backend and security design; they are outside the current static application.

The current application is stateless and has no accounts, analytics or personal brain data. GitHub stores the source; a runnable demo needs the generated `dist/doke/` artifact. Do not commit that artifact or serve the repository root.

## Git hygiene

Commit source code, lockfiles, this guide, asset metadata, the fallback image, fonts and third-party notices. `.gitignore` excludes generated meshes and Wasm, source downloads, dependencies, local environments, packaged builds, test output, historical notes and private deployment configuration. Historical research reports and screenshots may remain locally in `docs/archive/`; they are not needed to build or understand the current application. Scientific references remain in `public/content.json` and the interface.

Before a first push, review `git status --short` and the files selected by `git ls-files --cached --others --exclude-standard`. After staging, inspect `git diff --cached --stat` and `git diff --cached`. Ignore rules do not remove files already committed, so recheck credentials and private addresses whenever adding configuration or reports. A source-code license still needs to be chosen if the project is intended to be open source; asset and dependency licenses remain separate.

## Recording a demo

The README's curated tour is `docs/media/doke-demo.gif`. It records real interactions at native anatomy detail, then trims loading and setup pauses into nine short chapters. Capture uses SDR glow because GIF cannot preserve HDR luminance.

To recreate it on macOS, run the app on port 4173 with all anatomy and molecule assets generated. Use Node >=18, the project's Playwright dependency, Google Chrome, FFmpeg and gifsicle (`brew install ffmpeg gifsicle`). Then:

```sh
npx playwright install ffmpeg
node tools/record_demo.mjs
python3 tools/render_demo.py
```

`CHROME_PATH` and `DOKE_URL` can override the browser executable and local URL. Raw footage, chapter screenshots, edit timestamps and the higher-quality MP4 remain in the ignored `test-results/demo/` directory. Only the selected GIF belongs in Git; the existing [atlas attribution](../public/assets/NOTICE.md) also applies to the anatomy shown in it. For manual recording, [Kap](https://getkap.co/) can record a selected macOS screen area and export GIF or MP4.

## Scientific credits and notices

About focuses on the scientific sources, interpretation and compact Allen atlas attribution. The separate dependency-license and anatomy-notice links are omitted from that interface. Their files remain in the repository and packaged website: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) requires attribution, a license link and an indication of adaptations, and dependency licenses such as [MIT](https://opensource.org/license/mit) require their notices to accompany distributed copies. These conditions apply to free projects too. Sharing controls have been removed; existing bookmarked query URLs can still be opened.
