//! Original schematic hardware geometry; never a vendor floorplan.
use crate::{scenes::Mesh, Vertex};
use glam::Vec3;
use serde_json::Value;

const BOARD: u32 = 255;
const DETAIL: u32 = 19;

fn vector(v: &Value) -> Result<Vec3, &'static str> {
    let a = v.as_array().ok_or("Expected vector")?;
    if a.len() != 3 {
        return Err("Expected three coordinates");
    }
    let mut p = [0.; 3];
    for (i, x) in a.iter().enumerate() {
        let n = x.as_f64().ok_or("Expected finite coordinate")?;
        if !n.is_finite() || n.abs() > 8. {
            return Err("Coordinate outside schematic");
        }
        p[i] = n as f32;
    }
    Ok(Vec3::from(p))
}

fn dimensions(v: &Value) -> Result<Vec3, &'static str> {
    let size = vector(v)?;
    if size.min_element() < 0.0001 {
        return Err("Size must be positive and nondegenerate");
    }
    Ok(size)
}

fn face(m: &mut Mesh, points: &[Vec3], region: u32, kind: u32) {
    let normal = (points[1] - points[0])
        .cross(points[2] - points[0])
        .normalize();
    let base = m.v.len() as u32;
    for p in points {
        m.v.push(Vertex {
            p: p.to_array(),
            n: normal.to_array(),
            region: region as f32,
            kind: kind as f32,
        });
    }
    for i in 1..points.len() - 1 {
        m.i.extend_from_slice(&[base, base + i as u32, base + i as u32 + 1]);
    }
}

fn cuboid(m: &mut Mesh, c: Vec3, size: Vec3, region: u32, kind: u32) {
    for (normal, u, v) in [
        (Vec3::X, Vec3::Y, Vec3::Z),
        (-Vec3::X, Vec3::Z, Vec3::Y),
        (Vec3::Y, Vec3::Z, Vec3::X),
        (-Vec3::Y, Vec3::X, Vec3::Z),
        (Vec3::Z, Vec3::X, Vec3::Y),
        (-Vec3::Z, Vec3::Y, Vec3::X),
    ] {
        let p: Vec<_> = [(-1., -1.), (1., -1.), (1., 1.), (-1., 1.)]
            .iter()
            .map(|(a, b)| c + (normal + u * *a + v * *b) * size * 0.5)
            .collect();
        face(m, &p, region, kind);
    }
}

/// Eight clipped corners and a true sloped top lip catch light at every scale.
fn die(m: &mut Mesh, c: Vec3, size: Vec3, region: u32, kind: u32) {
    let hx = size.x * 0.5;
    let hz = size.z * 0.5;
    let bevel = size.x.min(size.z).min(size.y * 2.) * 0.09;
    let corner = hx.min(hz) * 0.16;
    let ring = |inset: f32, y: f32| {
        let x = hx - inset;
        let z = hz - inset;
        let cut = corner * (1. - inset / hx.min(hz));
        [
            (-x + cut, -z),
            (x - cut, -z),
            (x, -z + cut),
            (x, z - cut),
            (x - cut, z),
            (-x + cut, z),
            (-x, z - cut),
            (-x, -z + cut),
        ]
        .map(|(x, z)| c + Vec3::new(x, y, z))
    };
    let bottom = ring(0., -size.y * 0.5);
    let shoulder = ring(0., size.y * 0.5 - bevel);
    let top = ring(bevel, size.y * 0.5);
    for i in 0..8 {
        let j = (i + 1) % 8;
        face(
            m,
            &[bottom[i], shoulder[i], shoulder[j], bottom[j]],
            region,
            kind,
        );
        face(m, &[shoulder[i], top[i], top[j], shoulder[j]], region, kind);
    }
    let reverse: Vec<_> = top.iter().rev().copied().collect();
    face(m, &reverse, region, kind);
    face(m, &bottom, region, kind);
}

