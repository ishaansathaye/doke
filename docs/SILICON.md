# Inside a chip, alongside a brain

Current scope, 15 October 2026. Doke centers hardware architecture alongside the human brain. One product selector covers CPU, GPU, tensor/NPU and network ASIC references. The chemistry, standalone synapse and circuit experiences are removed from navigation. A single scene, three depths and on-demand explanation tabs carry the experience.

## Three depths, three kinds of evidence

The **processor** view shows documented product structure. **One core/SM/array/path** exposes functional resources and their roles. **Execution** follows the actual values computed by a deliberately small Rust model. A selected block opens its explanation and source; the interface does not require reading everything before exploring.

| Reference              | Visible structure                                                                            | Primary evidence                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ryzen 9 9950X          | 16 cores; functional groups of eight; 64 MB aggregate L3                                     | [AMD product specifications](https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-9-9950x.html), [Zen 5 core diagram](https://www.amd.com/content/dam/amd/en/documents/epyc-business-docs/white-papers/amd-epyc-smt-technology-brief.pdf), [classic Zen 5 complex](https://www.amd.com/content/dam/amd/en/documents/epyc-technical-docs/user-guides/58462_amd-epyc-9005-tg-architecture-overview.pdf) |
| RTX 5090               | 170 enabled SMs, four execution partitions per SM, 96 MB L2                                  | [RTX Blackwell architecture](https://images.nvidia.com/aem-dam/Solutions/geforce/blackwell/nvidia-rtx-blackwell-gpu-architecture.pdf), Figures 4–6 and product appendix                                                                                                                                                                                                                                                          |
| H100 SXM5              | 132 enabled SMs, 50 MB L2, 256 KB combined L1/shared per SM                                  | [Hopper architecture](https://developer.nvidia.com/blog/nvidia-hopper-architecture-in-depth/), [Hopper tuning guide](https://docs.nvidia.com/cuda/hopper-tuning-guide/index.html)                                                                                                                                                                                                                                                |
| Google TPU v1          | Documented 256 × 256 matrix unit, 24 MiB unified buffer; sampled array windows               | [TPU paper](https://arxiv.org/abs/1704.04760), [Google architecture explanation](https://cloud.google.com/blog/products/ai-machine-learning/an-in-depth-look-at-googles-first-tensor-processing-unit-tpu)                                                                                                                                                                                                                        |
| Cisco Silicon One G200 | Public ingress/egress, shared-memory and queueing functions; original functional arrangement | [G200 data sheet](https://www.cisco.com/c/en/us/solutions/collateral/silicon-one/silicon-one-g200-ds.html)                                                                                                                                                                                                                                                                                                                       |

The two CPU core groups are an interpretation combining product totals with the documented classic Zen 5 complex; no photographed die placement is asserted. Full GB202 has more SMs than RTX 5090, and full GH100 has more than H100 SXM5. Product variants are kept separate. Positions, areas and trace lengths are original functional schematics, not physical floorplans.

Physical GPU arithmetic resources are distinct from logical warp lanes. A warp contains 32 threads; its lanes are not 32 entire cores. Architectural landmarks that the running model does not implement remain explanatory. Selecting H100 instead of RTX changes the reference structure and facts; it does not supply a calibrated performance emulator.

## What the execution model calculates

The editable 8 × 8 input is matrix A. Choose a matrix B for differences (each column subtracts its left neighbor, with a zero boundary), weighted neighbors (diagonal weight two and adjacent weights one), or identity. All compute C = A × B. CPU, GPU and tensor schedules must produce the same exact 64 outputs and 512 integer multiply-adds.

The CPU model schedules independent dot products, issues addressed reads, models a fully associative four-line cache with true LRU replacement and merged misses, and waits for operands before arithmetic. It does not decode x86 or emulate branch prediction, speculative execution or reorder-buffer retirement. The surrounding core view explains those mechanisms without inventing activity for them. [BOOM's open CPU documentation](https://docs.boom-core.org/en/latest/sections/issue-units.html) provides mechanism context, separately from AMD-specific facts.

The GPU model has two logical 32-thread warps. It derives 32-byte sector requests from the active operand addresses. Packed versus strided storage changes request traffic while keeping the mathematical B unchanged. Requested sectors are not claimed to equal DRAM transactions after caches. The [CUDA memory guidance](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#coalesced-access-to-global-memory) explains that distinction.

The tensor model uses 16 processing elements arranged as a 4 × 4 output-stationary systolic array. Neighboring cells reuse operands; four tiles cover the 8 × 8 output. The processor view is inspired by the documented TPU v1, whose 65,536 MACs use a weight-stationary organization. The execution model is a deliberately different teaching schedule, not a reproduction of TPU v1’s dataflow. Array windows and decorative cells are explicitly sampled, not invented physical subdivisions.

The packet model admits packets to a 32-slot, three-port switch. FIFO can block traffic behind a packet whose destination is unavailable; virtual output queues separate those destinations. Each tick delivers previous transfers and arbitrates new ones. Injection, admission, queue occupancy, delivery and drops obey conservation. These capacities and arbitration rules illustrate published queueing mechanisms; no G200 clock, physical port layout or internal latency is inferred.

Every matrix output retains up to eight actually completed products. Current operands are absent until their loads arrive; accumulated sums contain only retired work; output validity waits for its store. Pause, step and reset operate on the model, and playback interpolates emitted transfers rather than manufacturing completion.

**Model ticks are authored teaching time.** They are not vendor clock cycles, nanoseconds, FPS, energy or benchmark predictions. Product MHz, bandwidth and core counts do not silently parameterize undisclosed execution rules. The same controls operate all four model families; a product selection changes the architecture and available workload. H100 and RTX share the GPU teaching schedule.

## The human brain remains part of doke

The existing Allen atlas provides anatomy, internal structures and a visual-processing guide, both alone and beside the processor. The same image is an invitation to compare mechanisms, not an assertion that an edge transform performs human recognition.

[Haxby et al.](https://pubmed.ncbi.nlm.nih.gov/11577229/) support distributed visual representations. [Logothetis et al.](https://pubmed.ncbi.nlm.nih.gov/11449264/) distinguish the measured fMRI signal from individual neuronal output. The guide highlights broad atlas landmarks at an authored reading pace; it does not replay those experiments or predict the visitor's neural activity. No universal brain-versus-chip speed or intelligence score is presented.

## Timing and parts comparison

`public/timescales.json` stores durations in seconds with explicit statistic type, source and preparation. The panel places chip clock periods (`1 / frequency`) beside human synaptic-response onset, action-potential half-width, local event sequences and visual-task ERP onset on a logarithmic duration axis. These are different events, not equivalent units of computation. The axis does not divide them into a speed or intelligence ranking. Means and approximate onsets are points; only a reported observed interval is a range.

The human values come from [Molnár et al. (2008)](https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.0060222), [Testa-Silva et al. (2010)](https://www.frontiersin.org/journals/synaptic-neuroscience/articles/10.3389/fnsyn.2010.00012/full) and [Thorpe et al. (1996)](https://www.nature.com/articles/381520a0). Clinical tissue provenance, temperature, SD/SEM and the distinction between EEG onset and reaction time remain available beside the measurements.

Ryzen’s documented base clock, RTX’s documented base clock and TPU v1’s reported clock provide the silicon periods. No verified final H100 core clock is supplied: its documented 3.35 TB/s memory bandwidth is shown separately. G200’s 51.2 Tbps full-duplex switching capacity is also a rate, never converted to a clock period. Parts comparisons describe specific similarities and their limits, not one-to-one neuron/transistor equivalences.

## Next iterations

1. Let users preserve an output while reducing memory traffic, with scores scoped to one model version and input.
2. Add a small, specified instruction workload or measured trace before claiming instruction-level execution on a particular device.
3. Follow a real tiny neural-network operator graph into hardware work; an LLM topology alone is not inference.
4. Add licensed recorded neural trials with species, modality, units and preprocessing kept visible.

Further complexity must earn its place through a useful interaction and inspectable evidence. Hardware depth, visual clarity and the brain comparison take priority over adding more modes.

Validation checks exact results, causal operand arrival, bounded provenance, real cache/sector changes, source and geometry consistency, rendering, controls and portable hosting. It does not establish vendor-cycle or biological accuracy. Source records and specific limits live beside each explanation in `public/architecture.json`, `public/brain.json` `public/comparison.json` and `public/timescales.json`.
