# doke: inside a brain, inside a chip

Research and implementation proposal, 14 October 2026. This direction keeps the existing human brain explorer and adds a silicon world with the same floating presentation, zoom, inspection and light. Earlier proposals in PRs #1–#3 are not dependencies and remain unmerged.

## The experience

Choose a CPU, GPU, tensor accelerator or packet-switch reference. Put something into it. Follow the resulting work into storage, scheduling, arithmetic or queues. Change one condition and see the computed consequence. Open the existing human brain beside it to ask how biological information processing differs.

The first input is a small image tile you can draw. A declared integer matrix transform produces an actual output in Rust. The CPU, GPU and tensor models compute the same result through different educational execution rules. A packet-switch mode demonstrates a different task: inject packets, block a destination, and see which work gets through. Silicon One belongs here because networking moves data between computing systems, not because it executes the image transform.

The product should reward a question such as “why did rearranging the same data change the traffic?” A run is short and repeatable. A visible result, an inspectable event and an intervention matter more than more configuration fields. Explanation opens on demand in a floating panel; the scene remains the main object.

This is a pivot within doke. Brain anatomy, activity stories, synapses, neural circuits and messengers remain available. The new comparison uses the actual existing atlas and its sourced vision context; it does not replace the brain with an unrelated creature or a decorative neural metaphor.

## What selecting a real chip means

Start with a curated, searchable catalog rather than accepting arbitrary processor names and inventing an implementation. `public/hardware.json` stores product-specific public facts and their sources. The initial references span Ryzen 9 9950X, RTX 5090, H100 SXM, TPU v4, and Silicon One G200/G300. TPU v4 is selected for its documentation, not because it is the newest accelerator.

Three layers must remain visibly distinct:

| Layer                     | Meaning                                                                        | Appropriate display                                                                      |
| ------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Public reference          | A vendor or paper documents a feature for a particular SKU and configuration   | Core/SM count, memory type/capacity, advertised bandwidth, cited block descriptions      |
| Executable teaching model | Original, deliberately small rules compute state and results                   | Issued work, useful MACs, requested sectors, queue occupancy, completion and model ticks |
| Future measured trace     | A specified program and device produced observations under recorded conditions | Captured timestamps/counters with units, provenance and uncertainty                      |

Public profile numbers do not silently set undocumented toy timing. Selecting another SKU in the same family changes reference context; it does not claim to benchmark the two products. Selecting another functional family changes the execution model. The model configuration must be inspectable. Geometry is an original schematic of functions, not a recovered die floorplan.

Do not treat CPU/GPU/NPU/ASIC as mutually exclusive categories. ASIC describes specialization. “NPU” means **neural processing unit** in many AI products and **network processing unit** in Cisco packet-processing contexts. Label the function explicitly.

## Four concrete interactions

### 1. CPU: where did the work wait?

Draw an 8 × 8 integer tile. The declared transform `C = A × B` uses 32-bit accumulation and bounded small inputs. An adjacent-column difference matrix supplies a visible default filter; this is arithmetic, not object recognition.

Follow operand reads into a tiny cache and compute resources. Change locality or cache use and rerun the same input. Track completed outputs and real model read/hit/miss events. If an issue-width control exists, it changes the educational scheduler rather than the selected processor's physical core count.