/// Raised physical traces, with no activity or time animation of their own.
fn etch(m: &mut Mesh, p: Vec3, size: Vec3, region: u32, style: &str) {
    let stroke = size.x.min(size.z).min(0.5) * 0.012;
    let top = p.y + size.y * 0.5 + stroke * 1.5;
    let rows = if style == "memory" { 9 } else { 5 };
    for row in 0..rows {
        let z = p.z + ((row as f32 + 0.5) / rows as f32 - 0.5) * size.z * 0.76;
        if style == "compute" {
            for col in 0..4 {
                let x = p.x + (col as f32 - 1.5) * size.x * 0.19;
                cuboid(
                    m,
                    Vec3::new(x, top, z),
                    Vec3::new(size.x * 0.12, stroke, stroke),
                    region,
                    DETAIL,
                );
            }
        } else {
            let width = size.x
                * if style == "control" && row % 2 == 0 {
                    0.45
                } else {
                    0.76
                };
            cuboid(
                m,
                Vec3::new(p.x, top, z),
                Vec3::new(width, stroke, stroke),
                region,
                DETAIL,
            );
        }
    }
    if style == "control" || style == "io" {
        cuboid(
            m,
            Vec3::new(p.x + size.x * 0.3, top, p.z),
            Vec3::new(stroke, stroke, size.z * 0.78),
            region,
            DETAIL,
        );
    }
}

fn path(v: &Value) -> Result<Vec<Vec3>, &'static str> {
    let values = v.as_array().ok_or("Missing route points")?;
    if !(2..=32).contains(&values.len()) {
        return Err("Route needs 2 to 32 points");
    }
    let points: Vec<_> = values.iter().map(vector).collect::<Result<_, _>>()?;
    if points.windows(2).any(|p| p[0].distance(p[1]) < 0.0001) {
        return Err("Degenerate route segment");
    }
    Ok(points)
}

