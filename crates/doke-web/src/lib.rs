mod scenes;
use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3, Vec4};
use wasm_bindgen::prelude::*;
use wgpu::util::DeviceExt;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Vertex {
    p: [f32; 3],
    n: [f32; 3],
    region: f32,
    kind: f32,
}
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniform {
    vp: [[f32; 4]; 4],
    eye: [f32; 4],
    params: [f32; 4],
    flags: [f32; 4],
    activity: [[f32; 4]; 64],
    detail: [f32; 4],
    style: [f32; 4],
    experiment_cells: [[f32; 4]; 4],
    experiment_edges: [[f32; 4]; 3],
    experiment_pulses: [[f32; 4]; 16],
}
struct Targets {
    scene: wgpu::TextureView,
    glow: wgpu::TextureView,
    depth: wgpu::TextureView,
    bind: wgpu::BindGroup,
    blur_a: wgpu::TextureView,
    blur_b: wgpu::TextureView,
    blur_h_bind: wgpu::BindGroup,
    blur_v_bind: wgpu::BindGroup,
}
#[wasm_bindgen]
pub struct BrainRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    focus_pipeline: wgpu::RenderPipeline,
    focus_bind: wgpu::BindGroup,
    post: wgpu::RenderPipeline,
    blur_h: wgpu::RenderPipeline,
    blur_v: wgpu::RenderPipeline,
    uniform: wgpu::Buffer,
    bind: wgpu::BindGroup,
    post_uniform: wgpu::Buffer,
    targets: Targets,
    vertices: Option<wgpu::Buffer>,
    indices: Option<wgpu::Buffer>,
    tissue_buffers: Option<(wgpu::Buffer, wgpu::Buffer, u32)>,
    cpu_v: Vec<Vertex>,
    cpu_i: Vec<u32>,
    state: Uniform,
    yaw: f32,
    pitch: f32,
    distance: f32,
    target: Vec3,
    matrix: Mat4,
    eye: Vec3,
    backend: String,
    bloom: f32,
    hdr: bool,
    target_format: wgpu::TextureFormat,
}
fn targets(
    d: &wgpu::Device,
    p: &wgpu::RenderPipeline,
    uniform: &wgpu::Buffer,
    w: u32,
    h: u32,
    format: wgpu::TextureFormat,
    blur_h: &wgpu::RenderPipeline,
    blur_v: &wgpu::RenderPipeline,
) -> Targets {
    let texture = |label, format, usage| {
        d.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage,
            view_formats: &[],
        })
        .create_view(&Default::default())
    };
    let usage = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING;
    let scene = texture("scene", format, usage);
    let glow = texture("glow", format, usage);
    let blur_a = texture("blur horizontal", format, usage);
    let blur_b = texture("blur vertical", format, usage);
    let depth = texture(
        "depth",
        wgpu::TextureFormat::Depth24Plus,
        wgpu::TextureUsages::RENDER_ATTACHMENT,
    );
    let sampler = d.create_sampler(&wgpu::SamplerDescriptor {
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    });
    let blur_bind = |pipeline: &wgpu::RenderPipeline, view: &wgpu::TextureView| {
        d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        })
    };
    let blur_h_bind = blur_bind(blur_h, &glow);
    let blur_v_bind = blur_bind(blur_v, &blur_a);
    let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("post textures"),
        layout: &p.get_bind_group_layout(0),
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&scene),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(&blur_b),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::Sampler(&sampler),
            },
            wgpu::BindGroupEntry {
                binding: 3,
                resource: uniform.as_entire_binding(),
            },
        ],
    });
    Targets {
        scene,
        glow,
        depth,
        bind,
        blur_a,
        blur_b,
        blur_h_bind,
        blur_v_bind,
    }
}
#[wasm_bindgen]
impl BrainRenderer {
    #[wasm_bindgen(js_name=create)]
    pub async fn create(
        canvas: web_sys::HtmlCanvasElement,
        webgl: bool,
        hdr: bool,
    ) -> Result<BrainRenderer, JsValue> {
        console_error_panic_hook::set_once();
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: if webgl {
                wgpu::Backends::GL
            } else {
                wgpu::Backends::BROWSER_WEBGPU
            },
            ..Default::default()
        });
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| JsValue::from_str("No graphics adapter"))?;
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Brain renderer"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_webgl2_defaults()
                        .using_resolution(adapter.limits()),
                    memory_hints: wgpu::MemoryHints::MemoryUsage,
                },
                None,
            )
            .await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let backend = format!("{:?}", adapter.get_info().backend);
        let caps = surface.get_capabilities(&adapter);
        let hdr = hdr && !webgl;
        let target_format = if webgl {
            wgpu::TextureFormat::Rgba8Unorm
        } else {
            wgpu::TextureFormat::Rgba16Float
        };
        let format = if hdr {
            wgpu::TextureFormat::Rgba16Float
        } else {
            caps.formats
                .iter()
                .copied()
                .find(|f| !f.is_srgb())
                .unwrap_or(caps.formats[0])
        };
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: canvas.width().max(1),
            height: canvas.height().max(1),
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("anatomy"),
            source: wgpu::ShaderSource::Wgsl(include_str!("brain.wgsl").into()),
        });
        let attrs = wgpu::vertex_attr_array![0=>Float32x3,1=>Float32x3,2=>Float32,3=>Float32];
        let color = Some(wgpu::ColorTargetState {
            format: target_format,
            blend: None,
            write_mask: wgpu::ColorWrites::ALL,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("anatomy"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: 32,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &attrs,
                }],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[color.clone(), color.clone()],
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth24Plus,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            multiview: None,
            cache: None,
        });
        let focus_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("anatomy"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: 32,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &attrs,
                }],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_focus"),
                compilation_options: Default::default(),
                targets: &[color.clone(), color.clone()],
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth24Plus,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            multiview: None,
            cache: None,
        });
        let post_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("glow composite"),
            source: wgpu::ShaderSource::Wgsl(include_str!("post.wgsl").into()),
        });
        let post = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("glow composite"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &post_shader,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &post_shader,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview: None,
            cache: None,
        });
        let blur_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("separable gaussian bloom"),
            source: wgpu::ShaderSource::Wgsl(include_str!("blur.wgsl").into()),
        });
        let make_blur = |entry| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("blur"),
                layout: None,
                vertex: wgpu::VertexState {
                    module: &blur_shader,
                    entry_point: Some("vs"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &blur_shader,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: target_format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview: None,
                cache: None,
            })
        };
        let blur_h = make_blur("fs_h");
        let blur_v = make_blur("fs_v");
        let mut state = Uniform::zeroed();
        state.flags = [-1., 0., 2., 1.];
        state.style[0] = 1.;
        let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("scene state"),
            contents: bytemuck::bytes_of(&state),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform.as_entire_binding(),
            }],
        });
        let focus_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &focus_pipeline.get_bind_group_layout(0),
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform.as_entire_binding(),
            }],
        });
        let post_uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: None,
            contents: bytemuck::cast_slice(&[config.width as f32, config.height as f32, 1.5, 0.]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let ts = targets(
            &device,
            &post,
            &post_uniform,
            config.width,
            config.height,
            target_format,
            &blur_h,
            &blur_v,
        );
        Ok(Self {
            device,
            queue,
            surface,
            config,
            pipeline,
            focus_pipeline,
            focus_bind,
            post,
            blur_h,
            blur_v,
            uniform,
            bind,
            post_uniform,
            targets: ts,
            vertices: None,
            indices: None,
            tissue_buffers: None,
            cpu_v: vec![],
            cpu_i: vec![],
            state,
            yaw: -0.95,
            pitch: 0.23,
            distance: 4.0,
            target: Vec3::ZERO,
            matrix: Mat4::IDENTITY,
            eye: Vec3::ZERO,
            backend,
            bloom: 1.5,
            hdr,
            target_format,
        })
    }
    pub fn accents(&mut self, enabled: bool) {
        self.state.style[0] = if enabled { 1. } else { 0. };
    }
    pub fn neuron_detail(&mut self, x: f32, y: f32, z: f32, enabled: bool) {
        if !enabled {
            self.state.detail[3] = 0.;
            return;
        }
        self.state.detail = [x, y, z, 0.32];
        let mesh = scenes::tissue(Vec3::new(x, y, z));
        let vertex = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("tissue neurons"),
                contents: bytemuck::cast_slice(&mesh.v),
                usage: wgpu::BufferUsages::VERTEX,
            });
        let index = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("tissue connections"),
                contents: bytemuck::cast_slice(&mesh.i),
                usage: wgpu::BufferUsages::INDEX,
            });
        self.tissue_buffers = Some((vertex, index, mesh.i.len() as u32));
    }
    pub fn triangle_count(&self) -> usize {
        self.cpu_i.len() / 3
    }
    pub fn hdr_enabled(&self) -> bool {
        self.config.format == wgpu::TextureFormat::Rgba16Float
    }
    pub fn hdr_output(&mut self, enabled: bool) {
        self.hdr = enabled && self.hdr_enabled();
    }
    pub fn scene(&mut self, scene: u32, chemical: u32) -> Result<(), JsValue> {
        self.state.params[2] = scene as f32;
        self.state.activity[60][3] = chemical as f32;
        self.state.flags = [-1., 0., 2., 0.];
        self.state.params[1] = 0.;
        self.target = Vec3::ZERO;
        self.yaw = -0.28;
        self.pitch = 0.12;
        self.distance = if scene == 1 { 5.6 } else { 4.5 };
        if scene == 1 {
            self.target.y = 0.4;
        }
        let mesh = if scene == 1 {
            scenes::synapse(chemical)
        } else {
            scenes::network()
        };
        self.load_mesh(&mesh.bytes())?;
        Ok(())
    }
    /// Load a fixed four-cell teaching illustration. Activity comes from the model.
    pub fn experiment_scene(&mut self) -> Result<(), JsValue> {
        self.state.params = [0., 0., 4., 0.];
        self.state.flags = [-1., 0., 2., 0.];
        self.state.detail = [0.; 4];
        self.state.experiment_cells = [[0.; 4]; 4];
        self.state.experiment_edges = [[0.; 4]; 3];
        self.state.experiment_pulses = [[0.; 4]; 16];
        self.target = Vec3::ZERO;
        self.yaw = -0.08;
        self.pitch = 0.06;
        self.distance = 6.0;
        self.load_mesh(&scenes::experiment().bytes())
    }
    /// Update the illustration from an actual numerical snapshot. No animation clock
    /// creates spikes: packets only exist between a cue spike and its model arrival.
    pub fn experiment_state(&mut self, json: &str) -> Result<(), JsValue> {
        let data: serde_json::Value =
            serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let time = data["time_ms"]
            .as_f64()
            .ok_or_else(|| JsValue::from_str("Missing model time"))?;
        if !time.is_finite() {
            return Err(JsValue::from_str("Invalid model time"));
        }
        self.state.experiment_cells = [[0.; 4]; 4];
        self.state.experiment_edges = [[0.; 4]; 3];
        self.state.experiment_pulses = [[0.; 4]; 16];
        let reduced = data["reduced_motion"].as_bool().unwrap_or(false);
        let selected = data["ui_selected_cue"].as_u64();
        let delay = data["axon_delay_ms"]
            .as_f64()
            .unwrap_or(doke_core::plasticity::AXON_DELAY_MS as f64)
            .max(1.);
        for cell in 0..4 {
            // Voltage relative to rest; display values are normalized, not concentrations.
            let voltage = data["voltages_mv"][cell]
                .as_f64()
                .unwrap_or(doke_core::plasticity::REST_MV);
            let flash = data["last_spike_ms"][cell]
                .as_f64()
                .map(|at| {
                    let age = time - at;
                    if (0.0..=12.0).contains(&age) && !reduced {
                        (1. - age / 12.) as f32
                    } else {
                        0.
                    }
                })
                .unwrap_or(0.);
            self.state.experiment_cells[cell] = [
                ((voltage - doke_core::plasticity::REST_MV)
                    / (doke_core::plasticity::THRESHOLD_MV - doke_core::plasticity::REST_MV))
                    .clamp(0., 1.) as f32,
                flash,
                if selected == Some(cell as u64) {
                    1.
                } else {
                    0.
                },
                0.,
            ];
        }
        for edge in 0..3 {
            let weight = data["weights"][edge].as_f64().unwrap_or(0.).clamp(0., 1.) as f32;
            let flash = data["last_arrival_ms"][edge]
                .as_f64()
                .map(|at| {
                    let age = time - at;
                    if (0.0..=12.0).contains(&age) && !reduced {
                        (1. - age / 12.) as f32
                    } else {
                        0.
                    }
                })
                .unwrap_or(0.);
            self.state.experiment_edges[edge] = [
                weight,
                flash,
                if selected == Some(edge as u64) {
                    1.
                } else {
                    0.
                },
                0.,
            ];
        }
        let mut slot = 0;
        if let Some(events) = data["events"].as_array() {
            for event in events {
                if event["kind"].as_str() != Some("spike") {
                    continue;
                }
                let edge = event["cell"].as_u64().unwrap_or(4) as u32;
                let age = time - event["time_ms"].as_f64().unwrap_or(-100.);
                if !reduced && edge < 3 && (0.0..delay).contains(&age) && slot < 16 {
                    let p = scenes::experiment_path(edge, (age / delay) as f32);
                    self.state.experiment_pulses[slot] = [p.x, p.y, p.z, 1.];
                    slot += 1;
                }
            }
        }
        Ok(())
    }
    /// IDs 0–3 are cell centers; 4–6 are the three presynaptic contacts.
    pub fn experiment_anchor(&self, id: u32) -> Vec<f32> {
        let p = if id < 4 {
            scenes::experiment_neuron(id)
        } else {
            scenes::experiment_contact((id - 4).min(2))
        };
        p.to_array().to_vec()
    }
    pub fn anatomy(&mut self) {
        self.state.params[2] = 0.;
    }
    pub fn micro_state(&mut self, step: f32, e: f32, i: f32) {
        self.state.params[3] = step;
        for n in 0..12 {
            self.state.activity[n][0] = if n < 6 { e } else { i };
        }
    }
    pub fn molecule(&mut self, json: &str) -> Result<(), JsValue> {
        let mesh = scenes::molecule(json).map_err(|e| JsValue::from_str(&e))?;
        self.state.params[2] = 3.;
        self.state.flags = [-1., 0., 2., 0.];
        self.state.params[1] = 0.;
        self.target = Vec3::ZERO;
        self.distance = 3.6;
        self.load_mesh(&mesh.bytes())
    }
    pub fn backend(&self) -> String {
        self.backend.clone()
    }
    pub fn load_mesh(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        if bytes.len() < 16 || &bytes[0..4] != b"BRN1" {
            return Err(JsValue::from_str("Invalid anatomy header"));
        }
        let read = |i| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap()) as usize;
        let nv = read(4);
        let ni = read(8);
        if nv > 3_000_000
            || ni > 18_000_000
            || read(12) != 32
            || bytes.len() != 16 + nv * 32 + ni * 4
        {
            return Err(JsValue::from_str("Invalid anatomy length"));
        }
        let v: Vec<Vertex> = bytes[16..16 + nv * 32]
            .chunks_exact(32)
            .map(bytemuck::pod_read_unaligned)
            .collect();
        let i: Vec<u32> = bytes[16 + nv * 32..]
            .chunks_exact(4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
            .collect();
        if i.iter().any(|&x| x as usize >= nv)
            || v.iter().any(|x| {
                x.p.iter().chain(x.n.iter()).any(|v| !v.is_finite())
                    || !(0.0..64.0).contains(&x.region)
            })
        {
            return Err(JsValue::from_str("Invalid anatomy geometry"));
        }
        self.vertices = Some(
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("atlas vertices"),
                    contents: bytemuck::cast_slice(&v),
                    usage: wgpu::BufferUsages::VERTEX,
                }),
        );
        self.indices = Some(
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("atlas indices"),
                    contents: bytemuck::cast_slice(&i),
                    usage: wgpu::BufferUsages::INDEX,
                }),
        );
        self.cpu_v = v;
        self.cpu_i = i;
        Ok(())
    }
    pub fn resize(&mut self, w: u32, h: u32) {
        let w = w.clamp(1, 4096);
        let h = h.clamp(1, 4096);
        if w == self.config.width && h == self.config.height {
            return;
        }
        self.config.width = w;
        self.config.height = h;
        self.surface.configure(&self.device, &self.config);
        self.targets = targets(
            &self.device,
            &self.post,
            &self.post_uniform,
            w,
            h,
            self.target_format,
            &self.blur_h,
            &self.blur_v,
        );
    }
    pub fn orbit(&mut self, dx: f32, dy: f32) {
        self.yaw += dx;
        self.pitch = (self.pitch + dy).clamp(-1.45, 1.45);
    }
    pub fn zoom(&mut self, delta: f32) {
        self.distance = (self.distance * delta.exp()).clamp(0.65, 7.);
    }
    pub fn pan(&mut self, dx: f32, dy: f32) {
        let right = Vec3::new(self.yaw.cos(), 0., -self.yaw.sin());
        self.target += right * (-dx * self.distance) + Vec3::Y * (dy * self.distance);
    }
    pub fn view(&mut self, preset: u32) {
        if self.state.params[2] > 0. {
            let synapse = self.state.params[2] == 1.;
            self.target = Vec3::new(0., if synapse { 0.4 } else { 0. }, 0.);
            self.distance = if self.state.params[2] == 4. {
                6.0
            } else if synapse {
                5.6
            } else if self.state.params[2] == 2. {
                4.5
            } else {
                3.6
            };
            self.yaw = -0.28;
            self.pitch = 0.12;
            return;
        }

        self.target = Vec3::ZERO;
        self.distance = 4.0;
        match preset {
            1 => {
                self.yaw = -1.57;
                self.pitch = 0.;
            }
            2 => {
                self.yaw = 1.57;
                self.pitch = 0.;
            }
            3 => {
                self.yaw = 0.;
                self.pitch = 1.4;
            }
            5 => {
                self.target = Vec3::new(0., -0.18, 0.);
                self.distance = 3.2;
                self.yaw = -0.95;
                self.pitch = 0.23;
            }
            4 => {
                self.yaw = 0.;
                self.pitch = 0.;
            }
            _ => {
                self.yaw = -0.95;
                self.pitch = 0.23;
            }
        }
    }
    pub fn select(&mut self, index: i32) {
        self.state.flags[0] = index as f32;
    }
    pub fn focus(&mut self, x: f32, y: f32, z: f32) {
        self.target = Vec3::new(x, y, z);
        self.distance = 1.7;
    }
    pub fn reveal(&mut self, hemisphere: u32, cut: f32) {
        self.state.flags[1] = hemisphere.min(3) as f32;
        self.state.flags[2] = cut;
    }
    pub fn hemisphere(&mut self, side: u32) {
        self.state.params[1] = side.min(3) as f32;
    }
    pub fn xray(&mut self, on: bool) {
        self.state.flags[3] = if on { 1. } else { 0. };
    }
    pub fn glow(&mut self, v: f32) {
        self.bloom = v.clamp(0., 3.);
    }
    pub fn activity(&mut self, values: &[f32]) {
        for n in 0..64 {
            self.state.activity[n][0] = values.get(n).copied().unwrap_or(0.).clamp(0., 1.);
        }
    }
    pub fn project(&self, x: f32, y: f32, z: f32) -> Vec<f32> {
        let p = self.matrix * Vec4::new(x, y, z, 1.);
        vec![
            (p.x / p.w * 0.5 + 0.5) * self.config.width as f32,
            (0.5 - p.y / p.w * 0.5) * self.config.height as f32,
            p.z / p.w,
        ]
    }
    pub fn pick(&self, x: f32, y: f32) -> i32 {
        let inv = self.matrix.inverse();
        let unproject = |z| {
            let p = inv * Vec4::new(x * 2. - 1., 1. - y * 2., z, 1.);
            p.truncate() / p.w
        };
        let origin = unproject(0.);
        let dir = (unproject(1.) - origin).normalize();
        let mut closest = f32::MAX;
        let mut selected = -1;
        let mut focused_hit = false;
        for tri in self.cpu_i.chunks_exact(3) {
            let a = self.cpu_v[tri[0] as usize];
            if a.kind == 2. || (a.kind == 0. && self.state.flags[1] == 1.) {
                continue;
            }
            let v0 = Vec3::from(a.p);
            let v1 = Vec3::from(self.cpu_v[tri[1] as usize].p);
            let v2 = Vec3::from(self.cpu_v[tri[2] as usize].p);
            let e1 = v1 - v0;
            let e2 = v2 - v0;
            let h = dir.cross(e2);
            let det = e1.dot(h);
            if det.abs() < 1e-8 {
                continue;
            }
            let s = origin - v0;
            let u = s.dot(h) / det;
            if !(0.0..=1.).contains(&u) {
                continue;
            }
            let q = s.cross(e1);
            let v = dir.dot(q) / det;
            if v < 0. || u + v > 1. {
                continue;
            }
            let t = e2.dot(q) / det;
            let focused = self.state.flags[3] > 0.5
                && (a.region == self.state.flags[0]
                    || self.state.activity[a.region as usize][0] > 0.01);
            if t <= 0. || (focused_hit && !focused) || (focused == focused_hit && t >= closest) {
                continue;
            }
            let hit = origin + dir * t;
            if ((self.state.flags[1] == 2. || self.state.params[1] == 2.) && hit.x > 0.)
                || ((self.state.flags[1] == 3. || self.state.params[1] == 3.) && hit.x < 0.)
                || (a.kind == 0. && hit.x > self.state.flags[2])
            {
                continue;
            }
            closest = t;
            selected = a.region as i32;
            focused_hit = focused;
        }
        selected
    }
    pub fn render(&mut self, time: f32) -> Result<(), JsValue> {
        self.eye = self.target
            + Vec3::new(
                self.yaw.sin() * self.pitch.cos(),
                self.pitch.sin(),
                self.yaw.cos() * self.pitch.cos(),
            ) * self.distance;
        let portrait_micro = self.config.width as f32 / (self.config.height as f32) < 0.9
            && self.state.params[2] > 0.;
        let fit = if portrait_micro { 1.0 } else { 0.9 };
        self.matrix = Mat4::perspective_rh(
            2. * ((0.64_f32 / 2.).tan()
                * (fit / (self.config.width as f32 / self.config.height as f32)).max(1.))
            .atan(),
            self.config.width as f32 / self.config.height as f32,
            0.02,
            30.,
        ) * Mat4::look_at_rh(self.eye, self.target, Vec3::Y);
        let compact_experiment = if self.state.params[2] == 4. {
            web_sys::window().and_then(|window| {
                let width = window.inner_width().ok()?.as_f64()? as f32;
                let height = window.inner_height().ok()?.as_f64()? as f32;
                (width >= 600. && height <= 560.).then_some((width, height))
            })
        } else {
            None
        };
        if let Some((width, height)) = compact_experiment {
            // Match the short-landscape layout: a 365px dock sits 12px from
            // the right edge. Fit the illustration into the remaining plot,
            // below its heading and above the camera controls. Use CSS pixels
            // so Retina/DPR changes cannot alter the chosen composition.
            let left = 20.;
            let right = (width - 389.).max(left + 80.);
            let top = 125.;
            let bottom = (height - 62.).max(top + 60.);
            let scale = ((right - left) / (height * 1.02))
                .min((bottom - top) / (height * 0.76))
                .min(1.);
            let center = Vec3::new(
                (left + right) / width - 1.,
                1. - (top + bottom) / height,
                0.,
            );
            self.matrix = Mat4::from_translation(center)
                * Mat4::from_scale(Vec3::new(scale, scale, 1.))
                * self.matrix;
        } else if portrait_micro {
            self.matrix = Mat4::from_translation(Vec3::new(0., 0.14, 0.)) * self.matrix;
        } else if self.state.params[2] == 4. {
            // Leave breathing room above the floating experiment dock.
            self.matrix = Mat4::from_translation(Vec3::new(0., 0.06, 0.)) * self.matrix;
        }
        self.state.vp = self.matrix.to_cols_array_2d();
        self.state.eye = [self.eye.x, self.eye.y, self.eye.z, 1.];
        self.state.params[0] = time;
        self.state.style[1] = self.config.width as f32 / self.config.height as f32;
        self.queue
            .write_buffer(&self.uniform, 0, bytemuck::bytes_of(&self.state));
        self.queue.write_buffer(
            &self.post_uniform,
            0,
            bytemuck::cast_slice(&[
                self.config.width as f32,
                self.config.height as f32,
                self.bloom,
                if self.hdr { 1. } else { 0. },
            ]),
        );
        let output = match self.surface.get_current_texture() {
            Ok(t) => t,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(()),
            Err(e) => return Err(JsValue::from_str(&e.to_string())),
        };
        let view = output.texture.create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let attach = |v| {
                Some(wgpu::RenderPassColorAttachment {
                    view: v,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })
            };
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("anatomy"),
                color_attachments: &[attach(&self.targets.scene), attach(&self.targets.glow)],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.targets.depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            if let (Some(v), Some(i)) = (&self.vertices, &self.indices) {
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &self.bind, &[]);
                pass.set_vertex_buffer(0, v.slice(..));
                pass.set_index_buffer(i.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..self.cpu_i.len() as u32, 0, 0..1);
            }
            if self.state.params[2] == 0. && self.state.detail[3] > 0. {
                if let Some((vertices, indices, count)) = &self.tissue_buffers {
                    pass.set_pipeline(&self.pipeline);
                    pass.set_bind_group(0, &self.bind, &[]);
                    pass.set_vertex_buffer(0, vertices.slice(..));
                    pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..*count, 0, 0..1);
                }
            }
        }
        if self.state.flags[3] > 0.5 {
            let attach = |v| {
                Some(wgpu::RenderPassColorAttachment {
                    view: v,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })
            };
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("teaching xray"),
                color_attachments: &[attach(&self.targets.scene), attach(&self.targets.glow)],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.targets.depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            if let (Some(v), Some(i)) = (&self.vertices, &self.indices) {
                pass.set_pipeline(&self.focus_pipeline);
                pass.set_bind_group(0, &self.focus_bind, &[]);
                pass.set_vertex_buffer(0, v.slice(..));
                pass.set_index_buffer(i.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..self.cpu_i.len() as u32, 0, 0..1);
            }
        }
        for (target, pipeline, bind) in [
            (
                &self.targets.blur_a,
                &self.blur_h,
                &self.targets.blur_h_bind,
            ),
            (
                &self.targets.blur_b,
                &self.blur_v,
                &self.targets.blur_v_bind,
            ),
        ] {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Gaussian blur"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, bind, &[]);
            pass.draw(0..3, 0..1);
        }
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("bloom"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&self.post);
            pass.set_bind_group(0, &self.targets.bind, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit(Some(encoder.finish()));
        output.present();
        Ok(())
    }
}
#[wasm_bindgen]
pub fn envelope(time: f32, start: f32, end: f32) -> f32 {
    doke_core::envelope(time, start, end)
}
#[wasm_bindgen]
pub struct Circuit {
    state: doke_core::Model,
}
#[wasm_bindgen]
impl Circuit {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            state: Default::default(),
        }
    }
    pub fn advance(
        &mut self,
        steps: u32,
        drive: f64,
        inhibition: f64,
    ) -> Result<Vec<f64>, JsValue> {
        for _ in 0..steps.min(1000) {
            self.state
                .step(0.001, drive, inhibition)
                .map_err(JsValue::from_str)?;
        }
        Ok(vec![self.state.time, self.state.e, self.state.i])
    }
    pub fn reset(&mut self) {
        self.state = Default::default();
    }
}
#[wasm_bindgen]
pub fn engine_version() -> String {
    "Brain · Rust / wgpu 24 · 0.1.0".into()
}

/// Independent timing assay; the population-rate Circuit remains unchanged.
#[wasm_bindgen]
pub struct TimingExperiment {
    state: doke_core::plasticity::TimingModel,
}
#[wasm_bindgen]
impl TimingExperiment {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            state: Default::default(),
        }
    }
    pub fn train(&mut self, cue: u32, gap_ms: i32, pairs: u32) -> Result<(), JsValue> {
        self.state
            .start_training(cue as usize, gap_ms, pairs)
            .map_err(JsValue::from_str)
    }
    pub fn probe(&mut self, cue: u32) -> Result<(), JsValue> {
        self.state
            .start_probe(cue as usize)
            .map_err(JsValue::from_str)
    }
    pub fn advance(&mut self, dt_ms: f64) -> Result<(), JsValue> {
        self.state.advance(dt_ms).map_err(JsValue::from_str)
    }
    pub fn cancel(&mut self) {
        self.state.cancel();
    }
    pub fn reset(&mut self) {
        self.state.reset();
    }
    pub fn snapshot(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.state.snapshot()).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
