@group(0) @binding(0) var scene:texture_2d<f32>;
@group(0) @binding(1) var glow:texture_2d<f32>;
@group(0) @binding(2) var smp:sampler;
struct Settings {size:vec4<f32>};@group(0) @binding(3) var<uniform> s:Settings;
struct Out{@builtin(position) pos:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) id:u32)->Out{var p=vec2(-1.,-1.);if(id==1u){p=vec2(3.,-1.);}if(id==2u){p=vec2(-1.,3.);}var o:Out;o.pos=vec4(p,0.,1.);o.uv=vec2(p.x*0.5+0.5,0.5-p.y*0.5);return o;}
@fragment fn fs(o:Out)->@location(0) vec4<f32>{
 let base=textureSample(scene,smp,o.uv).rgb;let b=textureSample(glow,smp,o.uv).rgb;
 let energy=b*s.size.z;
 if(s.size.w>0.5){return vec4(base+energy*2.,1.);}
 let v=base+energy*0.8;let shoulder=v/(1.+max(v-vec3(0.65),vec3(0.))*0.65);return vec4(clamp(shoulder,vec3(0.),vec3(1.)),1.);
}
