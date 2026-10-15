//! Deterministic educational timelines and a separate, uncalibrated rate model.
use serde::{Deserialize, Serialize};

pub mod plasticity;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Model {
    pub e: f64,
    pub i: f64,
    pub time: f64,
}
impl Default for Model {
    fn default() -> Self {
        Self {
            e: 0.1,
            i: 0.1,
            time: 0.0,
        }
    }
}
impl Model {
    fn derivatives(e: f64, i: f64, drive: f64, inhibition: f64) -> (f64, f64) {
        let s = |x: f64| 1.0 / (1.0 + (-x).exp());
        (
            (-e + s(10.0 * e - inhibition * i + drive - 2.5)) / 0.08,
            (-i + s(10.0 * e - 3.0 * i - 2.0)) / 0.12,
        )
    }
    /// Heun integration in seconds. Model parameters are pedagogical, not fitted.
    pub fn step(&mut self, dt: f64, drive: f64, inhibition: f64) -> Result<(), &'static str> {
        if !dt.is_finite()
            || !(0.0..=0.005).contains(&dt)
            || !drive.is_finite()
            || !(0.0..=5.0).contains(&drive)
            || !inhibition.is_finite()
            || !(3.0..=15.0).contains(&inhibition)
        {
            return Err("Unsupported parameter");
        }
        let (a, b) = Self::derivatives(self.e, self.i, drive, inhibition);
        let (c, d) = Self::derivatives(self.e + dt * a, self.i + dt * b, drive, inhibition);
        self.e += dt * (a + c) * 0.5;
        self.i += dt * (b + d) * 0.5;
        self.time += dt;
        if !self.e.is_finite() || !self.i.is_finite() {
            return Err("Non-finite model state");
        }
        Ok(())
    }
}

/// Smooth chapter involvement envelope. Display units only, never concentrations.
pub fn envelope(time: f32, start: f32, end: f32) -> f32 {
    if !time.is_finite() || end <= start || time < start || time > end {
        return 0.0;
    }
    let p = (time - start) / (end - start);
    let smooth = |x: f32| {
        let x = x.clamp(0.0, 1.0);
        x * x * (3.0 - 2.0 * x)
    };
    smooth(p * 5.0) * smooth((1.0 - p) * 5.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timeline_is_seekable_and_bounded() {
        assert_eq!(envelope(2.0, 3.0, 8.0), 0.0);
        assert_eq!(envelope(9.0, 3.0, 8.0), 0.0);
        assert_eq!(envelope(5.0, 3.0, 8.0), 1.0);
        assert_eq!(envelope(f32::NAN, 3.0, 8.0), 0.0);
        for n in 0..1000 {
            assert!((0.0..=1.0).contains(&envelope(n as f32 / 100.0, 3.0, 8.0)));
        }
    }
    #[test]
    fn model_is_bounded_over_supported_domain() {
        for drive in [0.0, 1.0, 3.0, 5.0] {
            for inhibition in [3.0, 9.0, 15.0] {
                let mut m = Model::default();
                for _ in 0..20000 {
                    m.step(0.001, drive, inhibition).unwrap();
                    assert!((0.0..=1.0).contains(&m.e));
                    assert!((0.0..=1.0).contains(&m.i));
                }
            }
        }
    }
    #[test]
    fn step_halving_converges() {
        let mut a = Model::default();
        let mut b = a.clone();
        for _ in 0..1000 {
            a.step(0.001, 1.5, 9.0).unwrap();
        }
        for _ in 0..2000 {
            b.step(0.0005, 1.5, 9.0).unwrap();
        }
        assert!((a.e - b.e).abs() < 0.0001 && (a.i - b.i).abs() < 0.0001);
    }
    #[test]
    fn rejects_invalid_inputs() {
        assert!(Model::default().step(0.02, 1.0, 9.0).is_err());
        assert!(Model::default().step(0.001, f64::NAN, 9.0).is_err());
    }
}
