# Inside a chip, alongside a brain

Current scope, 15 October 2026. Doke centers CPU/GPU architecture and the human brain. It removes the separate chemistry, synapse, circuit, tensor and switch experiences from navigation so that the main scene and a small set of purposeful controls can carry the experience.

## Three depths, three kinds of evidence

The **processor** view shows documented product structure. **One core/SM** exposes functional resources and their roles. **Execution** follows the actual values computed by a deliberately small Rust model. A selected block opens its explanation and source; the interface does not require reading everything before exploring.

| Reference     | Visible structure                                           | Primary evidence                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ryzen 9 9950X | 16 cores; functional groups of eight; 64 MB aggregate L3    | [AMD product specifications](https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-9-9950x.html), [Zen 5 core diagram](https://www.amd.com/content/dam/amd/en/documents/epyc-business-docs/white-papers/amd-epyc-smt-technology-brief.pdf), [classic Zen 5 complex](https://www.amd.com/content/dam/amd/en/documents/epyc-technical-docs/user-guides/58462_amd-epyc-9005-tg-architecture-overview.pdf) |
| RTX 5090      | 170 enabled SMs, four execution partitions per SM, 96 MB L2 | [RTX Blackwell architecture](https://images.nvidia.com/aem-dam/Solutions/geforce/blackwell/nvidia-rtx-blackwell-gpu-architecture.pdf), Figures 4–6 and product appendix                                                                                                                                                                                                                                                          |
| H100 SXM5     | 132 enabled SMs, 50 MB L2, 256 KB combined L1/shared per SM | [Hopper architecture](https://developer.nvidia.com/blog/nvidia-hopper-architecture-in-depth/), [Hopper tuning guide](https://docs.nvidia.com/cuda/hopper-tuning-guide/index.html)                                                                                                                                                                                                                                                |

The two CPU core groups are an interpretation combining product totals with the documented classic Zen 5 complex; no photographed die placement is asserted. Full GB202 has more SMs than RTX 5090, and full GH100 has more than H100 SXM5. Product variants are kept separate. Positions, areas and trace lengths are original functional schematics, not physical floorplans.

Physical GPU arithmetic resources are distinct from logical warp lanes. A warp contains 32 threads; its lanes are not 32 entire cores. Architectural landmarks that the running model does not implement remain explanatory. Selecting H100 instead of RTX changes the reference structure and facts; it does not supply a calibrated performance emulator.

## What the execution model calculates

The editable 8 × 8 input is matrix A. A fixed difference matrix B produces C = A × B: each column subtracts the input value to its left, with a zero left boundary. CPU and GPU must produce the same exact result.

The CPU model schedules independent dot products, issues addressed reads, models a fully associative four-line cache with true LRU replacement and merged misses, and waits for operands before arithmetic. It does not decode x86 or emulate branch prediction, speculative execution or reorder-buffer retirement. The surrounding core view explains those mechanisms without inventing activity for them. [BOOM's open CPU documentation](https://docs.boom-core.org/en/latest/sections/issue-units.html) provides mechanism context, separately from AMD-specific facts.

The GPU model has two logical 32-thread warps. It derives 32-byte sector requests from the active operand addresses. Packed versus strided storage changes request traffic while keeping the mathematical B unchanged. Requested sectors are not claimed to equal DRAM transactions after caches. The [CUDA memory guidance](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#coalesced-access-to-global-memory) explains that distinction.

Every output retains up to eight actually completed products. Current operands are absent until their loads arrive; accumulated sums contain only retired work; output validity waits for its store. Pause, step and reset operate on the model, and playback interpolates emitted transfers rather than manufacturing completion.

**Model ticks are authored teaching time.** They are not vendor clock cycles, nanoseconds, FPS, energy or benchmark predictions. Product MHz, bandwidth and core counts do not silently parameterize undisclosed execution rules. The numerical engine retains previously tested tensor/queue primitives, but the focused interface does not expose them as additional worlds.

## The human brain remains part of doke

The existing Allen atlas provides anatomy, internal structures and a visual-processing guide, both alone and beside the processor. The same image is an invitation to compare mechanisms, not an assertion that an edge transform performs human recognition.

[Haxby et al.](https://pubmed.ncbi.nlm.nih.gov/11577229/) support distributed visual representations. [Logothetis et al.](https://pubmed.ncbi.nlm.nih.gov/11449264/) distinguish the measured fMRI signal from individual neuronal output. The guide highlights broad atlas landmarks at an authored reading pace; it does not replay those experiments or predict the visitor's neural activity. No universal brain-versus-chip speed or intelligence score is presented.

## Next iterations

1. Let users preserve an output while reducing memory traffic, with scores scoped to one model version and input.
2. Add a small, specified instruction workload or measured trace before claiming instruction-level execution on a particular device.
3. Follow a real tiny neural-network operator graph into hardware work; an LLM topology alone is not inference.
4. Add licensed recorded neural trials with species, modality, units and preprocessing kept visible.

Further complexity must earn its place through a useful interaction and inspectable evidence. CPU/GPU depth, visual clarity and the brain comparison take priority over adding more modes.

Validation checks exact results, causal operand arrival, bounded provenance, real cache/sector changes, source and geometry consistency, rendering, controls and portable hosting. It does not establish vendor-cycle or biological accuracy. Source records and specific limits live beside each explanation in `public/architecture.json`, `public/brain.json` and `public/comparison.json`.
