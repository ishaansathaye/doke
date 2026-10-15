@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var smp:sampler;
struct Out{@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->Out{var p=vec2(-1.,-1.);if(i==1u){p=vec2(3.,-1.);}if(i==2u){p=vec2(-1.,3.);}var o:Out;o.p=vec4(p,0.,1.);o.uv=vec2(p.x*.5+.5,.5-p.y*.5);return o;}
fn blur(uv:vec2<f32>,axis:vec2<f32>)->vec4<f32>{let dim=vec2<f32>(textureDimensions(source));var sum=vec3(0.);var weight=0.;for(var i=-6;i<=6;i++){let w=exp(-f32(i*i)/12.);sum+=textureSample(source,smp,uv+axis*f32(i)*2./dim).rgb*w;weight+=w;}return vec4(sum/weight,1.);}
@fragment fn fs_h(o:Out)->@location(0) vec4<f32>{return blur(o.uv,vec2(1.,0.));}
@fragment fn fs_v(o:Out)->@location(0) vec4<f32>{return blur(o.uv,vec2(0.,1.));}
