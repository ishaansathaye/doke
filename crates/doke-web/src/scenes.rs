//! Procedural teaching geometry. Not microscopy, connectomics or molecular dynamics.
use super::Vertex;
use glam::Vec3;
use std::f32::consts::PI;
pub struct Mesh {
    pub v: Vec<Vertex>,
    pub i: Vec<u32>,
}
impl Mesh {
    pub fn new() -> Self {
        Self {
            v: vec![],
            i: vec![],
        }
    }
    pub fn sphere(&mut self, c: Vec3, scale: Vec3, r: u32, kind: u32, detail: usize) {
        let base = self.v.len() as u32;
        let lon = detail * 2;
        for y in 0..=detail {
            let a = PI * y as f32 / detail as f32;
            for x in 0..=lon {
                let b = 2. * PI * x as f32 / lon as f32;
                let n = Vec3::new(a.sin() * b.cos(), a.cos(), a.sin() * b.sin());
                let p = c + n * scale;
                let nn = (n / scale).normalize_or_zero();
                self.v.push(Vertex {
                    p: p.to_array(),
                    n: nn.to_array(),
                    region: r as f32,
                    kind: kind as f32,
                });
            }
        }
        for y in 0..detail {
            for x in 0..lon {
                let a = base + (y * (lon + 1) + x) as u32;
                let b = a + lon as u32 + 1;
                self.i.extend_from_slice(&[a, b, a + 1, a + 1, b, b + 1]);
            }
        }
    }
    pub fn tube(&mut self, points: &[Vec3], radius: f32, r: u32, kind: u32) {
        let base = self.v.len() as u32;
        let sides = 10;
        for (j, p) in points.iter().enumerate() {
            let tangent = if j + 1 < points.len() {
                points[j + 1] - *p
            } else {
                *p - points[j - 1]
            };
            let tangent = tangent.normalize_or_zero();
            let basis = if tangent.y.abs() > 0.9 {
                Vec3::X
            } else {
                Vec3::Y
            };
            let u = tangent.cross(basis).normalize();
            let v = tangent.cross(u).normalize();
            for k in 0..sides {
                let a = k as f32 * 2. * PI / sides as f32;
                let n = u * a.cos() + v * a.sin();
                self.v.push(Vertex {
                    p: (*p + n * radius).to_array(),
                    n: n.to_array(),
                    region: r as f32,
                    kind: kind as f32,
                });
            }
        }
        for j in 0..points.len() - 1 {
            for k in 0..sides {
                let a = base + (j * sides + k) as u32;
                let b = base + (j * sides + (k + 1) % sides) as u32;
                let c = a + sides as u32;
                let d = b + sides as u32;
                self.i.extend_from_slice(&[a, c, b, b, c, d]);
            }
        }
    }
    pub fn ring(&mut self, c: Vec3, radius: f32, tube: f32, r: u32) {
        let p = (0..=48)
            .map(|i| {
                let a = i as f32 * 2. * PI / 48.;
                c + Vec3::new(a.cos() * radius, 0., a.sin() * radius)
            })
            .collect::<Vec<_>>();
        self.tube(&p, tube, r, 3);
    }
    pub fn bytes(self) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(b"BRN1");
        b.extend_from_slice(&(self.v.len() as u32).to_le_bytes());
        b.extend_from_slice(&(self.i.len() as u32).to_le_bytes());
        b.extend_from_slice(&32u32.to_le_bytes());
        b.extend_from_slice(bytemuck::cast_slice(&self.v));
        b.extend_from_slice(bytemuck::cast_slice(&self.i));
        b
    }
}
pub fn neuron(i: u32) -> Vec3 {
    let angle = (i % 6) as f32 * 2. * PI / 6.;
    Vec3::new(
        if i < 6 { -0.78 } else { 0.78 },
        angle.cos() * 0.65,
        angle.sin() * 0.65,
    )
}
pub fn path(i: u32, t: f32) -> Vec3 {
    let a = neuron(i % 12);
    let b = neuron((i * 5 + 7) % 12);
    a.lerp(b, t) + Vec3::Z * ((PI * t).sin() * 0.22)
}
pub fn synapse(chemical: u32) -> Mesh {
    let mut m = Mesh::new();
    // A bulbous presynaptic terminal above a receptive membrane, leaving the cleft open.
    m.sphere(
        Vec3::new(0., 1.05, 0.),
        Vec3::new(0.95, 0.64, 0.65),
        0,
        3,
        32,
    );
    m.tube(
        &[
            Vec3::new(0., 2., 0.),
            Vec3::new(0., 1.5, 0.),
            Vec3::new(0., 1.3, 0.),
        ],
        0.18,
        0,
        3,
    );
    m.sphere(
        Vec3::new(0., -0.64, 0.),
        Vec3::new(1.18, 0.27, 0.72),
        1,
        3,
        32,
    );
    m.tube(
        &[
            Vec3::new(-1.4, -0.85, -0.1),
            Vec3::new(-0.8, -0.72, 0.),
            Vec3::new(0.7, -0.7, 0.),
            Vec3::new(1.4, -0.83, 0.1),
        ],
        0.12,
        1,
        3,
    );
    // Vesicles visible as illustrative windowed organelles outside the terminal front.
    for i in 0..7 {
        let a = i as f32 * 2.4;
        let c = Vec3::new(a.cos() * 0.58, 0.87 + a.sin() * 0.2, 0.52);
        m.sphere(c, Vec3::splat(0.11), 2, 3, 12);
        for j in 0..5 {
            let b = j as f32 * 2.4;
            m.sphere(
                c + Vec3::new(b.cos() * 0.055, b.sin() * 0.055, 0.095),
                Vec3::splat(0.012),
                14 + j,
                7,
                5,
            );
        }
    }
    // Membrane receptors are rings with pores. DA uses signaling inside the cell in the animation.
    for i in 0..6 {
        let x = (i as f32 - 2.5) * 0.27;
        let c = Vec3::new(x, -0.37, 0.12);
        if chemical == 0 {
            m.sphere(
                c - Vec3::Y * 0.025,
                Vec3::new(0.057, 0.105, 0.055),
                3,
                3,
                12,
            );
        } else {
            m.ring(c, 0.05, 0.022, 3);
            m.tube(&[c, c - Vec3::Y * 0.14], 0.038, 3, 3);
        }
    }
    for i in 0..4 {
        let x = (i as f32 - 1.5) * 0.38;
        let c = Vec3::new(x, 0.48, 0.18);
        m.ring(c, 0.035, 0.014, 4);
    }
    // A transporter on the side shows uptake without asserting a calibrated trajectory.
    m.tube(
        &[
            Vec3::new(-1.05, -0.2, 0.25),
            Vec3::new(-1.12, 0.2, 0.25),
            Vec3::new(-1., 0.45, 0.25),
        ],
        0.06,
        5,
        3,
    );
    for i in 0..46 {
        m.sphere(Vec3::ZERO, Vec3::splat(0.022), i, 4, 10);
    }
    for i in 0..16 {
        m.sphere(Vec3::ZERO, Vec3::splat(0.013), i, 6, 5);
    }
    for i in 0..24 {
        m.sphere(Vec3::ZERO, Vec3::splat(0.012), i, 8, 6);
    }
    m
}
pub fn network() -> Mesh {
    let mut m = Mesh::new();
    for i in 0..12 {
        let c = neuron(i);
        m.sphere(c, Vec3::splat(0.105), i, 3, 18);
        for j in 0..5 {
            let a = j as f32 * 2. * PI / 5.;
            let d = Vec3::new(a.cos() * 0.18, a.sin() * 0.18, (a * 2.).sin() * 0.1);
            m.tube(&[c, c + d * 0.7, c + d], 0.009, i, 3);
        }
    }
    for i in 0..12 {
        let p = (0..=28)
            .map(|n| path(i, n as f32 / 28.))
            .collect::<Vec<_>>();
        m.tube(&p, 0.007, i, 3);
        let c = path(i, 0.94);
        m.sphere(c, Vec3::splat(0.024), i, 3, 8);
    }
    for i in 0..48 {
        m.sphere(Vec3::ZERO, Vec3::splat(0.018), i, 5, 10);
    }
    m
}
pub fn molecule(data: &str) -> Result<Mesh, String> {
    let data: serde_json::Value = serde_json::from_str(data).map_err(|e| e.to_string())?;
    let atoms = data["atoms"].as_array().ok_or("Missing atoms")?;
    let bonds = data["bonds"].as_array().ok_or("Missing bonds")?;
    if atoms.len() > 128 {
        return Err("Molecule too large".into());
    }
    let mut m = Mesh::new();
    let mut positions = vec![];
    for (i, a) in atoms.iter().enumerate() {
        let p = Vec3::new(
            a["x"].as_f64().unwrap_or(0.) as f32,
            a["y"].as_f64().unwrap_or(0.) as f32,
            a["z"].as_f64().unwrap_or(0.) as f32,
        ) * 0.3;
        positions.push(p);
        let radius = if a["element"] == "H" { 0.057 } else { 0.1 };
        let kind = if a["element"] == "O" {
            12
        } else if a["element"] == "N" {
            13
        } else {
            3
        };
        m.sphere(p, Vec3::splat(radius), i as u32, kind, 18);
    }
    for b in bonds {
        let a = b[0].as_u64().ok_or("Bad bond")? as usize;
        let z = b[1].as_u64().ok_or("Bad bond")? as usize;
        if a >= positions.len() || z >= positions.len() {
            return Err("Bad atom index".into());
        }
        m.tube(&[positions[a], positions[z]], 0.023, 50, 3);
        if b[2].as_u64().unwrap_or(1) > 1 {
            m.tube(
                &[
                    positions[a] + Vec3::Z * 0.045,
                    positions[z] + Vec3::Z * 0.045,
                ],
                0.011,
                50,
                3,
            );
        }
    }
    Ok(m)
}

