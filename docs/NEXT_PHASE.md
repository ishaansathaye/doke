# From exploration to experiment

Research and design: 14 October 2026. This is the next-phase specification; later phases below are proposals, not implemented features. The [guide](GUIDE.md) remains the usage and build reference.

## The direction

doke should let someone change a small simulated system, predict what will happen, and test the prediction. A beautiful response to input is only the beginning: the system must retain a meaningful history, and the interface must explain what changed.

[Phloem](https://github.com/thcp/phloem) supplied the interaction inspiration. Its [architecture at the inspected revision](https://github.com/thcp/phloem/blob/706d74bc049c9f12f75b546eec53ceebaa72ef91/docs/ARCHITECTURE.md) maps repository events to an adaptive network. The transferable principle is a visible consequence of accumulated input. doke uses its own neuroscience experiments, models, geometry, controls and rendering implementation. No Phloem code, visual assets or audio are incorporated.

The first experiment is **Teach a pathway**: three cues connect to one target. Probe a cue, pair its arrival with a prescribed target spike, and probe again. Reverse the order or choose an untouched cue to investigate the result. It is a small numerical specimen, separate from the atlas and the existing excitatory–inhibitory population model.

Four modeled cells are intentional. Visitors can identify every input and see why a response changes. Increasing the cell count before establishing this causal clarity would make a more elaborate picture without necessarily making a better experiment.

## Scientific basis and boundaries

| Source | What it supports | What doke may claim |
| --- | --- | --- |
| [Bi & Poo, 1998](https://pubmed.ncbi.nlm.nih.gov/9852584/) | Repeated spike pairings changed glutamatergic synaptic efficacy in cultured rat hippocampal neurons; timing, initial strength and target cell type mattered. | A timing-dependent learning experiment motivated by a particular preparation. Not a universal rule for every neuron or a simulation of a visitor's memory. |
| [Gerstner et al., §19.2](https://neuronaldynamics.epfl.ch/online/Ch19.S2.html) | Pair-based STDP rules, trace implementations, pairing conventions and weight bounds. | A declared mathematical rule with testable consequences. The authored learning rate is chosen for a short lesson. |
| [Gerstner et al., §1.3](https://neuronaldynamics.epfl.ch/online/Ch1.S3.html) | Passive membrane integration with discrete threshold/reset events. | Calculated point-neuron responses. No ion-channel waveform, reconstructed dendritic integration or molecule dynamics. |
| [Pfister & Gerstner, 2006](https://pmc.ncbi.nlm.nih.gov/articles/PMC6674434/) | Basic pair rules miss certain frequency and higher-order spike-pattern effects. | This experiment illustrates selected pair-model behavior; it does not explain all biological learning. |

The authors' [Neuronal Dynamics lectures and teaching materials](https://neuronaldynamics.epfl.ch/lectures.html) provide additional explanations. Papers and explicitly declared equations define the implementation, rather than visual analogies from talks.

Keep the calculated and illustrative parts distinguishable:

- **Calculated:** model time, membrane potential, threshold events, delayed transmission, trace-based weight changes, and the cue-only probe result.
- **Prescribed:** training spike times and the target clamp used to isolate their timing relationship.
- **Visual encodings:** cell shapes, dendrites, light persistence, contact size and slowed playback. Larger contacts indicate modeled efficacy; no anatomical growth is simulated.
- **Not estimated:** human neurotransmitter concentrations, mood, intelligence, health, personal memory or a whole-brain connectome.

## First-minute experience

1. Enter **Experiment**. Four cells float in an uncluttered field. A short question asks whether a cue can make the target respond.
2. **Probe cue A.** A pulse travels to the target. The target's calculated response stays below threshold; a baseline is recorded.
3. Choose **cue before target**, with a 10 ms arrival-to-target interval. **Pair ×8** prescribes eight spike pairs. The selected connection changes visibly and numerically.
4. **Probe A again.** Under the default model, the stronger input now crosses threshold. Probe B to observe an untrained control.
5. Reverse the order or separate the pair by 50 ms, then investigate the next result. Reset restores the initial specimen.

The user chooses a protocol rather than trying to click with millisecond precision. A probe freezes learning and standardizes transient state so residual voltage cannot masquerade as a lasting weight change. The interface states: **Pairing sets both spike times. Probing tests the cue alone.**

Success is understanding a contrast, not maximizing a score. There is no intelligence, brain-health or chemical-level meter. A weaker connection can be the intended outcome of an experiment.

## Model contract

The authoritative implementation is `crates/doke-core/src/plasticity.rs`. All values below are pedagogical defaults, not a fitted dataset or biological measurements.

| Quantity | Default / convention |
| --- | --- |
| Topology | Cue cells A/B/C → one target; three excitatory plastic connections |
| Clock | Fixed 1 ms event ticks; caller batching must not change the result |
| Rest and reset | −65 mV |
| Threshold | −50 mV |
| Membrane time constant | 20 ms |
| Refractory interval | 2 ms |
| Transmission delay | 10 ms |
| Initial weight | 0.32, dimensionless; bounded to [0, 1] |
| Probe input | Voltage jump of 25 mV × weight at synaptic arrival |
| STDP traces | Exponential decay with 20 ms time constants |
| Learning amplitudes | +0.07 and −0.075, dimensionless |
| Default induction | Eight imposed pairs, 200 ms between pairs |
| Timing parameter | Target spike time minus presynaptic **arrival** time |

Between events, membrane voltage follows exact passive leak:

`V(t+h) = E_L + (V(t) - E_L) exp(-h / tau_m)`

Probe input adds its voltage jump; threshold crossing emits a spike, resets voltage and starts the refractory interval. The model does not calculate the voltage waveform of an action potential.

For an isolated spike pair, positive timing gives `Δw = A+ exp(-Δt / tau+)`; negative timing gives `Δw = -A- exp(Δt / tau-)`. The implementation uses decaying traces to account for all eligible pairs, including small cross-pair effects. Hard clipping keeps weights bounded. A hard bound is a numerical/model choice, not biological homeostasis.

Same-tick arrivals and target spikes read the previous traces before either trace is incremented, so a coincident pair does not receive an arbitrary ordering advantage. The ordinary UI presets avoid coincident events, but the API and tests must define them.

**Controlled induction matters.** If a strengthening cue were allowed to fire the target early during training, the actual pair timing would differ from the requested timing. Training therefore holds the target at rest between imposed spikes. Probe mode removes that control, freezes plasticity, clears transient membrane/refractory/trace/event state, and preserves the weights. This is an abstract pairing assay, not a claim to reproduce the complete experimental stimulation apparatus.

Starting from weight 0.32, eight +10 ms pairings should cross the probe threshold near weight 0.60; +50 ms pairings should have a substantially smaller effect. Reversed pairs should decrease weight. These are consequences to verify from the engine, not outcomes the interface may manufacture.

## Rendering and interaction contract

The Rust model owns events and time. Browser animation frames request bounded batches of ticks; they do not decide when a biological event occurs. Simulation and playback pause immediately, stop in a hidden document, and preserve state when leaving the scene. A stalled frame may slow playback but must not skip model events or cause an unbounded catch-up burst.

The renderer receives small fixed-size state arrays. A traveling pulse uses its emission and arrival times. A soma's residual glow is derived from the latest spike and is explicitly a visual persistence effect. Persistent contact efficacy must remain visually distinct from a transient flash. Geometry is built once, with state-driven uniforms; the first experiment needs neither GPU compute nor a new rendering engine.

Preserve WebGPU, WebGL2 fallback, HDR, SDR glow and grayscale preferences. Maintain semantic cue/protocol buttons, visible focus, text equivalents of outcomes, comfortable touch controls, and a reduced-motion presentation. Information and citations use the existing left-side tabs. Tools and evidence must not overlap on narrow displays. No account, microphone, personal data, network inference or backend is required.

Session state stays in memory in this first iteration. Reload resets it. No share button is reintroduced. A future replay format needs a model version and strict validation before it can represent meaningful comparisons.

## Iterative roadmap and gates

| Phase | New user question | Evidence and release gate |
| --- | --- | --- |
| **1 · Teach a pathway** | Does changing spike order change the next response? | Deterministic LIF/pair-STDP core; controlled training versus frozen probe; untouched-cue control; both rendering backends; pause/reset/scene retention; desktop/mobile/reduced-motion review. |
| **2 · Rhythm and recovery** | Why can the same pulse produce a different response moments later? | Add short-term resource use/recovery inside the synapse. [Tsodyks & Markram, 1997](https://pmc.ncbi.nlm.nih.gov/articles/PMC19580/) motivates a reduced resource model; [Markram et al., 1998](https://pmc.ncbi.nlm.nih.gov/articles/PMC20259/) motivates contrasting target-dependent facilitation/depression. Keep temporary resources separate from persistent weight. Test recovery limits and paired-pulse behavior. |
| **3 · A signal arriving later** | Can feedback influence a connection after its activity has ended? | An eligibility-trace experiment grounded in [Izhikevich, 2007](https://izhikevich.org/publications/dastdp.htm), with preparation-specific context from [Yagishita et al., 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4225776/). Test absent, timely and delayed modulation. No dopamine-equals-pleasure claim. |
| **4 · Keep a circuit responsive** | What prevents repeated strengthening from overwhelming a circuit? | Distinguish model stability from physiological homeostasis. [Turrigiano et al., 1998](https://www.nature.com/articles/36103) reports adaptation over chronic activity changes. Explicitly label accelerated hours/days and test the declared feedback law. |
| **5 · Compare, predict, challenge** | Which model explains this result, and what experiment distinguishes them? | Compare pair/triplet rules or plastic/frozen controls under identical inputs. Introduce local prediction challenges and versioned replay before considering shared scores. Online accounts/leaderboards need a separate hosting, privacy and abuse-control design. |

Each phase should earn its complexity through observed usability and a reviewable PR. Later phases are not promised biological capabilities. The present delivery is the first complete experiment and a foundation for those iterations.

## Review and acceptance

The first two PRs separate the scientific engine/specification from the dependent visual experience. Neither is merged until the project owner approves it.

Core checks must verify leak against its closed form; threshold/reset/refractory behavior; transmission delay; timing sign/window and simultaneous-event convention; bounds under long runs; untouched controls; learning-frozen probes; invalid-input atomicity; bounded queues; exact reset; and identical results under different batching.

Integration checks must exercise the visible baseline → pair → probe path, reverse-order contrast, pause/resume/cancel, scene switching, source-tab return, keyboard/touch controls, reduced motion, both GPU backends and existing scene regressions. Review actual screenshots and recorded interactions. Report frame intervals as measurements of the test machine, not a universal frame-rate guarantee.

Every public claim should correspond to a source or an explicitly described design/model choice. Test outcomes and screenshot reviews belong in the PR validation record; raw captures remain ignored.
