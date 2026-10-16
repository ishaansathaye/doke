//! A bounded, deterministic input-queued switch for explanation, not vendor emulation.
//!
//! Fixed-size packets, a shared 32-slot capacity, three inputs/outputs, one-tick
//! transfers and rotating arbitration are authored educational assumptions.
//! VOQ is represented by selecting each destination's first packet from a
//! canonical arrival-ordered ingress queue. No commercial ASIC timings, SDK,
//! buffer capacities or proprietary arbitration behavior are reproduced here.
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

pub const PORTS: usize = 3;
pub const BUFFER_CAPACITY: usize = 32;
pub const MAX_BURST: u32 = 64;
pub const MAX_ADVANCE: u32 = 4096;
pub const EVENT_CAPACITY: usize = 128;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueMode {
    Fifo,
    #[default]
    Voq,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct FabricConfig {
    pub queue_mode: QueueMode,
}

#[derive(Clone, Debug)]
struct Packet {
    id: u64,
    ingress: usize,
    egress: usize,
    born_tick: u64,
}

#[derive(Clone, Debug)]
struct Transfer {
    packet: Packet,
    grant_tick: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FabricPacket {
    pub id: u64,
    pub ingress: usize,
    pub egress: usize,
    pub born_tick: u64,
    pub age_ticks: u64,
    pub stage: String,
    pub node: String,
    pub grant_tick: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FabricQueue {
    pub node: String,
    pub ingress: usize,
    /// None for the shared FIFO; Some(destination) for a virtual output queue.
    pub egress: Option<usize>,
    pub packet_ids: Vec<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FabricEvent {
    pub sequence: u64,
    pub tick: u64,
    pub kind: String,
    pub packet_id: Option<u64>,
    pub from: String,
    pub to: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FabricSnapshot {
    pub schema_version: u32,
    pub config: FabricConfig,
    pub tick: u64,
    pub capacity_packets: usize,
    pub blocked: [bool; PORTS],
    pub queues: Vec<FabricQueue>,
    pub packets: Vec<FabricPacket>,
    /// Recent events only. Sequence numbers allow a renderer to de-duplicate.
    pub events: Vec<FabricEvent>,
    pub attempted: u64,
    pub admitted: u64,
    /// Rejected on admission because the shared capacity was full.
    pub dropped: u64,
    pub delivered: u64,
    pub delivered_by_egress: [u64; PORTS],
    pub buffered: usize,
    pub in_flight: usize,
    pub occupied: usize,
    /// Sum over delivered packets only; ticks include transit, not just queueing.
    pub total_latency_ticks: u64,
    pub max_latency_ticks: u64,
    pub last_delivered_id: Option<u64>,
    /// True iff attempted = dropped + delivered + all currently held packets.
    pub conserved: bool,
}

#[derive(Clone, Debug)]
pub struct FabricModel {
    config: FabricConfig,
    tick: u64,
    queues: [VecDeque<Packet>; PORTS],
    transfers: [Option<Transfer>; PORTS],
    blocked: [bool; PORTS],
    next_id: u64,
    next_ingress: usize,
    output_cursor: usize,
    input_cursor: [usize; PORTS],
    events: VecDeque<FabricEvent>,
    event_sequence: u64,
    attempted: u64,
    admitted: u64,
    dropped: u64,
    delivered: u64,
    delivered_by_egress: [u64; PORTS],
    total_latency_ticks: u64,
    max_latency_ticks: u64,
    last_delivered_id: Option<u64>,
}

impl Default for FabricModel {
    fn default() -> Self {
        Self::with_config(FabricConfig::default())
    }
}

impl FabricModel {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_config(config: FabricConfig) -> Self {
        Self {
            config,
            tick: 0,
            queues: std::array::from_fn(|_| VecDeque::new()),
            transfers: std::array::from_fn(|_| None),
            blocked: [false; PORTS],
            next_id: 1,
            next_ingress: 0,
            output_cursor: 0,
            input_cursor: [0; PORTS],
            events: VecDeque::new(),
            event_sequence: 0,
            attempted: 0,
            admitted: 0,
            dropped: 0,
            delivered: 0,
            delivered_by_egress: [0; PORTS],
            total_latency_ticks: 0,
            max_latency_ticks: 0,
            last_delivered_id: None,
        }
    }

    /// Reset packets, counters, blocks and arbitration, retaining the selected mode.
    pub fn reset(&mut self) {
        *self = Self::with_config(self.config);
    }

    pub fn set_mode(&mut self, mode: QueueMode) {
        if self.config.queue_mode != mode {
            self.config.queue_mode = mode;
            self.event("mode", None, "scheduler".into(), mode_name(mode).into());
        }
    }

    pub fn set_blocked(&mut self, egress: usize, blocked: bool) -> Result<(), &'static str> {
        if egress >= PORTS {
            return Err("Egress must be 0, 1 or 2");
        }
        if self.blocked[egress] != blocked {
            self.blocked[egress] = blocked;
            self.event(
                if blocked { "block" } else { "unblock" },
                None,
                "control".into(),
                output_node(egress),
            );
        }
        Ok(())
    }

    /// A bounded visitor burst distributed cyclically across the three inputs.
    /// Returns the number admitted; all valid attempts receive unique packet IDs.
    pub fn inject_burst(&mut self, egress: usize, count: u32) -> Result<u32, &'static str> {
        self.validate_injection(0, egress, count)?;
        let mut accepted = 0;
        for _ in 0..count {
            let ingress = self.next_ingress;
            self.next_ingress = (self.next_ingress + 1) % PORTS;
            accepted += u32::from(self.admit(ingress, egress));
        }
        Ok(accepted)
    }

    /// Explicit input for deterministic scenarios and tests.
    pub fn inject(
        &mut self,
        ingress: usize,
        egress: usize,
        count: u32,
    ) -> Result<u32, &'static str> {
        self.validate_injection(ingress, egress, count)?;
        Ok((0..count)
            .map(|_| u32::from(self.admit(ingress, egress)))
            .sum())
    }

    fn validate_injection(
        &self,
        ingress: usize,
        egress: usize,
        count: u32,
    ) -> Result<(), &'static str> {
        if ingress >= PORTS || egress >= PORTS {
            return Err("Ports must be 0, 1 or 2");
        }
        if !(1..=MAX_BURST).contains(&count) {
            return Err("Burst must contain 1 to 64 packets");
        }
        if self.next_id.checked_add(u64::from(count)).is_none() {
            return Err("Packet identifier capacity reached; reset the model");
        }
        Ok(())
    }

    fn occupied(&self) -> usize {
        self.queues.iter().map(VecDeque::len).sum::<usize>()
            + self.transfers.iter().filter(|t| t.is_some()).count()
    }

    fn admit(&mut self, ingress: usize, egress: usize) -> bool {
        let id = self.next_id;
        self.next_id += 1;
        self.attempted += 1;
        if self.occupied() == BUFFER_CAPACITY {
            self.dropped += 1;
            self.event("drop", Some(id), input_node(ingress), "drop".into());
            return false;
        }
        self.queues[ingress].push_back(Packet {
            id,
            ingress,
            egress,
            born_tick: self.tick,
        });
        self.admitted += 1;
        self.event(
            "admit",
            Some(id),
            input_node(ingress),
            queue_node(self.config.queue_mode, ingress, egress),
        );
        true
    }

    /// One authored logical tick. Prior transfers complete before new grants.
    /// Blocking an output also holds a previously granted transfer until release.
    pub fn step(&mut self) {
        self.tick = self.tick.saturating_add(1);
        for egress in 0..PORTS {
            if self.blocked[egress] {
                continue;
            }
            if let Some(transfer) = self.transfers[egress].take() {
                let packet = transfer.packet;
                let latency = self.tick - packet.born_tick;
                self.delivered += 1;
                self.delivered_by_egress[egress] += 1;
                self.total_latency_ticks = self.total_latency_ticks.saturating_add(latency);
                self.max_latency_ticks = self.max_latency_ticks.max(latency);
                self.last_delivered_id = Some(packet.id);
                self.event(
                    "deliver",
                    Some(packet.id),
                    "fabric".into(),
                    output_node(egress),
                );
            }
        }
        let mut input_used = [false; PORTS];
        for offset in 0..PORTS {
            let egress = (self.output_cursor + offset) % PORTS;
            if self.blocked[egress] || self.transfers[egress].is_some() {
                continue;
            }
            for distance in 0..PORTS {
                let ingress = (self.input_cursor[egress] + distance) % PORTS;
                if input_used[ingress] {
                    continue;
                }
                let position = match self.config.queue_mode {
                    QueueMode::Fifo => self.queues[ingress]
                        .front()
                        .filter(|p| p.egress == egress)
                        .map(|_| 0),
                    QueueMode::Voq => self.queues[ingress].iter().position(|p| p.egress == egress),
                };
                if let Some(position) = position {
                    let packet = self.queues[ingress].remove(position).unwrap();
                    self.event(
                        "credit",
                        Some(packet.id),
                        output_node(egress),
                        queue_node(self.config.queue_mode, ingress, egress),
                    );
                    self.event(
                        "transfer",
                        Some(packet.id),
                        queue_node(self.config.queue_mode, ingress, egress),
                        output_node(egress),
                    );
                    self.transfers[egress] = Some(Transfer {
                        packet,
                        grant_tick: self.tick,
                    });
                    input_used[ingress] = true;
                    self.input_cursor[egress] = (ingress + 1) % PORTS;
                    break;
                }
            }
        }
        self.output_cursor = (self.output_cursor + 1) % PORTS;
    }

    pub fn advance(&mut self, ticks: u32) -> Result<(), &'static str> {
        if ticks > MAX_ADVANCE {
            return Err("Advance is limited to 4096 ticks per call");
        }
        for _ in 0..ticks {
            self.step();
        }
        Ok(())
    }

    fn event(&mut self, kind: &str, packet_id: Option<u64>, from: String, to: String) {
        self.event_sequence = self.event_sequence.saturating_add(1);
        if self.events.len() == EVENT_CAPACITY {
            self.events.pop_front();
        }
        self.events.push_back(FabricEvent {
            sequence: self.event_sequence,
            tick: self.tick,
            kind: kind.into(),
            packet_id,
            from,
            to,
        });
    }

    pub fn snapshot(&self) -> FabricSnapshot {
        let mut queues = Vec::new();
        let mut packets = Vec::new();
        for (ingress, queue) in self.queues.iter().enumerate() {
            if self.config.queue_mode == QueueMode::Fifo {
                queues.push(FabricQueue {
                    node: queue_node(QueueMode::Fifo, ingress, 0),
                    ingress,
                    egress: None,
                    packet_ids: queue.iter().map(|p| p.id).collect(),
                });
            } else {
                for egress in 0..PORTS {
                    queues.push(FabricQueue {
                        node: queue_node(QueueMode::Voq, ingress, egress),
                        ingress,
                        egress: Some(egress),
                        packet_ids: queue
                            .iter()
                            .filter(|p| p.egress == egress)
                            .map(|p| p.id)
                            .collect(),
                    });
                }
            }
            for p in queue {
                packets.push(FabricPacket {
                    id: p.id,
                    ingress: p.ingress,
                    egress: p.egress,
                    born_tick: p.born_tick,
                    age_ticks: self.tick - p.born_tick,
                    stage: "queued".into(),
                    node: queue_node(self.config.queue_mode, ingress, p.egress),
                    grant_tick: None,
                });
            }
        }
        for transfer in self.transfers.iter().flatten() {
            let p = &transfer.packet;
            packets.push(FabricPacket {
                id: p.id,
                ingress: p.ingress,
                egress: p.egress,
                born_tick: p.born_tick,
                age_ticks: self.tick - p.born_tick,
                stage: "transfer".into(),
                node: "fabric".into(),
                grant_tick: Some(transfer.grant_tick),
            });
        }
        packets.sort_by_key(|p| p.id);
        let buffered = self.queues.iter().map(VecDeque::len).sum();
        let in_flight = self.transfers.iter().filter(|t| t.is_some()).count();
        let occupied = buffered + in_flight;
        FabricSnapshot {
            schema_version: 1,
            config: self.config,
            tick: self.tick,
            capacity_packets: BUFFER_CAPACITY,
            blocked: self.blocked,
            queues,
            packets,
            events: self.events.iter().cloned().collect(),
            attempted: self.attempted,
            admitted: self.admitted,
            dropped: self.dropped,
            delivered: self.delivered,
            delivered_by_egress: self.delivered_by_egress,
            buffered,
            in_flight,
            occupied,
            total_latency_ticks: self.total_latency_ticks,
            max_latency_ticks: self.max_latency_ticks,
            last_delivered_id: self.last_delivered_id,
            conserved: self.attempted == self.dropped + self.delivered + occupied as u64
                && self.admitted == self.delivered + occupied as u64,
        }
    }
}