/// A sparse, deliberately enlarged cortical teaching patch, not a cell reconstruction.
/// Local z faces outward from the left cortical surface; x follows the render z axis.
pub fn tissue(center: Vec3) -> Mesh {
    let mut m = Mesh::new();
    // A screen-facing aperture backs the illustrative tissue, keeping atlas interiors from cluttering it.
    m.sphere(Vec3::ZERO, Vec3::ONE, 0, 14, 24);
    let at = |p: Vec3| center + Vec3::new(-p.z, p.y, p.x);
    for i in 0..4u32 {
        let c = Vec3::new(
            if i % 2 == 0 { -0.105 } else { 0.105 },
            if i < 2 { 0.07 } else { -0.10 },
            (i as f32 * 2.4).sin() * 0.025,
        );
        m.sphere(at(c), Vec3::new(0.015, 0.028, 0.022), i, 9, 14);
        // Apical dendrite with progressively finer bifurcating branches.
        m.tube(
            &[
                at(c),
                at(c + Vec3::Y * 0.05),
                at(c + Vec3::new(0.014, 0.12, 0.)),
            ],
            0.0035,
            i,
            9,
        );
        for branch in 0..6 {
            let side = if branch % 2 == 0 { -1. } else { 1. };
            let root = c + Vec3::Y * (0.035 + branch as f32 * 0.012);
            let tip = root + Vec3::new(side * (0.040 + branch as f32 * 0.003), 0.022, 0.012);
            m.tube(&[at(root), at(root.lerp(tip, 0.5)), at(tip)], 0.002, i, 9);
            m.tube(
                &[at(tip), at(tip + Vec3::new(side * 0.02, 0.015, -0.008))],
                0.0012,
                i,
                9,
            );
            for j in 1..4 {
                let base = root.lerp(tip, j as f32 / 4.);
                let head = base + Vec3::new(0., 0.009, 0.005);
                m.tube(&[at(base), at(head)], 0.0009, i, 9);
                m.sphere(at(head), Vec3::splat(0.0028), i, 10, 6);
            }
        }
        for branch in 0..3 {
            let a = branch as f32 * 2.1;
            let tip = c + Vec3::new(a.cos() * 0.065, -0.045, a.sin() * 0.03);
            m.tube(&[at(c), at(c.lerp(tip, 0.55)), at(tip)], 0.0028, i, 9);
            for sign in [-1., 1.] {
                m.tube(
                    &[at(tip), at(tip + Vec3::new(sign * 0.025, -0.018, 0.01))],
                    0.0013,
                    i,
                    9,
                );
            }
        }
        // Axon and a bouton near a neighboring dendrite, with an explicit small gap.
        let axon = [
            c,
            c + Vec3::new(0., -0.04, 0.01),
            c + Vec3::new(0.055, -0.062, 0.035),
            c + Vec3::new(0.09, -0.020, 0.03),
        ];
        m.tube(&axon.map(at), 0.0019, i, 9);
        m.sphere(at(axon[3]), Vec3::splat(0.0055), i, 10, 10);
        m.sphere(
            at(axon[3] + Vec3::new(0.009, 0., 0.)),
            Vec3::splat(0.0027),
            i,
            9,
            8,
        );
        let receiving = axon[3] + Vec3::new(0.009, 0., 0.);
        let neighbor = Vec3::new(if i % 2 == 0 { 0.105 } else { -0.105 }, c.y, c.z);
        m.tube(
            &[
                at(receiving),
                at(receiving + Vec3::new(0.006, -0.018, 0.)),
                at(neighbor + Vec3::new(0., -0.02, 0.)),
                at(neighbor),
            ],
            0.0012,
            i,
            9,
        );

        for j in 0..3 {
            m.sphere(at(c), Vec3::splat(0.0028), i * 3 + j, 11, 7);
        }
    }
    m
}

