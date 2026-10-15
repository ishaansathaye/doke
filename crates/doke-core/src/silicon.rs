//! Small deterministic dataflow models, not cycle-accurate vendor emulators.
//! All three machines compute C=A*B exactly with i32 arithmetic. Public chip
//! specifications are deliberately absent from the timing/resource configuration.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, VecDeque};

const SIDE: usize = 8;
const CELLS: usize = SIDE * SIDE;
const MAX_BATCH: u32 = 256;
const TRANSFER_HISTORY: usize = 64;
const MEMORY_SLOTS: usize = 4;
const HIT_TICKS: u64 = 1;
const MISS_TICKS: u64 = 7;
const MAC_TICKS: u64 = 2;
const CACHE_LINES: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Cpu,
    Gpu,
    Tensor,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Layout {
    Packed,
    Strided,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Filter {
    Difference,
    Identity,
    Mix,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SiliconConfig {
    pub mode: Mode,
    pub input: Vec<i32>,
    pub filter: Filter,
    pub layout: Layout,
    pub cache_enabled: bool,
    pub issue_width: u8,
}
impl Default for SiliconConfig {
    fn default() -> Self {
        Self {
            mode: Mode::Cpu,
            input: (0..CELLS)
                .map(|i| {
                    if (i / SIDE + i % SIDE).is_multiple_of(3) {
                        6
                    } else {
                        1
                    }
                })
                .collect(),
            filter: Filter::Difference,
            layout: Layout::Packed,
            cache_enabled: true,
            issue_width: 2,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Ready,
    Running,
    Complete,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Counters {
    pub loads: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub merged_misses: u64,
    pub sectors: u64,
    /// External memory read payload (including fetched sectors/lines) plus final writes.
    pub bytes_moved: u64,
    pub issued: u64,
    pub macs: u64,
    pub completed_outputs: u64,
    pub active_lane_ops: u64,
    pub issued_lane_slots: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Transfer {
    pub id: u64,
    pub from: String,
    pub to: String,
    pub start_tick: u64,
    pub end_tick: u64,
    pub bytes: u32,
    pub value: Option<i32>,
}
#[derive(Clone, Debug, Serialize)]
pub struct NodeState {
    pub id: String,
    pub state: &'static str,
    pub occupancy: usize,
    pub capacity: usize,
}
#[derive(Clone, Debug, Serialize)]
pub struct LaneState {
    pub lane: usize,
    pub active: bool,
    pub output_index: Option<usize>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Rules {
    pub label: &'static str,
    pub version: u32,
    pub time_unit: &'static str,
    pub cpu_hit_ticks: u64,
    pub cpu_miss_ticks: u64,
    pub mac_ticks: u64,
    pub memory_slots: usize,
    pub cpu_cache_line_bytes: u32,
    pub cpu_cache_lines: usize,
    pub cpu_cache_policy: &'static str,
    pub gpu_sector_bytes: u32,
    pub transfer_base_ticks: u64,
    pub sectors_per_transfer_tick: u32,
    pub gpu_warp_lanes: usize,
    pub tensor_tile_side: usize,
    pub tensor_mac_ticks: u64,
    pub tensor_wave_ticks: usize,
    pub memory_slot_meaning: &'static str,
}
#[derive(Clone, Debug, Serialize)]
pub struct SiliconSnapshot {
    pub tick: u64,
    pub status: RunStatus,
    pub mode: Mode,
    pub input: Vec<i32>,
    pub weights: Vec<i32>,
    pub output: Vec<i32>,
    pub valid: Vec<bool>,
    pub nodes: Vec<NodeState>,
    pub transfers: Vec<Transfer>,
    pub lanes: Vec<LaneState>,
    /// Warp or output-tile currently represented by lane/PE nodes.
    pub group_index: Option<usize>,
    pub counters: Counters,
    pub rules: Rules,
    pub config: SiliconConfig,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    LoadA,
    WaitingA,
    LoadB,
    WaitingB,
    Mac,
    WaitingMac,
    Done,
}
#[derive(Clone, Debug)]
struct Job {
    k: usize,
    a: i32,
    b: i32,
    sum: i32,
    stage: Stage,
}
impl Default for Job {
    fn default() -> Self {
        Self {
            k: 0,
            a: 0,
            b: 0,
            sum: 0,
            stage: Stage::LoadA,
        }
    }
}
#[derive(Clone, Debug)]
enum Completion {
    Load {
        job: usize,
        a: bool,
        value: i32,
        fill: Option<u64>,
    },
    Mac {
        job: usize,
    },
    WarpLoad {
        warp: usize,
    },
    WarpMac {
        warp: usize,
    },
    TileLoad {
        tile: usize,
    },
    TileMac {
        tile: usize,
        a: Box<[Option<(usize, i32)>; 16]>,
        b: Box<[Option<(usize, i32)>; 16]>,
    },
    Store {
        values: Vec<(usize, i32)>,
    },
}
#[derive(Clone, Debug)]
struct Pending {
    end: u64,
    action: Completion,
}
#[derive(Clone, Debug)]
struct Group {
    k: usize,
    stage: Stage,
}
impl Default for Group {
    fn default() -> Self {
        Self {
            k: 0,
            stage: Stage::LoadA,
        }
    }
}

#[derive(Clone, Debug)]
pub struct SiliconModel {
    config: SiliconConfig,
    weights: Vec<i32>,
    tick: u64,
    status: RunStatus,
    output: Vec<i32>,
    valid: Vec<bool>,
    jobs: Vec<Job>,
    warps: Vec<Group>,
    tiles: Vec<Group>,
    pending: Vec<Pending>,
    cache: VecDeque<u64>,
    transfers: VecDeque<Transfer>,
    next_transfer: u64,
    counters: Counters,
    cursor: usize,
    selected_group: Option<usize>,
    scratch_a: [i32; 32],
    scratch_b: [i32; 32],
    pe_a: [Option<(usize, i32)>; 16],
    pe_b: [Option<(usize, i32)>; 16],
}

/// Distinct 32-byte sectors touched by active accesses. Address overflow is an
/// error, and inactive lanes cannot generate traffic. This counts request sectors,
/// not downstream DRAM transactions. Each access may cross a sector boundary.
pub fn coalesced_sectors(
    addresses: &[u64],
    active: &[bool],
    bytes: u32,
) -> Result<Vec<u64>, &'static str> {
    if addresses.len() != active.len() || addresses.len() > 32 || !(1..=16).contains(&bytes) {
        return Err("Expected at most 32 lanes and 1..16 bytes per access");
    }
    let mut sectors = BTreeSet::new();
    for (&address, &enabled) in addresses.iter().zip(active) {
        if enabled {
            let last = address
                .checked_add(u64::from(bytes) - 1)
                .ok_or("Address overflow")?;
            for sector in address / 32..=last / 32 {
                sectors.insert(sector);
            }
        }
    }
    Ok(sectors.into_iter().collect())
}

fn weights(filter: Filter) -> Vec<i32> {
    (0..CELLS)
        .map(|i| {
            let k = i / SIDE;
            let col = i % SIDE;
            match filter {
                Filter::Identity => i32::from(k == col),
                // C[row,col] = A[row,col] - A[row,col-1], with a zero left boundary.
                Filter::Difference => {
                    if k == col {
                        1
                    } else if col > 0 && k == col - 1 {
                        -1
                    } else {
                        0
                    }
                }
                Filter::Mix => {
                    if k == col {
                        2
                    } else if k.abs_diff(col) == 1 {
                        1
                    } else {
                        0
                    }
                }
            }
        })
        .collect()
}

impl SiliconModel {
    pub fn new(config: SiliconConfig) -> Result<Self, &'static str> {
        if config.input.len() != CELLS || config.input.iter().any(|v| !(-8..=8).contains(v)) {
            return Err("Input must contain exactly 64 integers in -8..8");
        }
        if !(1..=2).contains(&config.issue_width) {
            return Err("CPU issue width must be 1 or 2");
        }
        let matrix = weights(config.filter);
        Ok(Self {
            config,
            weights: matrix,
            tick: 0,
            status: RunStatus::Ready,
            output: vec![0; CELLS],
            valid: vec![false; CELLS],
            jobs: vec![Job::default(); CELLS],
            warps: vec![Group::default(); 2],
            tiles: vec![Group::default(); 4],
            pending: Vec::new(),
            cache: VecDeque::new(),
            transfers: VecDeque::new(),
            next_transfer: 0,
            counters: Counters::default(),
            cursor: 0,
            selected_group: None,
            scratch_a: [0; 32],
            scratch_b: [0; 32],
            pe_a: [None; 16],
            pe_b: [None; 16],
        })
    }
    pub fn reset(&mut self) {
        *self = Self::new(self.config.clone()).expect("Validated configuration");
    }
    pub fn config(&self) -> &SiliconConfig {
        &self.config
    }
    pub fn step(&mut self, ticks: u32) -> Result<(), &'static str> {
        if ticks > MAX_BATCH {
            return Err("Tick batch must be 0..256");
        }
        for _ in 0..ticks {
            if self.status == RunStatus::Complete {
                break;
            }
            self.status = RunStatus::Running;
            self.tick += 1;
            self.complete_pending();
            match self.config.mode {
                Mode::Cpu => self.issue_cpu(),
                Mode::Gpu => self.issue_gpu(),
                Mode::Tensor => self.issue_tensor(),
            }
            if self.valid.iter().all(|v| *v)
                && self.pending.is_empty()
                && self.transfers.iter().all(|t| t.end_tick <= self.tick)
            {
                self.status = RunStatus::Complete;
            }
        }
        Ok(())
    }
    pub fn run_to_completion(&mut self, max_ticks: u32) -> Result<(), &'static str> {
        if max_ticks > 100_000 {
            return Err("Run budget must not exceed 100000 ticks");
        }
        for _ in 0..max_ticks {
            if self.status == RunStatus::Complete {
                return Ok(());
            }
            self.step(1)?;
        }
        if self.status == RunStatus::Complete {
            Ok(())
        } else {
            Err("Run budget exhausted")
        }
    }
    fn transfer(&mut self, from: &str, to: &str, end: u64, bytes: u32, value: Option<i32>) {
        self.next_transfer += 1;
        self.transfers.push_back(Transfer {
            id: self.next_transfer,
            from: from.into(),
            to: to.into(),
            start_tick: self.tick,
            end_tick: end.max(self.tick + 1),
            bytes,
            value,
        });
        while self.transfers.len() > TRANSFER_HISTORY {
            self.transfers.pop_front();
        }
    }
    // A remains row-major. B is either row-major or physically transposed. Both
    // layouts represent the SAME mathematical B. Strided makes adjacent output
    // columns read B at 32-byte strides for a fixed k.
    fn address(&self, a: bool, row: usize, col: usize, k: usize) -> u64 {
        if a {
            ((row * SIDE + k) * 4) as u64
        } else {
            4096 + (match self.config.layout {
                Layout::Packed => k * SIDE + col,
                Layout::Strided => col * SIDE + k,
            } * 4) as u64
        }
    }
    fn cache_hit(&mut self, line: u64) -> bool {
        if let Some(at) = self.cache.iter().position(|v| *v == line) {
            self.cache.remove(at);
            self.cache.push_back(line);
            true
        } else {
            false
        }
    }
    fn fill_cache(&mut self, line: u64) {
        if let Some(at) = self.cache.iter().position(|v| *v == line) {
            self.cache.remove(at);
        }
        self.cache.push_back(line);
        while self.cache.len() > CACHE_LINES {
            self.cache.pop_front();
        }
    }
    fn memory_inflight(&self) -> usize {
        self.pending
            .iter()
            .filter(|p| {
                matches!(
                    p.action,
                    Completion::Load { .. }
                        | Completion::WarpLoad { .. }
                        | Completion::TileLoad { .. }
                )
            })
            .count()
    }
    fn compute_inflight(&self) -> usize {
        self.pending
            .iter()
            .filter(|p| {
                matches!(
                    p.action,
                    Completion::Mac { .. }
                        | Completion::WarpMac { .. }
                        | Completion::TileMac { .. }
                )
            })
            .count()
    }
    fn issue_cpu(&mut self) {
        let mut issued = 0;
        // Finite independent dot products, round-robin oldest scan. This is not
        // an x86 front end, reorder buffer or speculative execution simulator.
        for offset in 0..CELLS {
            if issued >= self.config.issue_width {
                break;
            }
            let id = (self.cursor + offset) % CELLS;
            let stage = self.jobs[id].stage;
            match stage {
                Stage::LoadA | Stage::LoadB if self.memory_inflight() < MEMORY_SLOTS => {
                    let a = stage == Stage::LoadA;
                    let k = self.jobs[id].k;
                    let address = self.address(a, id / SIDE, id % SIDE, k);
                    let value = if a {
                        self.config.input[id / SIDE * SIDE + k]
                    } else {
                        self.weights[k * SIDE + id % SIDE]
                    };
                    let line = address / 64;
                    let mut fill = None;
                    let mut source = "memory";
                    let end;
                    self.counters.loads += 1;
                    if self.config.cache_enabled && self.cache_hit(line) {
                        self.counters.cache_hits += 1;
                        source = "cache";
                        end = self.tick + HIT_TICKS;
                    } else if let Some(p) = self.pending.iter().find(|p| self.config.cache_enabled && matches!(p.action, Completion::Load { fill: Some(l), .. } if l == line)) {
                        self.counters.merged_misses += 1;
                        end = p.end;
                    } else {
                        self.counters.cache_misses += 1;
                        let bytes = if self.config.cache_enabled { 64 } else { 4 };
                        self.counters.bytes_moved += bytes;
                        if self.config.cache_enabled { fill = Some(line); }
                        end = self.tick + MISS_TICKS;
                        if fill.is_some() { self.transfer("memory", "cache", end, 64, Some(value)); }
                    }
                    self.jobs[id].stage = if a { Stage::WaitingA } else { Stage::WaitingB };
                    self.pending.push(Pending {
                        end,
                        action: Completion::Load {
                            job: id,
                            a,
                            value,
                            fill,
                        },
                    });
                    self.transfer(source, "registers", end, 4, Some(value));
                    self.counters.issued += 1;
                    issued += 1;
                }
                Stage::Mac if self.compute_inflight() < self.config.issue_width as usize => {
                    let end = self.tick + MAC_TICKS;
                    self.jobs[id].stage = Stage::WaitingMac;
                    self.pending.push(Pending {
                        end,
                        action: Completion::Mac { job: id },
                    });
                    self.transfer(
                        "registers",
                        "compute",
                        end,
                        8,
                        Some(self.jobs[id].a * self.jobs[id].b),
                    );
                    self.counters.issued += 1;
                    issued += 1;
                }
                _ => {}
            }
        }
        self.cursor = (self.cursor + 1) % CELLS;
    }
    fn group_load(&mut self, ids: &[usize], k: usize, destination: &str) -> u64 {
        let active = vec![true; ids.len()];
        let a: Vec<_> = ids
            .iter()
            .map(|id| self.address(true, id / SIDE, id % SIDE, k))
            .collect();
        let b: Vec<_> = ids
            .iter()
            .map(|id| self.address(false, id / SIDE, id % SIDE, k))
            .collect();
        let sectors = coalesced_sectors(&a, &active, 4)
            .expect("Bounded addresses")
            .len()
            + coalesced_sectors(&b, &active, 4)
                .expect("Bounded addresses")
                .len();
        self.counters.loads += (ids.len() * 2) as u64;
        self.counters.sectors += sectors as u64;
        self.counters.bytes_moved += (sectors * 32) as u64;
        let end = self.tick + 2 + (sectors as u64).div_ceil(4);
        self.transfer("memory", destination, end, (sectors * 32) as u32, None);
        end
    }
    fn issue_gpu(&mut self) {
        // One modeled warp issue slot, two resident warps; not all SM resources.
        for offset in 0..2 {
            let warp = (self.cursor + offset) % 2;
            match self.warps[warp].stage {
                Stage::LoadA => {
                    let ids: Vec<_> = (warp * 32..warp * 32 + 32).collect();
                    let end = self.group_load(&ids, self.warps[warp].k, "registers");
                    self.warps[warp].stage = Stage::WaitingA;
                    self.pending.push(Pending {
                        end,
                        action: Completion::WarpLoad { warp },
                    });
                    self.selected_group = Some(warp);
                }
                Stage::Mac => {
                    let end = self.tick + MAC_TICKS;
                    self.warps[warp].stage = Stage::WaitingMac;
                    self.pending.push(Pending {
                        end,
                        action: Completion::WarpMac { warp },
                    });
                    self.transfer("registers", "compute", end, 32 * 8, None);
                    self.selected_group = Some(warp);
                }
                _ => continue,
            }
            self.counters.issued += 1;
            self.cursor = (warp + 1) % 2;
            break;
        }
    }
    fn tile_ids(tile: usize) -> Vec<usize> {
        let r = tile / 2 * 4;
        let c = tile % 2 * 4;
        (0..4)
            .flat_map(|dr| (0..4).map(move |dc| (r + dr) * SIDE + c + dc))
            .collect()
    }
    fn issue_tensor(&mut self) {
        // An actual skewed systolic wave. A advances east, B advances south;
        // a PE performs one MAC only when both operands with the same k arrive.
        // This declared 4x4 array is not a vendor Tensor Core or TPU layout.
        let Some(tile) = self.tiles.iter().position(|t| t.stage != Stage::Done) else {
            return;
        };
        match self.tiles[tile].stage {
            Stage::LoadA => {
                let r0 = tile / 2 * 4;
                let c0 = tile % 2 * 4;
                let mut a = Vec::new();
                let mut b = Vec::new();
                for local in 0..4 {
                    for k in 0..8 {
                        a.push(self.address(true, r0 + local, 0, k));
                        b.push(self.address(false, 0, c0 + local, k));
                    }
                }
                let sectors = coalesced_sectors(&a, &[true; 32], 4)
                    .expect("Bounded addresses")
                    .len()
                    + coalesced_sectors(&b, &[true; 32], 4)
                        .expect("Bounded addresses")
                        .len();
                self.counters.loads += 64;
                self.counters.sectors += sectors as u64;
                self.counters.bytes_moved += (sectors * 32) as u64;
                let end = self.tick + 2 + (sectors as u64).div_ceil(4);
                self.transfer("memory", "scratch", end, (sectors * 32) as u32, None);
                self.tiles[tile].stage = Stage::WaitingA;
                self.pending.push(Pending {
                    end,
                    action: Completion::TileLoad { tile },
                });
                self.counters.issued += 1;
                self.selected_group = Some(tile);
            }
            Stage::Mac => {
                let wave = self.tiles[tile].k;
                let end = self.tick + 1;
                let mut a = [None; 16];
                let mut b = [None; 16];
                for row in 0..4 {
                    for col in 0..4 {
                        let pe = row * 4 + col;
                        a[pe] = if col == 0 {
                            wave.checked_sub(row)
                                .filter(|k| *k < 8)
                                .map(|k| (k, self.scratch_a[row * 8 + k]))
                        } else {
                            self.pe_a[pe - 1]
                        };
                        b[pe] = if row == 0 {
                            wave.checked_sub(col)
                                .filter(|k| *k < 8)
                                .map(|k| (k, self.scratch_b[col * 8 + k]))
                        } else {
                            self.pe_b[pe - 4]
                        };
                        if let Some((_, value)) = a[pe] {
                            let from = if col == 0 {
                                "scratch".into()
                            } else {
                                format!("pe{}", pe - 1)
                            };
                            self.transfer(&from, &format!("pe{pe}"), end, 4, Some(value));
                        }
                        if let Some((_, value)) = b[pe] {
                            let from = if row == 0 {
                                "scratch".into()
                            } else {
                                format!("pe{}", pe - 4)
                            };
                            self.transfer(&from, &format!("pe{pe}"), end, 4, Some(value));
                        }
                    }
                }
                self.pending.push(Pending {
                    end,
                    action: Completion::TileMac {
                        tile,
                        a: Box::new(a),
                        b: Box::new(b),
                    },
                });
                self.tiles[tile].stage = Stage::WaitingMac;
                self.counters.issued += 1;
                self.selected_group = Some(tile);
            }
            _ => {}
        }
    }
    fn finish_output(&mut self, id: usize, value: i32) {
        self.output[id] = value;
        self.valid[id] = true;
        self.counters.completed_outputs += 1;
        // External traffic: memory reads plus final output writes.
        self.counters.bytes_moved += 4;
    }
    fn complete_pending(&mut self) {
        let mut finished = Vec::new();
        self.pending.retain(|p| {
            if p.end <= self.tick {
                finished.push(p.action.clone());
                false
            } else {
                true
            }
        });
        for action in finished {
            match action {
                Completion::Load {
                    job,
                    a,
                    value,
                    fill,
                } => {
                    if let Some(line) = fill {
                        self.fill_cache(line);
                    }
                    if a {
                        self.jobs[job].a = value;
                        self.jobs[job].stage = Stage::LoadB;
                    } else {
                        self.jobs[job].b = value;
                        self.jobs[job].stage = Stage::Mac;
                    }
                }
                Completion::Mac { job } => {
                    let j = &mut self.jobs[job];
                    j.sum += j.a * j.b;
                    j.k += 1;
                    self.counters.macs += 1;
                    if j.k == SIDE {
                        let value = j.sum;
                        j.stage = Stage::Done;
                        self.pending.push(Pending {
                            end: self.tick + 1,
                            action: Completion::Store {
                                values: vec![(job, value)],
                            },
                        });
                        self.transfer("compute", "output", self.tick + 1, 4, Some(value));
                    } else {
                        j.stage = Stage::LoadA;
                    }
                }
                Completion::WarpLoad { warp } => self.warps[warp].stage = Stage::Mac,
                Completion::WarpMac { warp } => {
                    let k = self.warps[warp].k;
                    for id in warp * 32..warp * 32 + 32 {
                        self.output[id] += self.config.input[id / SIDE * SIDE + k]
                            * self.weights[k * SIDE + id % SIDE];
                    }
                    self.counters.macs += 32;
                    self.counters.active_lane_ops += 32;
                    self.counters.issued_lane_slots += 32;
                    self.warps[warp].k += 1;
                    self.warps[warp].stage = if k + 1 == SIDE {
                        Stage::Done
                    } else {
                        Stage::LoadA
                    };
                    if k + 1 == SIDE {
                        let values = (warp * 32..warp * 32 + 32)
                            .map(|id| (id, self.output[id]))
                            .collect();
                        self.pending.push(Pending {
                            end: self.tick + 1,
                            action: Completion::Store { values },
                        });
                        self.transfer("compute", "output", self.tick + 1, 128, None);
                    }
                }
                Completion::TileLoad { tile } => {
                    let r0 = tile / 2 * 4;
                    let c0 = tile % 2 * 4;
                    for local in 0..4 {
                        for k in 0..8 {
                            self.scratch_a[local * 8 + k] = self.config.input[(r0 + local) * 8 + k];
                            self.scratch_b[local * 8 + k] = self.weights[k * 8 + c0 + local];
                        }
                    }
                    self.pe_a = [None; 16];
                    self.pe_b = [None; 16];
                    self.tiles[tile].stage = Stage::Mac;
                }
                Completion::TileMac { tile, a, b } => {
                    self.pe_a = *a;
                    self.pe_b = *b;
                    let ids = Self::tile_ids(tile);
                    for pe in 0..16 {
                        if let (Some((ka, av)), Some((kb, bv))) = (a[pe], b[pe]) {
                            debug_assert_eq!(ka, kb, "Systolic operands must have matching k");
                            let id = ids[pe];
                            self.output[id] += av * bv;
                            self.counters.macs += 1;
                            if ka == 7 {
                                self.pending.push(Pending {
                                    end: self.tick + 1,
                                    action: Completion::Store {
                                        values: vec![(id, self.output[id])],
                                    },
                                });
                                self.transfer(
                                    &format!("pe{pe}"),
                                    "output",
                                    self.tick + 1,
                                    4,
                                    Some(self.output[id]),
                                );
                            }
                        }
                    }
                    self.tiles[tile].k += 1;
                    self.tiles[tile].stage = if self.tiles[tile].k == 14 {
                        Stage::Done
                    } else {
                        Stage::Mac
                    };
                }
                Completion::Store { values } => {
                    for (id, value) in values {
                        self.finish_output(id, value);
                    }
                }
            }
        }
    }
    pub fn snapshot(&self) -> SiliconSnapshot {
        let active_transfers: Vec<_> = self
            .transfers
            .iter()
            .filter(|t| t.start_tick <= self.tick && t.end_tick > self.tick)
            .collect();
        let ready = self
            .jobs
            .iter()
            .filter(|j| matches!(j.stage, Stage::LoadA | Stage::LoadB | Stage::Mac))
            .count();
        let (scheduler_used, scheduler_cap, compute_cap) = match self.config.mode {
            Mode::Cpu => (ready, CELLS, self.config.issue_width as usize),
            Mode::Gpu => (
                self.warps
                    .iter()
                    .filter(|w| matches!(w.stage, Stage::LoadA | Stage::Mac))
                    .count(),
                2,
                2,
            ),
            Mode::Tensor => (
                usize::from(
                    self.tiles
                        .iter()
                        .any(|t| matches!(t.stage, Stage::LoadA | Stage::Mac)),
                ),
                1,
                1,
            ),
        };
        let mut nodes: Vec<_> = [
            ("memory", self.memory_inflight(), MEMORY_SLOTS),
            ("cache", self.cache.len(), CACHE_LINES),
            ("scheduler", scheduler_used, scheduler_cap),
            (
                "registers",
                self.memory_inflight() + self.compute_inflight(),
                MEMORY_SLOTS + compute_cap,
            ),
            ("compute", self.compute_inflight(), compute_cap),
            (
                "scratch",
                if self.config.mode == Mode::Tensor && self.compute_inflight() > 0 {
                    64
                } else {
                    0
                },
                64,
            ),
            ("output", self.counters.completed_outputs as usize, CELLS),
        ]
        .into_iter()
        .map(|(id, occupancy, capacity)| {
            let active = active_transfers.iter().any(|t| t.from == id || t.to == id)
                || (id == "compute" && occupancy > 0);
            NodeState {
                id: id.into(),
                state: if active { "busy" } else { "idle" },
                occupancy,
                capacity,
            }
        })
        .collect();
        let mut lanes = Vec::new();
        // Prefer an actually executing group over a just-issued memory request.
        // The exposed group_index makes this one-group view unambiguous.
        let group_index = match self.config.mode {
            Mode::Cpu => None,
            Mode::Gpu => self
                .warps
                .iter()
                .position(|w| w.stage == Stage::WaitingMac)
                .or(self.selected_group),
            Mode::Tensor => self.selected_group,
        };
        if self.config.mode == Mode::Gpu {
            let warp = group_index.unwrap_or(0);
            let active = self.warps[warp].stage == Stage::WaitingMac;
            for lane in 0..32 {
                lanes.push(LaneState {
                    lane,
                    active,
                    output_index: Some(warp * 32 + lane),
                });
                nodes.push(NodeState {
                    id: format!("lane{lane}"),
                    state: if active { "busy" } else { "idle" },
                    occupancy: usize::from(active),
                    capacity: 1,
                });
            }
        }
        if self.config.mode == Mode::Tensor {
            let tile = self.selected_group.unwrap_or(0);
            let in_flight = self.pending.iter().find_map(|p| match &p.action {
                Completion::TileMac { tile: t, a, b } if *t == tile => Some((a, b)),
                _ => None,
            });
            for (pe, id) in Self::tile_ids(tile).into_iter().enumerate() {
                let active = in_flight.is_some_and(|(a, b)| a[pe].is_some() && b[pe].is_some());
                lanes.push(LaneState {
                    lane: pe,
                    active,
                    output_index: Some(id),
                });
                nodes.push(NodeState {
                    id: format!("pe{pe}"),
                    state: if active { "busy" } else { "idle" },
                    occupancy: usize::from(active),
                    capacity: 1,
                });
            }
        }
        SiliconSnapshot {
            tick: self.tick,
            status: self.status,
            mode: self.config.mode,
            input: self.config.input.clone(),
            weights: self.weights.clone(),
            output: self.output.clone(),
            valid: self.valid.clone(),
            nodes,
            transfers: self.transfers.iter().cloned().collect(),
            lanes,
            group_index,
            counters: self.counters.clone(),
            config: self.config.clone(),
            rules: Rules {
                label: "Educational dataflow model; no vendor cycle or power prediction",
                version: 1,
                time_unit: "model tick",
                cpu_hit_ticks: HIT_TICKS,
                cpu_miss_ticks: MISS_TICKS,
                mac_ticks: MAC_TICKS,
                memory_slots: MEMORY_SLOTS,
                cpu_cache_line_bytes: 64,
                cpu_cache_lines: CACHE_LINES,
                cpu_cache_policy:
                    "fully associative true LRU; cold start; no prefetch; merged misses; miss return and cache fill complete together",
                gpu_sector_bytes: 32,
                transfer_base_ticks: 2,
                sectors_per_transfer_tick: 4,
                gpu_warp_lanes: 32,
                tensor_tile_side: 4,
                tensor_mac_ticks: 1,
                tensor_wave_ticks: 14,
                memory_slot_meaning: "Outstanding operand requests; merged CPU requests still use a slot",
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reference(config: &SiliconConfig) -> Vec<i32> {
        let b = weights(config.filter);
        (0..64)
            .map(|id| {
                (0..8)
                    .map(|k| config.input[id / 8 * 8 + k] * b[k * 8 + id % 8])
                    .sum()
            })
            .collect()
    }
    fn run(config: SiliconConfig) -> SiliconModel {
        let mut m = SiliconModel::new(config).unwrap();
        m.run_to_completion(20_000).unwrap();
        m
    }
    #[test]
    fn all_modes_layouts_and_filters_compute_exact_same_matrix() {
        for mode in [Mode::Cpu, Mode::Gpu, Mode::Tensor] {
            for layout in [Layout::Packed, Layout::Strided] {
                for filter in [Filter::Difference, Filter::Identity, Filter::Mix] {
                    let config = SiliconConfig {
                        mode,
                        layout,
                        filter,
                        input: (0..64).map(|i| i % 17 - 8).collect(),
                        ..Default::default()
                    };
                    let expected = reference(&config);
                    let m = run(config);
                    assert_eq!(m.output, expected);
                    assert!(m.valid.iter().all(|v| *v));
                    assert_eq!(m.counters.macs, 512);
                    assert_eq!(m.counters.completed_outputs, 64);
                }
            }
        }
    }
    #[test]
    fn semantic_filters_have_independently_checked_results() {
        let input: Vec<i32> = (0..64).map(|i| i % 8).collect();
        let m = run(SiliconConfig {
            filter: Filter::Difference,
            input: input.clone(),
            ..Default::default()
        });
        for row in 0..8 {
            assert_eq!(&m.output[row * 8..row * 8 + 8], &[0, 1, 1, 1, 1, 1, 1, 1]);
        }
        let mixed = run(SiliconConfig {
            filter: Filter::Mix,
            input: vec![1; 64],
            ..Default::default()
        });
        for row in 0..8 {
            assert_eq!(
                &mixed.output[row * 8..row * 8 + 8],
                &[3, 4, 4, 4, 4, 4, 4, 3]
            );
        }
        assert_eq!(
            run(SiliconConfig {
                filter: Filter::Identity,
                input: input.clone(),
                ..Default::default()
            })
            .output,
            input
        );
    }
    #[test]
    fn coalescing_uses_addresses_masks_and_access_ranges() {
        let on = vec![true; 32];
        let addresses: Vec<_> = (0..32).map(|i| i * 4).collect();
        assert_eq!(coalesced_sectors(&addresses, &on, 4).unwrap().len(), 4);
        assert_eq!(
            coalesced_sectors(&addresses.iter().map(|a| a + 4).collect::<Vec<_>>(), &on, 4)
                .unwrap()
                .len(),
            5
        );
        assert_eq!(
            coalesced_sectors(&(0..32).map(|i| i * 32).collect::<Vec<_>>(), &on, 4)
                .unwrap()
                .len(),
            32
        );
        assert_eq!(coalesced_sectors(&[0; 32], &on, 4).unwrap().len(), 1);
        assert!(coalesced_sectors(&addresses, &[false; 32], 4)
            .unwrap()
            .is_empty());
        assert_eq!(coalesced_sectors(&[30], &[true], 4).unwrap(), vec![0, 1]);
        assert!(coalesced_sectors(&[u64::MAX], &[true], 4).is_err());
        assert!(coalesced_sectors(&[0], &[], 4).is_err());
    }
    #[test]
    fn gpu_layout_changes_real_traffic_but_not_result() {
        let packed = run(SiliconConfig {
            mode: Mode::Gpu,
            ..Default::default()
        });
        let strided = run(SiliconConfig {
            mode: Mode::Gpu,
            layout: Layout::Strided,
            ..Default::default()
        });
        assert_eq!(packed.output, strided.output);
        assert!(strided.counters.sectors > packed.counters.sectors);
        assert!(strided.tick > packed.tick);
        assert_eq!(packed.counters.active_lane_ops, 512);
        assert_eq!(packed.counters.issued_lane_slots, 512);
    }
    #[test]
    fn cache_hits_and_pending_merges_are_real_and_retain_results() {
        let cached = run(SiliconConfig::default());
        let uncached = run(SiliconConfig {
            cache_enabled: false,
            ..Default::default()
        });
        assert_eq!(cached.output, uncached.output);
        assert!(cached.counters.cache_hits > 0);
        assert!(cached.counters.merged_misses > 0);
        assert_eq!(
            cached.counters.loads,
            cached.counters.cache_hits
                + cached.counters.cache_misses
                + cached.counters.merged_misses
        );
        assert_eq!(uncached.counters.cache_hits, 0);
        assert!(cached.tick < uncached.tick);
    }
    #[test]
    fn tile_reuse_reduces_operand_loads() {
        let gpu = run(SiliconConfig {
            mode: Mode::Gpu,
            ..Default::default()
        });
        let tensor = run(SiliconConfig {
            mode: Mode::Tensor,
            ..Default::default()
        });
        assert_eq!(gpu.output, tensor.output);
        assert_eq!(gpu.counters.loads, 1024);
        assert_eq!(tensor.counters.loads, 256);
    }
    #[test]
    fn completed_output_arrives_after_transfer_and_nodes_obey_capacities() {
        for mode in [Mode::Cpu, Mode::Gpu, Mode::Tensor] {
            let mut m = SiliconModel::new(SiliconConfig {
                mode,
                ..Default::default()
            })
            .unwrap();
            while m.status != RunStatus::Complete {
                m.step(1).unwrap();
                let s = m.snapshot();
                for n in &s.nodes {
                    assert!(n.occupancy <= n.capacity, "{} occupancy", n.id);
                }
                for p in &m.pending {
                    if let Completion::Store { values } = &p.action {
                        for (id, _) in values {
                            assert!(!s.valid[*id]);
                        }
                    }
                }
                if mode == Mode::Gpu && m.compute_inflight() > 0 {
                    assert!(s.group_index.is_some());
                    assert!(s.lanes.iter().any(|l| l.active));
                }
            }
            assert!(m.transfers.iter().all(|t| t.end_tick <= m.tick));
            assert!(m.snapshot().nodes.iter().all(|n| n.state == "idle"));
        }
    }
    #[test]
    fn issue_width_changes_scheduling_not_math() {
        let narrow = run(SiliconConfig {
            issue_width: 1,
            ..Default::default()
        });
        let wide = run(SiliconConfig {
            issue_width: 2,
            ..Default::default()
        });
        assert_eq!(narrow.output, wide.output);
        assert_ne!(narrow.tick, wide.tick);
    }
    #[test]
    fn systolic_wave_moves_matching_operands_only_between_neighbors() {
        let mut m = SiliconModel::new(SiliconConfig {
            mode: Mode::Tensor,
            ..Default::default()
        })
        .unwrap();
        let mut wave_counts = Vec::new();
        let mut last_event = 0;
        let mut neighbor_moves = 0;
        while m.status != RunStatus::Complete {
            m.step(1).unwrap();
            for p in &m.pending {
                if let Completion::TileMac { tile, a, b } = &p.action {
                    let wave = m.tiles[*tile].k;
                    let mut count = 0;
                    for pe in 0..16 {
                        let row = pe / 4;
                        let col = pe % 4;
                        let expected = wave.checked_sub(row + col).filter(|k| *k < 8);
                        assert_eq!(a[pe].map(|v| v.0), expected);
                        assert_eq!(b[pe].map(|v| v.0), expected);
                        if col > 0 {
                            assert_eq!(a[pe], m.pe_a[pe - 1]);
                        }
                        if row > 0 {
                            assert_eq!(b[pe], m.pe_b[pe - 4]);
                        }
                        if expected.is_some() {
                            count += 1;
                        }
                    }
                    wave_counts.push(count);
                }
            }
            for event in m.transfers.iter().filter(|t| t.id > last_event) {
                if event.from.starts_with("pe") && event.to.starts_with("pe") {
                    let from: usize = event.from[2..].parse().unwrap();
                    let to: usize = event.to[2..].parse().unwrap();
                    assert!((to == from + 1 && from / 4 == to / 4) || to == from + 4);
                    assert_eq!(event.end_tick - event.start_tick, 1);
                    assert!(event.value.is_some());
                    neighbor_moves += 1;
                }
            }
            last_event = m.next_transfer;
        }
        assert_eq!(
            wave_counts,
            [1, 3, 6, 10, 13, 15, 16, 16, 15, 13, 10, 6, 3, 1].repeat(4)
        );
        assert_eq!(neighbor_moves, 4 * (12 + 12) * 8);
        assert_eq!(m.counters.macs, 512);
        assert_eq!(m.counters.loads, 256);
    }
    #[test]
    fn cache_is_bounded_lru_not_fifo() {
        let mut m = SiliconModel::new(Default::default()).unwrap();
        for line in 0..4 {
            m.fill_cache(line);
        }
        assert!(m.cache_hit(0));
        m.fill_cache(4);
        assert!(!m.cache_hit(1));
        assert!(m.cache_hit(0));
        assert_eq!(m.cache.len(), 4);
    }
    #[test]
    fn inputs_and_tick_batches_reject_without_mutating() {
        assert!(SiliconModel::new(SiliconConfig {
            input: vec![0; 63],
            ..Default::default()
        })
        .is_err());
        assert!(SiliconModel::new(SiliconConfig {
            input: vec![9; 64],
            ..Default::default()
        })
        .is_err());
        for issue_width in [0, 3, 255] {
            assert!(SiliconModel::new(SiliconConfig {
                issue_width,
                ..Default::default()
            })
            .is_err());
        }
        let mut m = SiliconModel::new(Default::default()).unwrap();
        assert!(m.step(257).is_err());
        assert_eq!(m.tick, 0);
        assert_eq!(m.status, RunStatus::Ready);
        m.step(0).unwrap();
        assert_eq!(m.tick, 0);
        assert!(m.run_to_completion(100_001).is_err());
        assert_eq!(m.tick, 0);
    }
    #[test]
    fn batches_reset_and_finished_steps_are_deterministic() {
        for mode in [Mode::Cpu, Mode::Gpu, Mode::Tensor] {
            let mut a = SiliconModel::new(SiliconConfig {
                mode,
                ..Default::default()
            })
            .unwrap();
            let mut b = a.clone();
            a.step(256).unwrap();
            for _ in 0..256 {
                b.step(1).unwrap();
            }
            assert_eq!(a.tick, b.tick);
            assert_eq!(a.counters, b.counters);
            assert_eq!(a.output, b.output);
            assert_eq!(a.transfers, b.transfers);
            a.reset();
            let c = run(a.config.clone());
            a.run_to_completion(20_000).unwrap();
            assert_eq!(a.tick, c.tick);
            assert_eq!(a.counters, c.counters);
            assert_eq!(a.output, c.output);
            let tick = a.tick;
            a.step(256).unwrap();
            assert_eq!(a.tick, tick);
        }
    }
    #[test]
    fn all_public_activity_is_bounded_and_dependencies_are_respected() {
        let mut m = SiliconModel::new(Default::default()).unwrap();
        while m.status != RunStatus::Complete {
            m.step(1).unwrap();
            assert!(m.memory_inflight() <= MEMORY_SLOTS);
            assert!(m.compute_inflight() <= m.config.issue_width as usize);
            assert!(m.transfers.len() <= TRANSFER_HISTORY);
            for job in &m.jobs {
                assert!(job.k <= 8);
                if job.stage == Stage::Done {
                    assert_eq!(job.k, 8);
                }
            }
            for t in &m.transfers {
                assert!(t.end_tick > t.start_tick);
            }
            assert!(m.tick < 20_000);
        }
    }
}