pub fn mesh(json: &str) -> Result<Mesh, &'static str> {
    if json.len() > 512 * 1024 {
        return Err("Schematic too large");
    }
    let data: Value = serde_json::from_str(json).map_err(|_| "Invalid schematic")?;
    let blocks = data["blocks"].as_array().ok_or("Missing blocks")?;
    let links = data["links"].as_array().ok_or("Missing links")?;
    let parts = data
        .get("parts")
        .map(|p| p.as_array().ok_or("Invalid parts"))
        .transpose()?;
    if blocks.len() > 240 || links.len() > 512 || parts.is_some_and(|p| p.len() > 2048) {
        return Err("Schematic exceeds bounds");
    }
    let mut regions = [false; 240];
    let mut m = Mesh::new();
    let (board, size) = if let Some(b) = data.get("board") {
        let p = b
            .get("position")
            .map(vector)
            .transpose()?
            .unwrap_or(Vec3::new(0., -0.14, 0.));
        (p, dimensions(&b["size"])?)
    } else {
        (Vec3::new(0., -0.14, 0.), Vec3::new(4.1, 0.12, 3.7))
    };
    die(&mut m, board, size, BOARD, 18);
    die(
        &mut m,
        board - Vec3::Y * (size.y * 0.5 + 0.04),
        Vec3::new(size.x + 0.22, 0.06, size.z + 0.22),
        BOARD,
        18,
    );
    // Original package contacts frame the object; this is not a physical pin count.
    for n in 0..32 {
        let t = (n as f32 + 0.5) / 32. - 0.5;
        for sign in [-1., 1.] {
            cuboid(
                &mut m,
                board
                    + Vec3::new(
                        t * size.x * 0.94,
                        -size.y * 0.5 - 0.045,
                        sign * (size.z * 0.5 + 0.09),
                    ),
                Vec3::new(size.x * 0.012, 0.025, 0.12),
                BOARD,
                17,
            );
            cuboid(
                &mut m,
                board
                    + Vec3::new(
                        sign * (size.x * 0.5 + 0.09),
                        -size.y * 0.5 - 0.045,
                        t * size.z * 0.94,
                    ),
                Vec3::new(0.12, 0.025, size.z * 0.012),
                BOARD,
                17,
            );
        }
    }
    for b in blocks {
        let r = b["region"].as_u64().ok_or("Missing region")?;
        if r >= 240 || regions[r as usize] {
            return Err("Block regions must be unique and below 240");
        }
        regions[r as usize] = true;
        let p = vector(&b["position"])?;
        let size = dimensions(&b["size"])?;
        let style = b
            .get("style")
            .map(|v| v.as_str().ok_or("Invalid block style"))
            .transpose()?
            .unwrap_or("control");
        if !["compute", "memory", "control", "io"].contains(&style) {
            return Err("Unknown block style");
        }
        die(&mut m, p, size, r as u32, 15);
        etch(&mut m, p, size, r as u32, style);
    }
    if let Some(parts) = parts {
        for part in parts {
            let r = part["parent"].as_u64().ok_or("Missing part parent")?;
            if r >= 240 || !regions[r as usize] {
                return Err("Part parent must identify a block");
            }
            match part["type"].as_str() {
                Some("cuboid") => cuboid(
                    &mut m,
                    vector(&part["position"])?,
                    dimensions(&part["size"])?,
                    r as u32,
                    DETAIL,
                ),
                Some("tube") => {
                    let radius = part["radius"].as_f64().ok_or("Missing part radius")?;
                    if !radius.is_finite() || !(0.0001..=0.08).contains(&radius) {
                        return Err("Part radius outside bounds");
                    }
                    m.tube(&path(&part["points"])?, radius as f32, r as u32, DETAIL);
                }
                _ => return Err("Unknown part type"),
            }
        }
    }
    for link in links {
        let points = if let Some(p) = link.get("points") {
            path(p)?
        } else {
            let a = vector(&link["from"])?;
            let b = vector(&link["to"])?;
            if a.distance(b) < 0.0001 {
                continue;
            }
            // Keep routes in the endpoint plane instead of diving through the substrate.
            let mid = Vec3::new(a.x, (a.y + b.y) * 0.5, b.z);
            if a.distance(mid) < 0.0001 || b.distance(mid) < 0.0001 {
                vec![a, b]
            } else {
                vec![a, mid, b]
            }
        };
        m.tube(&points, 0.004, BOARD, 17);
    }
    // Only emitted model events position these markers through uniforms.
    for i in 0..32 {
        m.sphere(Vec3::ZERO, Vec3::splat(0.025), i, 16, 5);
    }
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn block(r: usize) -> Value {
        json!({"region":r,"position":[0,0.1,0],"size":[0.3,0.1,0.3],"style":"compute"})
    }
    #[test]
    fn full_region_capacity_and_finite_indexed_geometry() {
        let blocks: Vec<_> = (0..240).map(block).collect();
        let m = mesh(&json!({"blocks":blocks,"links":[]}).to_string()).unwrap();
        assert!(m.v.iter().any(|v| v.region == 239.));
        assert!(m.v.iter().any(|v| v.region == BOARD as f32));
        assert!(m.i.iter().all(|i| (*i as usize) < m.v.len()));
        assert!(m
            .v
            .iter()
            .all(|v| v.p.iter().chain(v.n.iter()).all(|n| n.is_finite())));
        assert!(m.v.len() < 200_000);
    }
    #[test]
    fn decorative_parts_keep_parent_and_static_material() {
        let data = json!({"blocks":[block(170)],"links":[],"parts":[{"type":"cuboid","parent":170,"position":[0,0.3,0],"size":[0.1,0.1,0.1]},{"type":"tube","parent":170,"points":[[0,0.4,0],[1,0.4,0]],"radius":0.01}]});
        let m = mesh(&data.to_string()).unwrap();
        assert!(m
            .v
            .iter()
            .filter(|v| v.kind == DETAIL as f32)
            .all(|v| v.region == 170.));
    }
    #[test]
    fn rejects_ambiguous_or_unbounded_geometry() {
        for value in [
            json!({"blocks":[block(240)],"links":[]}),
            json!({"blocks":[block(0),block(0)],"links":[]}),
            json!({"blocks":[block(0)],"links":[],"parts":[{"parent":1,"type":"cuboid","position":[0,0,0],"size":[1,1,1]}]}),
            json!({"blocks":[block(0)],"links":[{"points":[[0,0,0],[0,0,0]]}]}),
            json!({"blocks":[{"region":0,"position":[9,0,0],"size":[1,1,1]}],"links":[]}),
            json!({"blocks":[{"region":0,"position":[0,0,0],"size":[0,1,1]}],"links":[]}),
        ] {
            assert!(mesh(&value.to_string()).is_err());
        }
        assert!(mesh(&" ".repeat(512 * 1024 + 1)).is_err());
    }
}
