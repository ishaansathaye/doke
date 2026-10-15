// Capability-gated HDR. SDR contrast never claims to add physical display range.
export const hdrCapable = () =>
  !!navigator.gpu && matchMedia("(dynamic-range: high)").matches;
export function configureHDR(canvas, renderer, enabled = true) {
  if (!renderer?.hdr_enabled()) return false;
  try {
    const c = canvas.getContext("webgpu"),
      current = c.getConfiguration();
    c.configure({
      ...current,
      colorSpace: "srgb",
      toneMapping: { mode: enabled ? "extended" : "standard" },
    });
    return c.getConfiguration().toneMapping?.mode === "extended";
  } catch {
    return false;
  }
}
export class HDRText {
  constructor(device) {
    this.device = device;
    this.canvas = document.createElement("canvas");
    this.canvas.id = "hdr-text";
    this.canvas.setAttribute("aria-hidden", "true");
    document.body.append(this.canvas);
    this.context = this.canvas.getContext("webgpu");
    this.mask = document.createElement("canvas");
    this.ctx = this.mask.getContext("2d");
    const shader = device.createShaderModule({
      code: `@group(0) @binding(0) var mask:texture_2d<f32>;struct Out{@builtin(position) p:vec4<f32>};@vertex fn vs(@builtin(vertex_index) i:u32)->Out{var p=vec2(-1.,-1.);if(i==1u){p=vec2(3.,-1.);}if(i==2u){p=vec2(-1.,3.);}var o:Out;o.p=vec4(p,0.,1.);return o;}@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{let a=textureLoad(mask,vec2<i32>(p.xy),0).a;return vec4(vec3(a*1.6),a);}`,
    });
    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shader, entryPoint: "vs" },
      fragment: {
        module: shader,
        entryPoint: "fs",
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: "triangle-list" },
    });
  }
  redraw() {
    const d = Math.min(devicePixelRatio, 2),
      w = Math.round(innerWidth * d),
      h = Math.round(innerHeight * d);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = this.mask.width = w;
      this.canvas.height = this.mask.height = h;
      this.texture?.destroy();
      this.texture = this.device.createTexture({
        size: [w, h],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.bind = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: this.texture.createView() }],
      });
      this.context.configure({
        device: this.device,
        format: "rgba16float",
        alphaMode: "premultiplied",
        toneMapping: { mode: "extended" },
      });
    }
    const c = this.ctx;
    c.clearRect(0, 0, w, h);
    c.save();
    c.scale(d, d);
    c.fillStyle = "white";
    c.textBaseline = "alphabetic";
    for (const el of document.querySelectorAll(
      ".brand,#details h2,.micro-caption strong,.experiment-heading h1",
    )) {
      if (
        !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      )
        continue;
      c.save();
      const panel = el.closest("#details");
      if (panel) {
        const bounds = panel.getBoundingClientRect();
        c.beginPath();
        c.rect(bounds.left, bounds.top, bounds.width, bounds.height);
        c.clip();
      }
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const style = getComputedStyle(node.parentElement);
        c.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        for (let i = 0; i < node.length; i++) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          if (r.width > 0) {
            const metrics = c.measureText(node.textContent[i]);
            const ascent = metrics.fontBoundingBoxAscent,
              descent = metrics.fontBoundingBoxDescent;
            const baseline = r.top + (r.height - ascent - descent) / 2 + ascent;
            c.fillText(node.textContent[i], r.left, baseline);
          }
        }
      }
      c.restore();
    }
    c.restore();
    this.device.queue.copyExternalImageToTexture(
      { source: this.mask },
      { texture: this.texture },
      [w, h],
    );
    const e = this.device.createCommandEncoder();
    const p = e.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 0],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    p.setPipeline(this.pipeline);
    p.setBindGroup(0, this.bind);
    p.draw(3);
    p.end();
    this.device.queue.submit([e.finish()]);
  }
  destroy() {
    this.texture?.destroy();
    this.canvas.remove();
  }
}
export async function loadNative(onProgress, signal, tier = "native") {
  const m = await fetch(`assets/${tier}/manifest.json`, { signal }).then(
    (r) => {
      if (!r.ok) throw Error("Native atlas unavailable");
      return r.json();
    },
  );
  if (!globalThis.DecompressionStream)
    throw Error(
      "This browser cannot decode the native atlas. Overview detail is still available.",
    );
  const result = new Uint8Array(m.bytes);
  let offset = 0,
    done = 0;
  // Sequential parts bound transient memory and give accurate download progress.
  for (const part of m.chunks) {
    const response = await fetch(part.url, { signal });
    if (!response.ok) throw Error("An atlas part failed to load");
    const compressed = new Uint8Array(await response.arrayBuffer());
    if (compressed.length !== part.bytes) throw Error("Incomplete atlas part");
    if (crypto.subtle) {
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", compressed)),
      ]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      if (digest !== part.sha256) throw Error("Atlas part checksum mismatch");
    }
    const decoded = new Uint8Array(
      await new Response(
        new Blob([compressed])
          .stream()
          .pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer(),
    );
    if (decoded.length !== part.decodedBytes)
      throw Error("Atlas part size mismatch");
    result.set(decoded, offset);
    offset += decoded.length;
    done += part.bytes;
    onProgress(done / m.compressedBytes, m);
  }
  return { bytes: result, meta: m };
}
