# doke guide

## Explore

Choose a product from the **hardware selector**, or open **Human brain**. Drag the scene to orbit, scroll to zoom, or use the camera buttons. Select a component to read its explanation and sources in the floating panel. Related explanations open as tabs, so a source does not replace the page that led to it.

Every hardware family has three depths:

| View                              | What it shows                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------- |
| Processor                         | Documented product structure, arranged as a functional map; sampled where needed. |
| Inside a core / SM / array / path | Scheduling, storage and execution resources, with explanations on demand.         |
| Follow a value / packet           | Actual model state: operands, waiting work and sums, or packet IDs and queues.    |

Open **Input** to change the 8 × 8 image. Follow a value to reveal playback and single-step controls. Pin an output to inspect only the products that have actually completed. CPU cache controls expose reuse. GPU packed/strided storage changes requested sectors while preserving the mathematical output. The tensor model passes operands through a 4 × 4 multiply-accumulate array. The matrix operation selector offers edges, weighted neighbors or identity. Chip selection changes architectural context, not undocumented model timing.

On **Cisco Silicon One G200**, open **Traffic** to send packets, block outputs and compare FIFO with virtual output queues. The geometry changes with the queue discipline. Packet identities, drops and delivery counts come from the bounded three-port model. It illustrates mechanisms without claiming to reproduce Cisco’s internal implementation.

**Human brain** keeps anatomy, a cutaway, and the sourced visual-processing guide. **Compare brain** places that atlas beside the chip. The shared image is a comparison prompt: the numerical image transform does not model a person's perception. The guide's clock sets reading pace; it is separate from execution ticks and biological measurement. **Timing & parts** compares sourced chip clock periods and human synaptic, spike and visual-response durations on a logarithmic seconds axis. Expand a measurement for its preparation and primary paper. H100 memory bandwidth and G200 switching capacity remain separate rate references; neither is treated as a clock or cognition score.

Display settings offer Balanced, Sharp and Ultra render resolution, HDR/SDR light, reduced motion, and the three anatomy mesh tiers. Overview has 270,212 triangles; Fine has 2,100,796; Native has 5,080,888 from 0.5 mm reference annotations. Higher tiers load on demand. More mesh detail does not add cellular or functional resolution to the atlas.

HDR requires a compatible browser, OS and display, with localhost or HTTPS for WebGPU. SDR glow stays within ordinary display range. Screenshots and GIFs do not establish physical HDR luminance.

## Build and run

Use Rust, Node 18 or newer, Python 3, and a WebGPU/WebGL2 browser. The pinned `wasm-bindgen` CLI must match the Rust dependency:

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

Open `http://localhost:4173`. Anatomy generation is a separate, substantial one-time download and conversion; allow several GB of memory. It generates and validates three mesh tiers. Routine builds compile Wasm, validate source records, bundle dependency notices and create a release manifest. Source records are maintained directly in `public/architecture.json`, `public/hardware.json`, `public/brain.json` `public/comparison.json` and `public/timescales.json`.

For hardware development without generated anatomy, build `doke-web` for `wasm32-unknown-unknown`, run the matching `wasm-bindgen` command from `tools/build.sh`, and serve `public/`. Brain views require the anatomy assets.

## Verify

On Linux, install the browser and its system dependencies once with `npx playwright install --with-deps chromium`. On macOS the checks use installed Google Chrome by default.

With the built app running:

```sh
cargo test -p doke-core --locked
python3 tools/check_content.py
DOKE_URL=http://127.0.0.1:4173 npm test
.venv/bin/python tools/validate_assets.py
python3 tools/package_demo.py
npm run test:portable
```

The checks cover source references and geometry, exact arithmetic and provenance, rejected inputs, actual rendering, navigation, playback and controls. The portable test serves the compiled artifact under `/doke/` with the packaged security headers. `CHROME_PATH` can select Chrome/Chromium; macOS defaults to installed Chrome, while Linux uses Playwright Chromium.

CI runs source/model checks and the focused browser checks without downloaded anatomy. Its `DOKE_SKIP_BRAIN=1` explicitly skips atlas-dependent checks. Complete local review must also exercise the actual brain and the portable artifact. Reports and screenshots belong in ignored `test-results/`.

## Host a demo

Doke needs static hosting, not an application server. Package the build:

```sh
python3 tools/package_demo.py
```

The result is `dist/doke/`, including runtime assets, provenance, notices and security headers. It excludes the redundant large anatomy file and uses chunked downloads. Publish that artifact, not the repository root. A Cloudflare Pages project can serve it over HTTPS with a `pages.dev` address; a custom domain is optional. GitHub Pages can serve the same artifact but does not apply Cloudflare's `_headers` file. Check [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) before publishing a large new asset.

After selecting the Cloudflare account and project, the publication command is:

```sh
npx wrangler pages deploy dist/doke --project-name doke
```

An existing home-server deployment remains supported by `tools/deploy.sh`. Its template is `ops/nginx.conf`; private host/container settings belong in ignored `ops/deploy.local.env`, copied from `ops/deploy.env.example`. The script expects an already provisioned Incus container and port forwarding. It uploads a static release, switches `current`, validates Nginx, restarts the container and checks health. Configure HTTPS separately for public use and WebGPU. No hosting change occurs merely by building or opening the demo.

## Scope and attribution

The [model notes](SILICON.md) distinguish documented hardware from educational execution. Anatomy derives from the Allen Human Reference Atlas 2020, not a scan of the visitor. Region highlights are authored cues, not measured firing. The app has no accounts, analytics or private brain data.

Keep the atlas attribution/license/adaptation notice, font licenses and dependency notices in distributed copies. Generated assets, raw capture files and machine-local configuration stay out of Git. Record a new tour from the current interface; the old chemistry/synapse recording no longer describes this version.