/// Four pedagogical cells, with fixed topology matching the three-cue learning model.
/// Coordinates describe an illustration, not a measured neural reconstruction.
pub fn experiment_neuron(id: u32) -> Vec3 {
    match id {
        0 => Vec3::new(-1.12, 0.82, 0.02),
        1 => Vec3::new(-1.28, 0., 0.18),
        2 => Vec3::new(-1.12, -0.82, -0.04),
        _ => Vec3::new(1.08, 0., 0.),
    }
}
pub fn experiment_contact(edge: u32) -> Vec3 {
    Vec3::new(0.75, (1. - edge.min(2) as f32) * 0.21, 0.12)
}
pub fn experiment_path(edge: u32, t: f32) -> Vec3 {
    let a = experiment_neuron(edge.min(2)) + Vec3::new(0.10, 0., 0.03);
    let d = experiment_contact(edge);
    let b = a + Vec3::new(0.65, -a.y * 0.1, 0.10);
    let c = d + Vec3::new(-0.68, a.y * 0.45, 0.12);
    let t = t.clamp(0., 1.);
    let s = 1. - t;
    a * s.powi(3) + b * (3. * s * s * t) + c * (3. * s * t * t) + d * t.powi(3)
}
pub fn experiment() -> Mesh {
    let mut m = Mesh::new();
    for cell in 0..4 {
        let center = experiment_neuron(cell);
        let scale = if cell == 3 { 1.2 } else { 1. };
        m.sphere(center, Vec3::new(0.125, 0.145, 0.10) * scale, cell, 15, 24);
        // A quiet nucleus makes the soma read as a cell rather than a graph node.
        m.sphere(
            center + Vec3::new(-0.012, 0.012, 0.092) * scale,
            Vec3::splat(0.038) * scale,
            cell,
            20,
            14,
        );
        for branch in 0..7 {
            let angle = branch as f32 * 2. * PI / 7. + cell as f32 * 0.47;
            let outward = Vec3::new(angle.cos(), angle.sin(), (angle * 1.7).sin() * 0.32);
            let length = (0.25 + 0.07 * (angle * 2.3).cos().abs()) * scale;
            let bend = Vec3::new(-outward.y, outward.x, 0.25);
            let root = center + outward * 0.085;
            let mid = center + outward * length * 0.65 + bend * 0.018;
            let tip = center + outward * length + bend * 0.035;
            m.tube(&[center, root, mid, tip], 0.009 * scale, cell, 16);
            for side in [-1., 1.] {
                let twig = tip + outward * 0.10 * scale + bend * side * 0.075 * scale;
                m.tube(&[mid.lerp(tip, 0.75), tip, twig], 0.004 * scale, cell, 16);
                m.tube(
                    &[twig, twig + outward * 0.055 + bend * side * 0.028],
                    0.002,
                    cell,
                    16,
                );
            }
            for spine in 0..3 {
                let stem = mid.lerp(tip, spine as f32 / 3.);
                let head = stem + bend * (if spine % 2 == 0 { 0.022 } else { -0.022 });
                m.tube(&[stem, head], 0.002, cell, 16);
                m.sphere(head, Vec3::splat(0.005), cell, 16, 5);
            }
        }
    }
    for edge in 0..3 {
        let points = (0..=40)
            .map(|i| experiment_path(edge, i as f32 / 40.))
            .collect::<Vec<_>>();
        m.tube(&points, 0.011, edge, 17);
        let terminal = experiment_contact(edge);
        m.sphere(terminal, Vec3::splat(0.026), edge, 18, 16);
        // Separate postsynaptic spine and its dendritic stem, with a visible cleft.
        let head = terminal + Vec3::X * 0.072;
        m.sphere(head, Vec3::new(0.019, 0.032, 0.027), 3, 16, 12);
        m.tube(
            &[
                head,
                head + Vec3::new(0.07, -head.y * 0.18, -0.025),
                experiment_neuron(3),
            ],
            0.009,
            3,
            16,
        );
    }
    // Vertices stay static; model-derived positions and visibility arrive via uniforms.
    for pulse in 0..16 {
        m.sphere(Vec3::ZERO, Vec3::splat(0.026), pulse, 19, 9);
    }
    m
}