fn mode_name(mode: QueueMode) -> &'static str {
    match mode {
        QueueMode::Fifo => "fifo",
        QueueMode::Voq => "voq",
    }
}
fn input_node(ingress: usize) -> String {
    format!("ingress-{ingress}")
}
fn output_node(egress: usize) -> String {
    format!("egress-{egress}")
}
fn queue_node(mode: QueueMode, ingress: usize, egress: usize) -> String {
    match mode {
        QueueMode::Fifo => format!("fifo-{ingress}"),
        QueueMode::Voq => format!("voq-{ingress}-{egress}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn assert_conserved(model: &FabricModel) {
        let s = model.snapshot();
        assert!(s.conserved);
        assert!(s.occupied <= BUFFER_CAPACITY);
        assert_eq!(s.packets.len(), s.occupied);
        assert_eq!(
            s.packets.iter().map(|p| p.id).collect::<HashSet<_>>().len(),
            s.occupied
        );
        assert_eq!(
            s.queues.iter().map(|q| q.packet_ids.len()).sum::<usize>(),
            s.buffered
        );
    }

    #[test]
    fn voq_avoids_blocked_fifo_head_for_the_same_input_sequence() {
        let mut fifo = FabricModel::with_config(FabricConfig {
            queue_mode: QueueMode::Fifo,
        });
        fifo.set_blocked(0, true).unwrap();
        fifo.inject(0, 0, 1).unwrap();
        fifo.inject(0, 1, 1).unwrap();
        let mut voq = fifo.clone();
        voq.set_mode(QueueMode::Voq);
        fifo.advance(4).unwrap();
        voq.advance(4).unwrap();
        assert_eq!(fifo.snapshot().delivered, 0);
        assert_eq!(voq.snapshot().delivered_by_egress, [0, 1, 0]);
        assert_eq!(voq.snapshot().packets[0].id, 1);
        fifo.set_blocked(0, false).unwrap();
        voq.set_blocked(0, false).unwrap();
        fifo.advance(4).unwrap();
        voq.advance(4).unwrap();
        assert_eq!(fifo.snapshot().delivered, 2);
        assert_eq!(voq.snapshot().delivered, 2);
        assert_conserved(&fifo);
        assert_conserved(&voq);
    }

    #[test]
    fn shared_capacity_drops_only_excess_and_includes_transit() {
        let mut m = FabricModel::default();
        assert_eq!(m.inject_burst(0, 40).unwrap(), 32);
        assert_eq!(m.snapshot().dropped, 8);
        m.step();
        assert_eq!(m.snapshot().in_flight, 1);
        assert_eq!(m.inject(1, 1, 1).unwrap(), 0);
        m.advance(40).unwrap();
        assert_eq!(m.snapshot().delivered, 32);
        assert_eq!(m.snapshot().dropped, 9);
        assert_conserved(&m);
    }

    #[test]
    fn blocking_a_granted_transfer_holds_it_and_consumes_credit() {
        let mut m = FabricModel::default();
        m.inject(0, 0, 2).unwrap();
        m.step();
        m.set_blocked(0, true).unwrap();
        m.advance(5).unwrap();
        assert_eq!(m.snapshot().in_flight, 1);
        assert_eq!(m.snapshot().buffered, 1);
        assert_eq!(m.snapshot().delivered, 0);
        m.set_blocked(0, false).unwrap();
        m.advance(2).unwrap();
        assert_eq!(m.snapshot().delivered, 2);
        assert_eq!(m.snapshot().total_latency_ticks, 15);
        assert_conserved(&m);
    }

    #[test]
    fn grants_use_each_input_and_output_at_most_once_per_tick() {
        let mut m = FabricModel::default();
        for i in 0..PORTS {
            for o in 0..PORTS {
                m.inject(i, o, 2).unwrap();
            }
        }
        for _ in 0..12 {
            m.step();
            let snapshot = m.snapshot();
            let transfers: Vec<_> = snapshot
                .packets
                .iter()
                .filter(|p| p.stage == "transfer")
                .collect();
            assert_eq!(
                transfers
                    .iter()
                    .map(|p| p.ingress)
                    .collect::<HashSet<_>>()
                    .len(),
                transfers.len()
            );
            assert_eq!(
                transfers
                    .iter()
                    .map(|p| p.egress)
                    .collect::<HashSet<_>>()
                    .len(),
                transfers.len()
            );
            assert_conserved(&m);
        }
        assert_eq!(m.snapshot().delivered, 18);
    }

    #[test]
    fn competing_inputs_receive_round_robin_service() {
        let mut m = FabricModel::default();
        for i in 0..PORTS {
            m.inject(i, 0, 5).unwrap();
        }
        let mut order = Vec::new();
        for _ in 0..6 {
            m.step();
            order.push(
                m.snapshot()
                    .packets
                    .iter()
                    .find(|p| p.stage == "transfer")
                    .unwrap()
                    .ingress,
            );
        }
        assert_eq!(order, [0, 1, 2, 0, 1, 2]);
    }

    #[test]
    fn same_input_destinations_also_receive_bounded_service() {
        let mut m = FabricModel::default();
        for o in 0..PORTS {
            m.inject(0, o, 4).unwrap();
        }
        m.advance(4).unwrap();
        assert_eq!(m.snapshot().delivered_by_egress, [1, 1, 1]);
    }

    #[test]
    fn mode_changes_reorganize_without_losing_packets_or_ids() {
        let mut m = FabricModel::default();
        m.inject_burst(2, 7).unwrap();
        let before = m.snapshot();
        m.set_mode(QueueMode::Fifo);
        let after = m.snapshot();
        assert_eq!(after.queues.len(), 3);
        assert_eq!(
            before.packets.iter().map(|p| p.id).collect::<Vec<_>>(),
            after.packets.iter().map(|p| p.id).collect::<Vec<_>>()
        );
        assert_eq!(after.admitted, before.admitted);
        assert_conserved(&m);
    }

    #[test]
    fn invalid_commands_are_atomic() {
        let mut m = FabricModel::default();
        let before = m.snapshot();
        assert!(m.inject(3, 0, 4).is_err());
        assert!(m.inject_burst(3, 4).is_err());
        assert!(m.inject_burst(0, 0).is_err());
        assert!(m.inject_burst(0, MAX_BURST + 1).is_err());
        assert!(m.set_blocked(3, true).is_err());
        assert!(m.advance(MAX_ADVANCE + 1).is_err());
        assert_eq!(before, m.snapshot());
    }

    #[test]
    fn replay_is_deterministic_and_reset_retains_only_mode() {
        fn run(m: &mut FabricModel) {
            m.inject_burst(0, 12).unwrap();
            m.inject_burst(1, 12).unwrap();
            m.set_blocked(0, true).unwrap();
            m.advance(5).unwrap();
            m.set_blocked(0, false).unwrap();
            m.advance(8).unwrap();
        }
        let mut a = FabricModel::default();
        let mut b = FabricModel::default();
        run(&mut a);
        for _ in 0..50 {
            let _ = a.snapshot();
        }
        run(&mut b);
        assert_eq!(a.snapshot(), b.snapshot());
        a.set_mode(QueueMode::Fifo);
        a.reset();
        assert_eq!(
            a.snapshot(),
            FabricModel::with_config(FabricConfig {
                queue_mode: QueueMode::Fifo
            })
            .snapshot()
        );
    }

    #[test]
    fn batched_advance_matches_individual_ticks_across_interventions() {
        let mut batched = FabricModel::default();
        let mut stepped = FabricModel::default();
        for phase in 0..12 {
            for model in [&mut batched, &mut stepped] {
                model.inject_burst(phase % PORTS, 7).unwrap();
                model
                    .set_blocked((phase + 1) % PORTS, phase % 3 == 0)
                    .unwrap();
                model.set_mode(if phase % 2 == 0 {
                    QueueMode::Fifo
                } else {
                    QueueMode::Voq
                });
            }
            let ticks = (phase % 5 + 1) as u32;
            batched.advance(ticks).unwrap();
            for _ in 0..ticks {
                stepped.step();
            }
            assert_eq!(batched.snapshot(), stepped.snapshot());
            assert_conserved(&batched);
        }
        let before = batched.snapshot();
        batched.advance(0).unwrap();
        assert_eq!(before, batched.snapshot());
    }

    #[test]
    fn changing_mode_preserves_a_blocked_transfer_and_destination_order() {
        let mut m = FabricModel::with_config(FabricConfig {
            queue_mode: QueueMode::Fifo,
        });
        m.inject(0, 0, 2).unwrap(); // ids 1,2: same destination, arrival order
        m.inject(0, 1, 1).unwrap(); // id 3: independent destination behind them
        m.step(); // id 1 owns the output credit
        m.set_blocked(0, true).unwrap();
        m.set_mode(QueueMode::Voq);
        m.advance(2).unwrap(); // id 3 bypasses blocked id 2, then completes
        let held = m.snapshot();
        assert_eq!(held.delivered, 1);
        assert_eq!(held.last_delivered_id, Some(3));
        assert_eq!(held.in_flight, 1);
        let packet = held.packets.iter().find(|p| p.id == 1).unwrap();
        assert_eq!(packet.stage, "transfer");
        assert_eq!(packet.grant_tick, Some(1));
        assert_conserved(&m);
        m.set_mode(QueueMode::Fifo);
        m.advance(2).unwrap();
        assert_eq!(m.snapshot().delivered, 1);
        assert_eq!(m.snapshot().in_flight, 1);
        m.set_blocked(0, false).unwrap();
        m.advance(2).unwrap();
        let final_state = m.snapshot();
        let delivery_order: Vec<_> = final_state
            .events
            .iter()
            .filter(|e| e.kind == "deliver")
            .map(|e| e.packet_id.unwrap())
            .collect();
        assert_eq!(delivery_order, [3, 1, 2]);
        assert_eq!(final_state.delivered_by_egress, [2, 1, 0]);
        assert_eq!(final_state.occupied, 0);
        assert_conserved(&m);
    }

    #[test]
    fn long_intervention_stream_remains_bounded_and_conserved() {
        let mut m = FabricModel::default();
        for i in 0..1000 {
            m.inject_burst(i % PORTS, 4).unwrap();
            m.set_blocked((i + 1) % PORTS, i % 5 == 0).unwrap();
            if i % 7 == 0 {
                m.set_mode(if i % 2 == 0 {
                    QueueMode::Fifo
                } else {
                    QueueMode::Voq
                });
            }
            m.step();
            assert_conserved(&m);
            assert!(m.snapshot().events.len() <= EVENT_CAPACITY);
        }
        for i in 0..PORTS {
            m.set_blocked(i, false).unwrap();
        }
        m.advance(100).unwrap();
        assert_eq!(m.snapshot().occupied, 0);
        assert_conserved(&m);
        let json = serde_json::to_value(m.snapshot()).unwrap();
        assert!(json["config"]["queue_mode"].is_string());
    }
}
