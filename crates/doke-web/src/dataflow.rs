//! JSON snapshot boundary for the bounded educational models.
use doke_core::{
    fabric::{FabricConfig, FabricModel, QueueMode},
    silicon::{SiliconConfig, SiliconModel},
};
use wasm_bindgen::prelude::*;

fn error(message: &str) -> JsValue {
    JsValue::from_str(message)
}
fn integer(value: f64, max: u32) -> Result<u32, JsValue> {
    if !value.is_finite() || value.fract() != 0. || value < 0. || value > max as f64 {
        return Err(error("Expected an integer inside the supported range"));
    }
    Ok(value as u32)
}
fn mode(value: &str) -> Result<QueueMode, JsValue> {
    match value {
        "fifo" => Ok(QueueMode::Fifo),
        "voq" => Ok(QueueMode::Voq),
        _ => Err(error("Unknown queue mode")),
    }
}
#[wasm_bindgen]
pub struct SiliconSimulation {
    model: SiliconModel,
}
#[wasm_bindgen]
impl SiliconSimulation {
    #[wasm_bindgen(constructor)]
    pub fn new(json: &str) -> Result<Self, JsValue> {
        if json.len() > 8192 {
            return Err(error("Configuration too large"));
        }
        let value: serde_json::Value =
            serde_json::from_str(json).map_err(|e| error(&e.to_string()))?;
        if !value.is_object() {
            return Err(error("Configuration must be a JSON object"));
        }
        let config: SiliconConfig =
            serde_json::from_value(value).map_err(|e| error(&e.to_string()))?;
        Ok(Self {
            model: SiliconModel::new(config).map_err(error)?,
        })
    }
    pub fn advance(&mut self, ticks: f64) -> Result<String, JsValue> {
        self.model.step(integer(ticks, 256)?).map_err(error)?;
        self.snapshot()
    }
    pub fn snapshot(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.model.snapshot()).map_err(|e| error(&e.to_string()))
    }
    pub fn reset(&mut self) -> Result<String, JsValue> {
        self.model.reset();
        self.snapshot()
    }
}
#[wasm_bindgen]
pub struct FabricSimulation {
    model: FabricModel,
}
#[wasm_bindgen]
impl FabricSimulation {
    #[wasm_bindgen(constructor)]
    pub fn new(queue_mode: &str) -> Result<Self, JsValue> {
        Ok(Self {
            model: FabricModel::with_config(FabricConfig {
                queue_mode: mode(queue_mode)?,
            }),
        })
    }
    pub fn advance(&mut self, ticks: f64) -> Result<String, JsValue> {
        self.model.advance(integer(ticks, 4096)?).map_err(error)?;
        self.snapshot()
    }
    pub fn inject(&mut self, egress: f64, count: f64) -> Result<String, JsValue> {
        self.model
            .inject_burst(integer(egress, 2)? as usize, integer(count, 64)?)
            .map_err(error)?;
        self.snapshot()
    }
    pub fn block(&mut self, egress: f64, blocked: bool) -> Result<String, JsValue> {
        self.model
            .set_blocked(integer(egress, 2)? as usize, blocked)
            .map_err(error)?;
        self.snapshot()
    }
    pub fn queue_mode(&mut self, value: &str) -> Result<String, JsValue> {
        self.model.set_mode(mode(value)?);
        self.snapshot()
    }
    pub fn snapshot(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.model.snapshot()).map_err(|e| error(&e.to_string()))
    }
    pub fn reset(&mut self) -> Result<String, JsValue> {
        self.model.reset();
        self.snapshot()
    }
}