This first model does not decode x86, boot an OS, model speculative execution, reproduce a Ryzen reorder buffer, or convert its ticks into nanoseconds. Later independent increments can introduce a declared instruction subset, dependencies, branch recovery and a calibrated trace. [Intel's optimization manuals](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html) and [gem5's CPU models](https://www.gem5.org/documentation/general_docs/cpu_models/execution_basics) show how much is hidden by a simple pipeline picture.

### 2. GPU: follow one value through a crowd

The same arithmetic is divided among logical lanes. An address-layout intervention preserves the numerical result while changing which memory sectors are touched. A visitor can see the active work, the requested memory, and the result, then compare the run against its previous layout.

The exact NVIDIA rules used must be tied to a documented architecture: a 32-thread warp is not a universal definition of GPU execution, and sector grouping is not the same as counting DRAM transactions after cache reuse. [CUDA's best-practices guide](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#coalesced-access-to-global-memory) explains the 32-byte transaction-unit accounting used for the supported modern NVIDIA access case. A small model should report **requested sectors** unless it actually models the intervening caches.

The [RTX Blackwell white paper](https://images.nvidia.com/aem-dam/Solutions/geforce/blackwell/nvidia-rtx-blackwell-gpu-architecture.pdf), Figures 3 and 5 and Appendix A, was inspected visually. It distinguishes full GB202 from the enabled RTX 5090 configuration. That distinction matters: do not populate a retail card with full-die SM counts. RTX graphics blocks also must not be generalized to data-center H100/Blackwell parts. The model's visible lanes are a magnified teaching unit, not every execution resource on a selected board.

### 3. Tensor array: a wave of actual multiplication

Send the same tile through a small output-stationary array. Operands move between neighboring processing elements while partial sums stay visible. Expose each contributing multiplication and the fill/drain frontier. Completion must match the scalar reference exactly, including negative and zero values.

The model is an original educational dataflow, not a reconstruction of a Google MXU or NVIDIA Tensor Core. [TPU v4 documentation](https://docs.cloud.google.com/tpu/docs/v4) and [the TPU architecture overview](https://docs.cloud.google.com/tpu/docs/system-architecture-tpu-vm) provide reference context; do not combine array dimensions, precision or throughput from different TPU generations. Report integer MACs as MACs, not FLOPS. A later real workload can discuss precision and operation-count conventions explicitly.

### 4. Cisco / packet switching: unblock the path

Inject competing bursts, block one egress, and switch between a FIFO and destination-separated queues while retaining packet identity. Observe head-of-line blocking, finite-buffer admission, actual deliveries and drops. One packet can be followed from arrival through its queue and grant to its output.

[Cisco's Q200 QoS paper](https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9500-series-switches/catalyst-9500x-9600x-qos-q200-wp.html) supports the VOQ/credit teaching mechanism. Its platform-specific SMS/HBM capacities do not describe G300. The [G200](https://www.cisco.com/c/en/us/solutions/collateral/silicon-one/silicon-one-g200-ds.html) and [G300](https://www.cisco.com/c/en/us/solutions/collateral/silicon-one/silicon-one-g300-ds.html) data sheets provide separate product facts. The initial 3-input/3-output bounded model is neither Cisco's proprietary scheduler nor an implementation of PFC, ECN, packet spraying or a multi-chip fabric. Those mechanisms would require their own models and validation.

All Cisco research is public. No employer systems, internal documentation, SDKs, RTL or confidential traces are required or included.

## Comparing with the human brain

The first comparison is **same image, different mechanisms**. This is narrower than a same-task benchmark: an edge transform does not do what a human does when recognizing an object.

The brain panel loads doke's existing Allen Human Reference Atlas and uses its vision-related regions. Timed chapter highlights are authored explanation cues, not measured activation or a simulation of the visitor's perception. The existing Wilson–Cowan-inspired model remains an uncalibrated population model; it does not suddenly become a whole-brain recognition engine when placed next to a chip.

| Question                             | Useful comparison                                                                                             | Avoid                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Where is information held and moved? | Hardware operands/registers/caches; separately, biological cells, axons and synaptic processes                | Calling a brain region a GPU, a synapse a transistor, or a packet an action potential |
| What happened in this run?           | Exact small-model state and result; sourced anatomy and biological mechanisms with their limits               | Treating authored brain glow as measured firing                                       |
| How long did it take?                | Model ticks for toy schedules; separately cited human task measurements and any later measured hardware trace | Multiplying brain spikes by a guessed instruction rate; dividing by a chip's GHz      |
| How much energy did it use?          | Later energy measurements with device/system boundaries, workload and idle/baseline accounting                | A generic whole-brain power estimate versus board TDP as joules per answer            |
| What changes with experience?        | Declared state changes and a specified biological learning mechanism                                          | Equating cached bytes, pretrained model weights and human memories                    |

[Thorpe et al. (1996)](https://pubmed.ncbi.nlm.nih.gov/8632824/) report task-specific electrophysiological evidence during rapid visual categorization; the often-cited roughly 150 ms signal is not a general brain clock or the participant's reaction time. [Rajalingham et al. (2018)](https://www.jneurosci.org/content/38/33/7255) compare human, monkey and neural-network behavior on defined images/tasks: this is a useful direction for later matched-task studies, not evidence that our matrix toy reproduces those results. [Logothetis et al. (2001)](https://pubmed.ncbi.nlm.nih.gov/11449264/) is a reminder that a measured imaging signal and individual neuronal firing are different quantities.

For real measured data later, keep species, individual/sample, modality, units, preprocessing and license next to the view. [Allen Neuropixels](https://allensdk.readthedocs.io/en/latest/visual_coding_neuropixels.html) is recorded mouse activity; [MICrONS](https://www.microns-explorer.org/) includes mouse structural and functional data, not a simulated human connectome. HCP subject-level data has access terms and must not be bundled merely because a download exists. A disease mode would require a named mechanism, calibrated model or properly consented/licensed data, and a separate review; it is not a “damage” slider over a healthy atlas.

## What the other projects teach us

These are research references, not imported implementations or assets.

| Project                                                          | Useful principle                                                                 | Boundary for doke                                                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Phloem](https://github.com/thcp/phloem)                         | Personal input leaves a recognizable, changing artifact                          | Preserve value identity and consequence; do not copy its mapping or art                            |
| [Ripes](https://github.com/mortbopet/Ripes)                      | Executed processor state can be inspected, including cache and pipeline behavior | Start smaller; full ISA execution is a distinct next phase                                         |
| [Bycroft LLM visualization](https://github.com/bbycroft/llm-viz) | Zoom can preserve the connection between a scalar and its larger computation     | A model topology is not a semiconductor floorplan; large geometry without weights is not inference |
| [TensorSpace](https://tensorspace.org/html/docs/modelIntro.html) | User input should change actual intermediate values                              | Treat model/data licensing separately; no weights included here                                    |
| [gem5](https://www.gem5.org/about/)                              | Separate model time and event state from presentation                            | Do not claim its fidelity from a similar-looking diagram                                           |
| [Accel-Sim](https://accel-sim.github.io/)                        | Performance claims need trace/model validation against devices                   | A possible later trace source, not a free browser shortcut to exact GPU timing                     |
| [Verilator](https://verilator.org/guide/latest/overview.html)    | RTL can provide a concrete lower-level execution reference                       | A proprietary block diagram does not provide the RTL it would require                              |

Live primary documentation, repositories and papers were reviewed. The LLM visualization was also inspected in the browser; we did not run gem5, Accel-Sim or vendor simulators. NVIDIA architecture figures were visually inspected under the PDF workflow. No external artwork, code, weights, SDKs or vendor diagrams are bundled.

## The LLM route after the first slice

An LLM is a workload that can run on hardware; it should not appear as another kind of physical brain in the chip picker. A compelling next layer is **text → tokens → operator graph → tile → hardware events**. A visitor can change context length or batching and inspect the extra reads, matrix work and cache state.

Start with one completely specified tiny forward pass. Show actual Q/K/V projections, score products, normalization, value mixing and an output projection. Do not fabricate generated answers from a diagram. The [Transformer paper](https://arxiv.org/abs/1706.03762) establishes mathematical building blocks; a decoder-only implementation must name its variant. [NVIDIA's inference discussion](https://developer.nvidia.com/blog/mastering-llm-techniques-inference-optimization/) distinguishes prefill, dependent decode steps, batching and KV reuse. An operator-to-device mapping must also state its kernel/compiler assumptions.

Possible later increments, each independently reviewable:

1. **A byte's biography:** pin one output and inspect its operands and transfers backwards through the current run.
2. **Beat your own traffic:** preserve output while reducing model memory requests. Score within a fixed model/version and input, never by supposed brain intelligence.
3. **Tiny attention:** exact local inference with a disclosed tokenizer, weights and dimensions; later a trace import from a real runtime.
4. **Measured hardware lane:** import an explicitly documented trace format with source device and calibration. Keep it separate from the educational scheduler.
5. **Lower-level silicon:** an original small RISC-V/RTL unit with verified behavior, then gate-level inspection where the underlying model exists.
6. **Recorded neural trials:** a compact licensed sample with raw/processed distinction, species and sample provenance; repeated-trial variability alongside deterministic chip execution.

The first slice excludes arbitrary binary execution, an emulator for any entered chip name, disease prediction, private Cisco internals, and universal brain-versus-chip scores.

## Architecture and review sequence

Keep `doke-core` as the owner of numerical and discrete state. Commands specify an input or intervention; bounded steps produce snapshots with actual events, counters and output. Renderers interpolate those events and never manufacture a completion. Model time advances only when running or stepping. Changing presentation speed cannot change results.

Use the existing `doke-web` / wgpu camera, bloom and HDR pipeline for original chip geometry, and reuse the existing anatomy assets in comparison mode. The UI retains floating controls, selectable objects, zoom and optional source tabs. A static browser deployment remains sufficient; there is no need for a backend, cloud inference, accounts or home-server exposure.

The proposed PR sequence separates review responsibilities:

1. **Research and catalog:** this rationale, cited hardware facts, comparison content and data validation.
2. **Rust models:** exact bounded arithmetic and queue simulation, snapshots, Wasm interface and invariant tests.
3. **Silicon explorer:** actual 3D model-driven visualization, input editing, selection, pause/step/reset, inspection and browser tests.
4. **Brain comparison:** the original brain alongside the shared input, explicit clocks and evidence, with regression and visual checks.

Later PRs may be stacked on earlier branches for review; none is authorization to merge. PRs #1–#3 remain excluded.

Verification must establish exact arithmetic against an independent reference, packet conservation/capacity/blocked-output behavior, deterministic replay, invalid-input rejection, and real effects from interventions. Browser checks cover pause, single-step, reset, profile changes, source navigation, keyboard/touch layouts and both graphics paths. Observe performance and inspect real renders. None of those checks proves biological fidelity or user enjoyment; the owner still reviews the actual experience.
