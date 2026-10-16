# doke guide

## Explore

Choose **CPU**, **GPU** or **Human brain**. Drag the scene to orbit, scroll to zoom, or use the camera buttons. Select a component to read its explanation and sources in the floating panel. Related explanations open as tabs, so a source does not replace the page that led to it.

CPU and GPU have three depths:

| View               | What it shows                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Processor          | The selected product's documented core or SM count, arranged as a functional map.             |
| Inside a core / SM | Scheduling, storage and execution resources, with explanations on demand.                     |
| Follow a value     | Actual state from the small Rust execution model: operands, addresses, waiting work and sums. |

Open **Input** to change the 8 × 8 image. Follow a value to reveal playback and single-step controls. Pin an output to inspect only the products that have actually completed. CPU cache controls expose reuse. GPU packed/strided storage changes requested sectors while preserving the mathematical output. Chip selection changes architectural context, not undocumented model timing.

**Human brain** keeps anatomy, a cutaway, and the sourced visual-processing guide. **Compare brain** places that atlas beside the chip. The shared image is a comparison prompt: the numerical image transform does not model a person's perception. The guide's clock sets reading pace; it is separate from execution ticks and biological measurement.

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

Open `http://localhost:4173`. Anatomy generation is a separate, substantial one-time download and conversion; allow several GB of memory. It generates and validates three mesh tiers. Routine builds compile Wasm, validate source records, bundle dependency notices and create a release manifest. Source records are maintained directly in `public/architecture.json`, `public/hardware.json`, `public/brain.json` and `public/comparison.json`.

For hardware development without generated anatomy, build `doke-web` for `wasm32-unknown-unknown`, run the matching `wasm-bindgen` command from `tools/build.sh`, and serve `public/`. Brain views require the anatomy assets.

## Verify

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
