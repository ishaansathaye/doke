//! Original schematic hardware geometry; never a vendor floorplan.
use crate::{scenes::Mesh, Vertex};
use glam::Vec3;
use serde_json::Value;

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

fn cuboid(m: &mut Mesh, c: Vec3, size: Vec3, region: u32, kind: u32) {
    for (normal, u, v) in [
        (Vec3::X, Vec3::Y, Vec3::Z),
        (-Vec3::X, Vec3::Z, Vec3::Y),
        (Vec3::Y, Vec3::Z, Vec3::X),
        (-Vec3::Y, Vec3::X, Vec3::Z),
        (Vec3::Z, Vec3::X, Vec3::Y),
        (-Vec3::Z, Vec3::Y, Vec3::X),
    ] {
        let base = m.v.len() as u32;
        for (a, b) in [(-1., -1.), (1., -1.), (1., 1.), (-1., 1.)] {
            let p = c + (normal + u * a + v * b) * size * 0.5;
            m.v.push(Vertex {
                p: p.to_array(),
                n: normal.to_array(),
                region: region as f32,
                kind: kind as f32,
            });
        }
        m.i.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
}

pub fn mesh(json: &str) -> Result<Mesh, &'static str> {
    if json.len() > 32_768 {
        return Err("Schematic too large");
    }
    let data: Value = serde_json::from_str(json).map_err(|_| "Invalid schematic")?;
    let blocks = data["blocks"].as_array().ok_or("Missing blocks")?;
    let links = data["links"].as_array().ok_or("Missing links")?;
    if blocks.len() > 60 || links.len() > 96 {
        return Err("Schematic exceeds bounds");
    }
    let mut m = Mesh::new();
    cuboid(
        &mut m,
        Vec3::new(0., -0.14, 0.),
        Vec3::new(4.1, 0.12, 3.7),
        63,
        18,
    );
    cuboid(
        &mut m,
        Vec3::new(0., -0.23, 0.),
        Vec3::new(4.32, 0.06, 3.92),
        63,
        18,
    );
    // Package contacts are visual framing, not a physical pin count.
    for n in 0..22 {
        let x = -1.9 + n as f32 * 3.8 / 21.;
        for z in [-1.96, 1.96] {
            cuboid(
                &mut m,
                Vec3::new(x, -0.24, z),
                Vec3::new(0.055, 0.035, 0.12),
                63,
                17,
            );
        }
    }
    for b in blocks {
        let r = b["region"].as_u64().ok_or("Missing region")?;
        if r >= 60 {
            return Err("Block region outside bounds");
        }
        let p = vector(&b["position"])?;
        let size = vector(&b["size"])?;
        if size.min_element() <= 0. {
            return Err("Block size must be positive");
        }
        cuboid(&mut m, p, size, r as u32, 15);
        // Thin original traces on each block make depth legible without fake activity.
        for k in 0..4 {
            let z = p.z + (k as f32 - 1.5) * size.z * 0.17;
            m.tube(
                &[
                    Vec3::new(p.x - size.x * 0.4, p.y + size.y * 0.5 + 0.002, z),
                    Vec3::new(p.x + size.x * 0.4, p.y + size.y * 0.5 + 0.002, z),
                ],
                0.0025,
                r as u32,
                17,
            );
        }
    }
    for l in links {
        let a = vector(&l["from"])?;
        let b = vector(&l["to"])?;
        if a.distance(b) < 0.01 {
            continue;
        }
        let mid = Vec3::new(a.x, 0.015, b.z);
        let points = if a.distance(mid) < 0.01 || b.distance(mid) < 0.01 {
            vec![a, b]
        } else {
            vec![a, mid, b]
        };
        m.tube(&points, 0.007, 63, 17);
    }
    // Positions come from emitted model events through uniforms, not a free-running loop.
    for i in 0..32 {
        m.sphere(Vec3::ZERO, Vec3::splat(0.025), i, 16, 5);
    }
    Ok(m)
}
