struct Uniforms { vp:mat4x4<f32>,eye:vec4<f32>,params:vec4<f32>,flags:vec4<f32>,activity:array<vec4<f32>,64>,detail:vec4<f32>,style:vec4<f32> };
@group(0) @binding(0) var<uniform> u:Uniforms;
struct VertexOut { @builtin(position) position:vec4<f32>, @location(0) world:vec3<f32>,@location(1) normal:vec3<f32>,@location(2) @interpolate(flat) region:u32,@location(3) @interpolate(flat) kind:u32 };
fn neuron(i:u32)->vec3<f32>{let a=f32(i%6u)*6.283185/6.;return vec3(select(0.78,-0.78,i<6u),cos(a)*0.65,sin(a)*0.65);}
fn lens()->vec3<f32>{
 let axis=normalize(u.eye.xyz-u.detail.xyz);let right=normalize(cross(vec3(0.,1.,0.),axis));let up=cross(axis,right);
 let c=u.vp*vec4(u.detail.xyz,1.);let edge=u.vp*vec4(u.detail.xyz+up*u.detail.w,1.);
 let radius=length((edge.xy/edge.w-c.xy/c.w)*vec2(u.style.y,1.));
 return vec3(c.xy/c.w,radius);
}
@vertex fn vs(@location(0) p:vec3<f32>,@location(1) n:vec3<f32>,@location(2) r:f32,@location(3) k:f32)->VertexOut {
 var pos=p;let id=u32(r);let time=u.params.x;let phase=fract(time*0.42+r*0.618034);
 if(k==4.){
  let x=sin(r*17.1)*0.68;let z=0.18+cos(r*11.7)*0.25;
  if(u.params.w<0.5){pos+=vec3(x+sin(time*1.8+r)*0.022,0.72+sin(r+time*1.2)*0.06,z+0.35);}
  else if(u.params.w<1.5){pos+=vec3(x+sin(phase*12.+r)*0.045,0.45-phase*0.79,z);}
  else if(u.params.w<2.5){pos+=vec3((f32(id%6u)-2.5)*0.27,-0.31+sin(time*2.+r)*0.015,0.12);}
  else{pos+=vec3(mix(x,-1.04,phase),-0.28+sin(phase*1.57)*0.8,z);}
 }
 if(k==5.){
  let edge=id%12u;let e=u.activity[edge].x;let t=fract(time*(0.12+e*0.6)+floor(r/12.)*0.25);let a=neuron(edge);let b=neuron((edge*5u+7u)%12u);pos+=mix(a,b,t)+vec3(0.,0.,sin(3.141593*t)*0.22);
 }
 if(k==6.){let t=fract(time*0.7+r*0.13);pos+=vec3((f32(id%4u)-1.5)*0.38,0.68-t*0.22,0.18);}
 if(k==8.){let t=fract(time*0.35+r*0.17);let x=(f32(id%6u)-2.5)*0.27;pos+=vec3(x+select(0.,sin(t*4.+r)*0.1,u.activity[60].w==0.),-0.42-t*0.24,0.47);}
 if(k==11.){let t=fract(time*0.65+f32(id%3u)/3.);let drift=vec3(0.012*sin(t*3.14159),-t*0.065,t*0.070);pos+=vec3(-drift.z,drift.y,drift.x);}
 var o:VertexOut;o.position=u.vp*vec4(pos,1.);o.world=pos;o.normal=n;o.region=id;o.kind=u32(k);
 if(k==14.){let aperture=lens();o.position=vec4(aperture.xy+p.xy*vec2(aperture.z/u.style.y,aperture.z),0.99999,1.);o.world=u.detail.xyz;o.normal=p;}
 return o;
}
struct FragmentOut { @location(0) color:vec4<f32>,@location(1) glow:vec4<f32> };
fn shade(v:VertexOut)->FragmentOut {
 if(u.params.z==0. && v.kind<3u && u.detail.w>0.){
  let aperture=lens();let clip=u.vp*vec4(v.world,1.);
  if(length((clip.xy/clip.w-aperture.xy)*vec2(u.style.y,1.))<aperture.z){discard;}
 }
 if(v.kind==14u){var o:FragmentOut;let edge=smoothstep(0.975,0.997,length(v.normal.xy));o.color=vec4(vec3(0.018+edge*0.12),1.);o.glow=vec4(vec3(edge*0.02),1.);return o;}
 if(v.kind==2u){discard;}
 if(v.kind==0u&&u.flags.y==1.){discard;}
 if((u.flags.y==2.||u.params.y==2.)&&v.world.x>0.){discard;}
 if((u.flags.y==3.||u.params.y==3.)&&v.world.x<0.){discard;}
 if(v.kind==0u&&v.world.x>u.flags.z){discard;}
 if(v.kind==6u&&u.params.w!=1.){discard;}
 if(v.kind==8u&&u.params.w!=2.){discard;}
 let n=normalize(v.normal);let view=normalize(u.eye.xyz-v.world);
 let lambert=max(dot(n,normalize(vec3(-0.4,0.85,0.7))),0.);
 let fill=max(dot(n,normalize(vec3(0.8,0.2,-0.4))),0.);
 let rim=pow(1.-abs(dot(n,view)),2.8);
 let spec=pow(max(dot(n,normalize(view+normalize(vec3(-0.4,0.85,0.7)))),0.),48.);
 let selected=select(0.,1.,abs(f32(v.region)-u.flags.x)<0.1);
 var a=u.activity[min(v.region,63u)].x;
 if(u.params.z==1.){a=select(0.06,0.55,v.region==u32(u.params.w)+2u);}
 if(u.params.z==3.){a=0.22;}
 let particle=(v.kind>=4u&&v.kind<=8u)||v.kind==11u;
 if(particle){a=1.;}
 var light=0.035+lambert*0.42+fill*0.06+rim*0.16+spec*0.1;
 if(u.params.z>0.){light=0.015+lambert*0.11+fill*0.05+rim*0.35+spec*0.32;}
 light+=selected*(0.07+rim*0.45)+a*(0.12+lambert*0.13+rim*0.5);
 if(particle){light=0.9+lambert*0.5;}
 var tint=vec3(1.);var emissive=a*(0.2+rim*0.8)+selected*rim*0.2;
 if(v.kind==9u){light=0.10+lambert*0.30+rim*0.30;emissive=0.025+rim*0.08;}
 if(v.kind==10u){light=0.28+lambert*0.40;emissive=0.09+0.08*sin(u.params.x*3.+f32(v.region));}
 if(u.style.x>0.5){
  if(u.params.z==0. && v.kind<3u){tint=mix(vec3(1.),vec3(0.70,0.88,0.86),max(selected*0.5,a*0.35));}
  if(v.kind==10u||v.kind==11u){tint=vec3(0.66,0.86,0.83);}
  if(v.kind==12u){tint=vec3(1.,0.54,0.40);}
  if(v.kind==13u){tint=vec3(0.42,0.65,1.);}
  if(u.params.z==1.&&(v.kind==4u||v.kind==7u)){tint=vec3(1.,0.79,0.50);if(u.activity[60].w==1.){tint=vec3(0.58,0.90,0.78);}if(u.activity[60].w==2.){tint=vec3(0.79,0.69,1.);}}
 }
 var out:FragmentOut;out.color=vec4(tint*light,1.);out.glow=vec4(tint*emissive,1.);return out;
}
@fragment fn fs(v:VertexOut)->FragmentOut{return shade(v);}
@fragment fn fs_focus(v:VertexOut)->FragmentOut{if(u.activity[min(v.region,63u)].x<=0.01&&abs(f32(v.region)-u.flags.x)>0.1){discard;}return shade(v);}
