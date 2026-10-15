//! Controlled spike-pair induction and a separate, learning-frozen LIF probe.
//!
//! Equation families: Gerstner et al., Neuronal Dynamics §§1.3 and 19.2.
//! All constants below are pedagogical, not fitted human physiology. Training
//! imposes target spikes and clamps its passive voltage between those events;
//! the probe removes that clamp. Shape, chemistry and action-potential waveform
//! are outside this model. Time is biological milliseconds, voltage is mV, and
//! weights/traces are dimensionless. Axonal arrival defines the STDP clock.

use serde::Serialize;
use std::collections::VecDeque;

pub const CUE_COUNT: usize = 3;
pub const TARGET: usize = 3;
pub const REST_MV: f64 = -65.0;
pub const THRESHOLD_MV: f64 = -50.0;
pub const TAU_MEMBRANE_MS: f64 = 20.0;
pub const TAU_TRACE_MS: f64 = 20.0;
pub const REFRACTORY_MS: u64 = 2;
pub const AXON_DELAY_MS: u64 = 10;
pub const INITIAL_WEIGHT: f64 = 0.32;
pub const MIN_WEIGHT: f64 = 0.0;
pub const MAX_WEIGHT: f64 = 1.0;
pub const INPUT_GAIN_MV: f64 = 25.0;
pub const A_PLUS: f64 = 0.07;
pub const A_MINUS: f64 = 0.075;
pub const PAIR_INTERVAL_MS: u64 = 200;
pub const PROBE_DURATION_MS: u64 = 100;
const MAX_EVENTS: usize = 64;
const MAX_PAIRS: u32 = 32;
const MAX_ADVANCE_MS: f64 = 250.0;
const PAIR_LEAD_MS: u64 = 100;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Idle,
    Training,
    Probe,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Spike,
    Arrival,
    Weight,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TimingEvent {
    pub time_ms: f64,
    pub kind: EventKind,
    /// For arrival/weight events this identifies the presynaptic cue/edge.
    pub cell: usize,
    pub weight: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ProbeResult {
    pub cue: usize,
    /// Largest pre-reset membrane value reached by the delta-current probe.
    pub peak_mv: f64,
    pub spiked: bool,
    pub weight: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TimingSnapshot {
    pub time_ms: f64,
    pub axon_delay_ms: u64,
    pub phase: Phase,
    pub weights: [f64; CUE_COUNT],
    pub voltages_mv: [f64; 4],
    pub spike_counts: [u64; 4],
    pub last_spike_ms: [Option<f64>; 4],
    pub last_arrival_ms: [Option<f64>; CUE_COUNT],
    pub selected_cue: Option<usize>,
    pub gap_ms: i32,
    pub completed_pairs: u32,
    pub total_pairs: u32,
    pub last_probe: Option<ProbeResult>,
    pub events: Vec<TimingEvent>,
}

#[derive(Clone, Copy, Debug)]
enum Action {
    CueSpike,
    Arrival,
    TargetSpike,
    PairComplete,
}

#[derive(Clone, Debug)]
pub struct TimingModel {
    tick: u64,
    remainder_ms: f64,
    phase: Phase,
    weights: [f64; CUE_COUNT],
    voltages: [f64; 4],
    refractory_until: [u64; 4],
    spike_counts: [u64; 4],
    last_spike: [Option<f64>; 4],
    last_arrival: [Option<f64>; CUE_COUNT],
    pre_trace: [f64; CUE_COUNT],
    post_trace: f64,
    selected_cue: Option<usize>,
    gap_ms: i32,
    completed_pairs: u32,
    total_pairs: u32,
    schedule: VecDeque<(u64, Action)>,
    end_tick: u64,
    pending_probe: Option<ProbeResult>,
    last_probe: Option<ProbeResult>,
    events: VecDeque<TimingEvent>,
}

impl Default for TimingModel {
    fn default() -> Self {
        Self {
            tick: 0,
            remainder_ms: 0.0,
            phase: Phase::Idle,
            weights: [INITIAL_WEIGHT; CUE_COUNT],
            voltages: [REST_MV; 4],
            refractory_until: [0; 4],
            spike_counts: [0; 4],
            last_spike: [None; 4],
            last_arrival: [None; CUE_COUNT],
            pre_trace: [0.0; CUE_COUNT],
            post_trace: 0.0,
            selected_cue: None,
            gap_ms: 0,
            completed_pairs: 0,
            total_pairs: 0,
            schedule: VecDeque::new(),
            end_tick: 0,
            pending_probe: None,
            last_probe: None,
            events: VecDeque::new(),
        }
    }
}

impl TimingModel {
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Stop a protocol, preserving acquired weights, selection and model time.
    /// Transient voltage, traces, event history and trial results are cleared.
    pub fn cancel(&mut self) {
        self.phase = Phase::Idle;
        self.remainder_ms = 0.0;
        self.voltages = [REST_MV; 4];
        self.refractory_until = [0; 4];
        self.spike_counts = [0; 4];
        self.last_spike = [None; 4];
        self.last_arrival = [None; CUE_COUNT];
        self.pre_trace = [0.0; CUE_COUNT];
        self.post_trace = 0.0;
        self.completed_pairs = 0;
        self.total_pairs = 0;
        self.schedule.clear();
        self.end_tick = self.tick;
        self.pending_probe = None;
        self.last_probe = None;
        self.events.clear();
    }

    fn validate_start(&self, cue: usize) -> Result<(), &'static str> {
        if cue >= CUE_COUNT {
            return Err("Cue must be 0, 1 or 2");
        }
        if self.phase != Phase::Idle {
            return Err("Finish or cancel the current trial first");
        }
        if self.tick > u64::MAX - 10_000 {
            return Err("Reset the model clock before starting another trial");
        }
        Ok(())
    }

    /// Schedule a controlled all-to-all pair-STDP induction assay. Positive gap
    /// means the imposed target spike follows cue arrival at the synapse.
    /// The passive target is clamped during induction, so learned efficacy never
    /// adds unscheduled target spikes. Equal-time spikes use pre-event traces.
    pub fn start_training(
        &mut self,
        cue: usize,
        gap_ms: i32,
        pairs: u32,
    ) -> Result<(), &'static str> {
        self.validate_start(cue)?;
        if !(-50..=50).contains(&gap_ms) || !(1..=MAX_PAIRS).contains(&pairs) {
            return Err("Use a gap between -50 and 50 ms and 1 to 32 pairs");
        }
        self.cancel();
        self.phase = Phase::Training;
        self.selected_cue = Some(cue);
        self.gap_ms = gap_ms;
        self.total_pairs = pairs;
        let mut scheduled = Vec::with_capacity(pairs as usize * 4);
        for pair in 0..pairs {
            let arrival = self.tick + PAIR_LEAD_MS + u64::from(pair) * PAIR_INTERVAL_MS;
            let post = if gap_ms >= 0 {
                arrival + gap_ms as u64
            } else {
                arrival - u64::from(gap_ms.unsigned_abs())
            };
            scheduled.push((arrival - AXON_DELAY_MS, Action::CueSpike));
            scheduled.push((arrival, Action::Arrival));
            scheduled.push((post, Action::TargetSpike));
            scheduled.push((arrival.max(post), Action::PairComplete));
            self.end_tick = arrival.max(post) + 100;
        }
        scheduled.sort_by_key(|event| event.0);
        self.schedule = scheduled.into();
        Ok(())
    }

    /// Standardized cue-only probe: clear all transient state, retain weights,
    /// remove the target clamp, and freeze plasticity for the whole trial.
    pub fn start_probe(&mut self, cue: usize) -> Result<(), &'static str> {
        self.validate_start(cue)?;
        self.cancel();
        self.phase = Phase::Probe;
        self.selected_cue = Some(cue);
        self.gap_ms = 0;
        self.schedule.push_back((self.tick + 2, Action::CueSpike));
        self.schedule
            .push_back((self.tick + 2 + AXON_DELAY_MS, Action::Arrival));
        self.end_tick = self.tick + PROBE_DURATION_MS;
        self.pending_probe = Some(ProbeResult {
            cue,
            peak_mv: REST_MV,
            spiked: false,
            weight: self.weights[cue],
        });
        Ok(())
    }

    /// Advance at most 250 biological ms per call on a fixed 1 ms clock.
    /// Substeps survive frame batching. Idle time can advance without learning;
    /// callers pause by not calling this method. Invalid input never mutates.
    pub fn advance(&mut self, dt_ms: f64) -> Result<(), &'static str> {
        if !dt_ms.is_finite() || !(0.0..=MAX_ADVANCE_MS).contains(&dt_ms) {
            return Err("Advance must be finite and between 0 and 250 ms");
        }
        let elapsed = self.remainder_ms + dt_ms;
        let steps = (elapsed + 1e-9).floor() as u64;
        if self.tick.checked_add(steps).is_none() {
            return Err("Model clock overflow; reset required");
        }
        self.remainder_ms = (elapsed - steps as f64).max(0.0);
        for _ in 0..steps {
            self.step();
        }
        Ok(())
    }

    fn event(&mut self, kind: EventKind, cell: usize, weight: Option<f64>) {
        if self.events.len() == MAX_EVENTS {
            self.events.pop_front();
        }
        self.events.push_back(TimingEvent {
            time_ms: self.tick as f64,
            kind,
            cell,
            weight,
        });
    }

    fn spike(&mut self, cell: usize) {
        self.spike_counts[cell] += 1;
        self.last_spike[cell] = Some(self.tick as f64);
        self.refractory_until[cell] = self.tick + REFRACTORY_MS;
        self.voltages[cell] = REST_MV;
        self.event(EventKind::Spike, cell, None);
    }

    fn probe_input(&mut self, cue: usize) {
        if self.tick < self.refractory_until[TARGET] {
            return;
        }
        self.voltages[TARGET] += INPUT_GAIN_MV * self.weights[cue];
        let spiked = self.voltages[TARGET] >= THRESHOLD_MV;
        if let Some(probe) = &mut self.pending_probe {
            probe.peak_mv = probe.peak_mv.max(self.voltages[TARGET]);
            probe.spiked |= spiked;
        }
        if spiked {
            self.spike(TARGET);
        }
    }

    fn step(&mut self) {
        self.tick += 1;
        for cell in 0..4 {
            self.voltages[cell] = if self.tick < self.refractory_until[cell]
                || (self.phase == Phase::Training && cell == TARGET)
            {
                REST_MV
            } else {
                REST_MV + (self.voltages[cell] - REST_MV) * (-1.0 / TAU_MEMBRANE_MS).exp()
            };
        }
        let decay = (-1.0 / TAU_TRACE_MS).exp();
        self.pre_trace.iter_mut().for_each(|trace| *trace *= decay);
        self.post_trace *= decay;
        let mut arrival = false;
        let mut post = false;
        while self
            .schedule
            .front()
            .is_some_and(|event| event.0 == self.tick)
        {
            match self.schedule.pop_front().unwrap().1 {
                Action::CueSpike => self.spike(self.selected_cue.unwrap()),
                Action::Arrival => {
                    arrival = true;
                    let cue = self.selected_cue.unwrap();
                    self.last_arrival[cue] = Some(self.tick as f64);
                    self.event(EventKind::Arrival, cue, Some(self.weights[cue]));
                    if self.phase == Phase::Probe {
                        self.probe_input(cue);
                    }
                }
                Action::TargetSpike => {
                    post = true;
                    self.spike(TARGET);
                }
                Action::PairComplete => self.completed_pairs += 1,
            }
        }
        if self.phase == Phase::Training {
            // Read all old traces before any same-time increment. This gives
            // zero-lag pairs no within-pair LTP/LTD or insertion-order bias.
            for cue in 0..CUE_COUNT {
                let incoming = arrival && self.selected_cue == Some(cue);
                let delta = if post {
                    A_PLUS * self.pre_trace[cue]
                } else {
                    0.0
                } - if incoming {
                    A_MINUS * self.post_trace
                } else {
                    0.0
                };
                if delta != 0.0 {
                    self.weights[cue] = (self.weights[cue] + delta).clamp(MIN_WEIGHT, MAX_WEIGHT);
                    self.event(EventKind::Weight, cue, Some(self.weights[cue]));
                }
                if incoming {
                    self.pre_trace[cue] += 1.0;
                }
            }
            if post {
                self.post_trace += 1.0;
            }
        }
        if self.phase != Phase::Idle && self.tick >= self.end_tick {
            if self.phase == Phase::Probe {
                self.last_probe = self.pending_probe.take();
            }
            self.phase = Phase::Idle;
            self.pre_trace = [0.0; CUE_COUNT];
            self.post_trace = 0.0;
        }
    }

    pub fn snapshot(&self) -> TimingSnapshot {
        TimingSnapshot {
            time_ms: self.tick as f64,
            axon_delay_ms: AXON_DELAY_MS,
            phase: self.phase,
            weights: self.weights,
            voltages_mv: self.voltages,
            spike_counts: self.spike_counts,
            last_spike_ms: self.last_spike,
            last_arrival_ms: self.last_arrival,
            selected_cue: self.selected_cue,
            gap_ms: self.gap_ms,
            completed_pairs: self.completed_pairs,
            total_pairs: self.total_pairs,
            last_probe: self.last_probe.clone(),
            events: self.events.iter().cloned().collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finish(model: &mut TimingModel) {
        for _ in 0..100 {
            if model.phase == Phase::Idle {
                return;
            }
            model.advance(100.0).unwrap();
        }
        panic!("bounded protocol failed to finish");
    }

    #[test]
    fn isolated_pairs_follow_analytic_window_and_arrival_clock() {
        for gap in [-50, -10, 0, 10, 50] {
            let mut model = TimingModel::default();
            model.start_training(0, gap, 1).unwrap();
            finish(&mut model);
            let expected = INITIAL_WEIGHT
                + if gap > 0 {
                    A_PLUS * (-f64::from(gap) / TAU_TRACE_MS).exp()
                } else if gap < 0 {
                    -A_MINUS * (f64::from(gap) / TAU_TRACE_MS).exp()
                } else {
                    0.0
                };
            assert!((model.weights[0] - expected).abs() < 1e-12);
            assert_eq!(model.last_arrival[0], Some(100.0));
            assert_eq!(model.last_spike[0], Some(90.0));
            assert_eq!(model.last_spike[TARGET], Some(f64::from(100 + gap)));
            assert_eq!(model.weights[1..], [INITIAL_WEIGHT; 2]);
        }
    }

    #[test]
    fn eight_close_pairs_change_frozen_probe_but_distant_pairs_do_not() {
        for (gap, expected_spike) in [(10, true), (50, false), (-10, false), (-50, false)] {
            let mut model = TimingModel::default();
            model.start_probe(0).unwrap();
            finish(&mut model);
            assert!(!model.last_probe.as_ref().unwrap().spiked);
            assert_eq!(model.last_probe.as_ref().unwrap().peak_mv, -57.0);
            model.start_training(0, gap, 8).unwrap();
            finish(&mut model);
            let weights = model.weights;
            model.start_probe(0).unwrap();
            finish(&mut model);
            assert_eq!(model.last_probe.as_ref().unwrap().spiked, expected_spike);
            assert_eq!(model.weights, weights);
            model.start_probe(1).unwrap();
            finish(&mut model);
            assert!(!model.last_probe.as_ref().unwrap().spiked);
            assert_eq!(model.last_probe.as_ref().unwrap().peak_mv, -57.0);
        }
    }

    #[test]
    fn reversed_pairing_weakens_a_previously_responsive_pathway() {
        let mut model = TimingModel::default();
        model.start_training(2, 10, 8).unwrap();
        finish(&mut model);
        assert!(model.weights[2] > 0.6);
        model.start_training(2, -10, 8).unwrap();
        finish(&mut model);
        assert!(model.weights[2] < INITIAL_WEIGHT);
        model.start_probe(2).unwrap();
        finish(&mut model);
        assert!(!model.last_probe.unwrap().spiked);
    }

    #[test]
    fn induction_clamp_prevents_extra_spikes_even_at_saturated_strength() {
        for gap in [-10, 0, 10] {
            let mut model = TimingModel::default();
            model.weights[0] = MAX_WEIGHT;
            model.start_training(0, gap, 32).unwrap();
            finish(&mut model);
            assert_eq!(model.spike_counts, [32, 0, 0, 32]);
            assert_eq!(model.completed_pairs, 32);
            assert_eq!(model.voltages[TARGET], REST_MV);
            assert!(model.events.len() <= MAX_EVENTS);
        }
    }

    #[test]
    fn all_to_all_cross_pair_terms_are_explicit_and_zero_lag_has_no_order_bias() {
        let mut model = TimingModel::default();
        model.start_training(0, 0, 2).unwrap();
        finish(&mut model);
        let expected =
            INITIAL_WEIGHT + (A_PLUS - A_MINUS) * (-(PAIR_INTERVAL_MS as f64) / TAU_TRACE_MS).exp();
        assert!((model.weights[0] - expected).abs() < 1e-12);
    }

    #[test]
    fn free_leak_and_refractory_match_the_declared_equations() {
        let mut model = TimingModel::default();
        model.voltages[TARGET] = -55.0;
        model.advance(20.0).unwrap();
        assert!((model.voltages[TARGET] - (REST_MV + 10.0 * (-1.0_f64).exp())).abs() < 1e-12);
        assert_eq!(model.spike_counts[TARGET], 0);
        model.weights[0] = MAX_WEIGHT;
        model.probe_input(0);
        model.probe_input(0);
        assert_eq!(model.spike_counts[TARGET], 1);
        model.advance(1.0).unwrap();
        model.probe_input(0);
        assert_eq!(model.spike_counts[TARGET], 1);
        model.advance(1.0).unwrap();
        model.probe_input(0);
        assert_eq!(model.spike_counts[TARGET], 2);
    }

    #[test]
    fn frame_batching_and_pause_do_not_change_the_experiment() {
        let mut large = TimingModel::default();
        let mut small = large.clone();
        large.start_training(1, 10, 8).unwrap();
        small.start_training(1, 10, 8).unwrap();
        for _ in 0..8 {
            large.advance(250.0).unwrap();
        }
        for _ in 0..20_000 {
            small.advance(0.1).unwrap();
        }
        assert_eq!(large.snapshot(), small.snapshot());
        let paused = small.snapshot();
        small.advance(0.0).unwrap();
        assert_eq!(small.snapshot(), paused);
    }

    #[test]
    fn cancel_clears_transients_preserves_learning_and_reset_restores_everything() {
        let mut model = TimingModel::default();
        model.start_training(2, 10, 8).unwrap();
        for _ in 0..4 {
            model.advance(200.0).unwrap();
        }
        let learned = model.weights;
        assert!(learned[2] > INITIAL_WEIGHT);
        model.cancel();
        assert_eq!(model.weights, learned);
        assert_eq!(model.selected_cue, Some(2));
        assert_eq!(model.tick, 800);
        assert!(model.schedule.is_empty());
        assert_eq!(model.voltages, [REST_MV; 4]);
        assert_eq!(model.pre_trace, [0.0; 3]);
        assert_eq!(model.post_trace, 0.0);
        model.advance(200.0).unwrap();
        assert_eq!(model.weights, learned);
        model.reset();
        assert_eq!(model.snapshot(), TimingModel::default().snapshot());
    }

    #[test]
    fn invalid_inputs_are_atomic_and_active_trials_cannot_be_overwritten() {
        let mut model = TimingModel::default();
        let baseline = model.snapshot();
        for (cue, gap, pairs) in [(3, 10, 8), (0, 51, 8), (0, -51, 8), (0, 10, 0), (0, 10, 33)] {
            assert!(model.start_training(cue, gap, pairs).is_err());
            assert_eq!(model.snapshot(), baseline);
        }
        assert!(model.start_probe(3).is_err());
        for dt in [f64::NAN, f64::INFINITY, -1.0, 251.0] {
            assert!(model.advance(dt).is_err());
            assert_eq!(model.snapshot(), baseline);
        }
        model.start_training(0, 10, 8).unwrap();
        model.advance(100.0).unwrap();
        let busy = model.snapshot();
        assert!(model.start_probe(1).is_err());
        assert!(model.start_training(1, -10, 8).is_err());
        assert_eq!(model.snapshot(), busy);
    }

    #[test]
    fn long_training_is_bounded_and_finite_at_both_weight_limits() {
        let mut model = TimingModel::default();
        for gap in [10, -10] {
            for _ in 0..30 {
                model.start_training(0, gap, 32).unwrap();
                finish(&mut model);
                assert!(model
                    .weights
                    .iter()
                    .all(|w| w.is_finite() && (0.0..=1.0).contains(w)));
                assert!(model.voltages.iter().all(|v| v.is_finite()));
                assert!(model.schedule.is_empty());
            }
            assert_eq!(
                model.weights[0],
                if gap > 0 { MAX_WEIGHT } else { MIN_WEIGHT }
            );
        }
    }
}
