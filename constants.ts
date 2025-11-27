

export const BOILERPLATE_SHADER_WGSL = `
// --- ReSTIR GI (Robust Implementation) ---
// Scene: Dark Alley (Procedural SDF)

struct Uniforms {
  resolution: vec2f,
  time: f32,
  frameIndex: f32,    
  cameraPos: vec4f,
  mouse: vec4f,
  
  // App Params
  animSpeed: f32,
  roughness: f32,
  indirectIntensity: f32, 
  grainStrength: f32,
  
  baseColor: vec3f,
  _pad1: f32,
  
  lightAz: f32,
  lightEl: f32,
  aberration: f32,
  debugMode: f32,
  
  audio: vec4f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var historyTexture: texture_2d<f32>; 
@group(0) @binding(2) var textureSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

// --- RESERVOIR STRUCT ---
struct Reservoir {
    y: vec3f,       // The light sample (Radiance)
    w_sum: f32,     // Sum of weights
    M: f32,         // Number of samples seen
};

// --- ROBUST RANDOM NUMBER GENERATOR (PCG) ---
fn pcg_hash(seed: u32) -> u32 {
    let state = seed * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn rng_float(pixel: vec2f, frame: f32, slot: u32) -> f32 {
    let seed = u32(pixel.x) + u32(pixel.y) * u32(u.resolution.x) + u32(frame) * 719393u + slot;
    return f32(pcg_hash(seed)) / 4294967295.0;
}

// --- SDF SCENE: DARK ALLEY ---
fn sdBox(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Map returns vec2(dist, materialID)
// ID 1.0 = Wet Floor
// ID 2.0 = Artifact
// ID 3.0 = Walls/Pillars
fn map(p: vec3f) -> vec2f {
  // 1. Floor
  let dFloor = p.y + 2.0;
  
  // 2. Artifact (Twisting Box)
  var p2 = p - vec3f(0.0, 0.0, 0.0);
  let pulse = u.audio.x * 0.2; 
  let twistAmt = sin(p2.y * 1.5 + u.time * u.animSpeed) * (0.8 + pulse);
  let c = cos(twistAmt); let s = sin(twistAmt);
  p2 = vec3f(c * p2.x - s * p2.z, p2.y, s * p2.x + c * p2.z);
  let dArtifact = sdBox(p2, vec3f(0.9, 2.5, 0.9)) - 0.2; // Rounded box
  
  // 3. Walls (Corridor)
  let corridorWidth = 5.0;
  let dWallL = p.x + corridorWidth;
  let dWallR = corridorWidth - p.x;
  let dWalls = min(dWallL, dWallR); // Infinite planes X
  
  // 4. Pillars (Repetition)
  // Repeat every 6 units along Z
  let zRep = p.z - 6.0 * floor(p.z / 6.0) - 3.0; 
  let pPillar = vec3f(abs(p.x) - (corridorWidth - 0.5), p.y, zRep);
  let dPillars = sdBox(pPillar, vec3f(0.6, 10.0, 0.6));
  
  let dStructure = min(dWalls, dPillars);
  
  // Composition
  if (dArtifact < dFloor && dArtifact < dStructure) { return vec2f(dArtifact, 2.0); }
  if (dFloor < dStructure) { return vec2f(dFloor, 1.0); }
  return vec2f(dStructure, 3.0);
}

fn calcNormal(p: vec3f) -> vec3f {
  let e = 0.001;
  return normalize(vec3f(
    map(p + vec3f(e, 0.0, 0.0)).x - map(p - vec3f(e, 0.0, 0.0)).x,
    map(p + vec3f(0.0, e, 0.0)).x - map(p - vec3f(0.0, e, 0.0)).x,
    map(p + vec3f(0.0, 0.0, e)).x - map(p - vec3f(0.0, 0.0, e)).x
  ));
}

fn raymarch(ro: vec3f, rd: vec3f, maxDist: f32) -> vec2f {
    var t = 0.0;
    var m = -1.0;
    for (var i = 0; i < 90; i++) { 
        let h = map(ro + rd * t);
        if (h.x < 0.001 || t > maxDist) {
            if (h.x < 0.001) { m = h.y; }
            break;
        }
        t += h.x;
    }
    if (t > maxDist) { m = -1.0; }
    return vec2f(t, m);
}

// --- ENVIRONMENT: COLD MOONLIGHT ---
fn getSkyColor(rd: vec3f) -> vec3f {
    let horizon = pow(1.0 - abs(rd.y), 4.0);
    // Cool, neutral colors to prevent yellow/green tint
    let top = vec3f(0.002, 0.002, 0.005); // Almost Black Blue
    let glow = vec3f(0.05, 0.06, 0.08); // Desaturated Blue Grey
    return mix(top, glow, horizon);
}

// --- RESERVOIR LOGIC ---
fn luminance(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn update_reservoir(r: ptr<function, Reservoir>, x: vec3f, w: f32, randVal: f32) {
    (*r).w_sum += w;
    (*r).M += 1.0;
    
    // Protection against NaN/Zero weights
    if ((*r).w_sum <= 1e-6) {
        (*r).y = x;
        return;
    }
    
    if (randVal < (w / (*r).w_sum)) {
        (*r).y = x;
    }
}

fn combine_reservoirs(r: ptr<function, Reservoir>, other: Reservoir, randVal: f32) {
    // CLAMPING: Prevent "Boiling" / Fireflies
    // In a dark scene, one bright pixel is huge. We clamp rigorously.
    let maxW = max((*r).w_sum * 15.0, 0.1); 
    let otherW = min(other.w_sum, maxW);

    (*r).M += other.M;
    (*r).w_sum += otherW;
    
    if ((*r).w_sum <= 1e-6) {
        (*r).y = other.y;
        return;
    }
    
    if (randVal < (otherW / (*r).w_sum)) {
        (*r).y = other.y;
    }
}

fn getCosHemisphereSample(n: vec3f, rand1: f32, rand2: f32) -> vec3f {
    let theta = 6.283185 * rand1;
    let phi = acos(sqrt(rand2));
    let local = vec3f(sin(phi)*cos(theta), cos(phi), sin(phi)*sin(theta));
    let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(n.z) < 0.999);
    let x = normalize(cross(up, n));
    let z = cross(n, x);
    return x * local.x + n * local.y + z * local.z;
}

// --- PASS 1: INTEGRATOR (Indirect Only) ---
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var output: VertexOutput;
  output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
  output.uv = pos[vertexIndex] * 0.5 + 0.5;
  return output;
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4f, @location(0) uv: vec2f) -> @location(0) vec4f {
    let resolution = u.resolution;
    
    let ro = u.cameraPos.xyz;
    let ta = vec3f(0.0);
    let ww = normalize(ta - ro);
    let uu = normalize(cross(ww, vec3f(0.0, 1.0, 0.0)));
    let vv = normalize(cross(uu, ww));
    let p = (-resolution + 2.0 * uv * resolution) / resolution.y;
    let rd = normalize(p.x * uu + p.y * vv + 1.5 * ww);
    
    let hit = raymarch(ro, rd, 40.0);
    let pos = ro + rd * hit.x;
    let n = calcNormal(pos);
    
    // --- PATH TRACING (INDIRECT) ---
    var indirectSample = vec3f(0.0);
    
    if (hit.y > 0.0) {
        let r1 = rng_float(fragCoord.xy, u.frameIndex, 0u);
        let r2 = rng_float(fragCoord.xy, u.frameIndex, 1u);
        
        // Ray Bias is critical here to prevent black floor artifacts
        let bounceDir = getCosHemisphereSample(n, r1, r2);
        let bounceHit = raymarch(pos + n * 0.05, bounceDir, 20.0);
        
        if (bounceHit.y > 0.0) {
            let bPos = pos + n * 0.05 + bounceDir * bounceHit.x;
            let bN = calcNormal(bPos);
            
            // Street Lamp approx position
            let lightPos = vec3f(15.0 * cos(u.lightAz * 6.28), 10.0 * u.lightEl + 5.0, 15.0 * sin(u.lightAz * 6.28));
            let blDir = normalize(lightPos - bPos);
            var bShadow = 1.0;
            if (raymarch(bPos + bN * 0.08, blDir, distance(bPos, lightPos)).y > 0.0) { bShadow = 0.0; }
            
            let bDiff = max(dot(bN, blDir), 0.0);
            
            // Material Colors for Bounce
            // 1=Floor (Asphalt), 2=Artifact, 3=Walls
            var bAlbedo = vec3f(0.1); // Default Asphalt
            if (bounceHit.y == 2.0) { bAlbedo = u.baseColor; }
            if (bounceHit.y == 3.0) { bAlbedo = vec3f(0.2, 0.2, 0.25); } // Concrete
            
            indirectSample = (bAlbedo * bDiff * bShadow * 6.0) * u.indirectIntensity; 
        } else {
            // SKY HIT
            indirectSample = getSkyColor(bounceDir) * u.indirectIntensity * 0.5;
        }
    }
    
    // Clamp to prevent fireflies in dark scene
    indirectSample = min(indirectSample, vec3f(3.0)); 

    // --- ReSTIR ACCUMULATION ---
    var r: Reservoir;
    r.y = indirectSample;
    let p_hat = luminance(indirectSample);
    r.w_sum = p_hat; 
    r.M = 1.0;
    
    let randRes = rng_float(fragCoord.xy, u.frameIndex, 2u);

    // TEMPORAL REUSE
    if (u.frameIndex > 0.0 && hit.y > 0.0) {
        let prevCoord = vec2u(fragCoord.xy);
        let prevData = textureLoad(historyTexture, prevCoord, 0); 
        
        var rPrev: Reservoir;
        rPrev.y = prevData.rgb;
        
        // Clamp M history. Lower M = less ghosting on moving objects
        rPrev.M = min(prevData.a, 12.0); 
        
        rPrev.w_sum = luminance(rPrev.y) * rPrev.M; 
        
        combine_reservoirs(&r, rPrev, randRes);
    }
    
    // SPATIAL REUSE
    if (hit.y > 0.0) {
        let texDim = vec2u(textureDimensions(historyTexture));
        let centerLum = luminance(r.y);

        for (var i = 0u; i < 6u; i++) { 
            let rS = rng_float(fragCoord.xy, u.frameIndex, 3u + i);
            let rAngle = rng_float(fragCoord.xy, u.frameIndex, 10u + i) * 6.28;
            
            // Radius: 20px
            let radius = pow(rS, 0.5) * 20.0; 
            let offset = vec2f(cos(rAngle), sin(rAngle)) * radius;
            let neighborCoord = vec2u(clamp(vec2f(fragCoord.xy) + offset, vec2f(0.0), vec2f(texDim) - 1.0));
            
            let nData = textureLoad(historyTexture, neighborCoord, 0);
            var rN: Reservoir;
            rN.y = nData.rgb;
            rN.M = min(nData.a, 8.0); 
            rN.w_sum = luminance(rN.y) * rN.M;
            
            // Edge Stopping (Luminance Geometry)
            let lNeighbor = luminance(rN.y);
            let diff = abs(centerLum - lNeighbor) / (max(centerLum, lNeighbor) + 0.1); 
            
            // Only merge if neighbors are somewhat similar brightness
            if (diff < 0.2) { 
                combine_reservoirs(&r, rN, rng_float(fragCoord.xy, u.frameIndex, 20u + i));
            }
        }
    }
    
    // Validation
    let isBad = any(r.y != r.y) || any(abs(r.y) > vec3f(65000.0));
    if (isBad) { r.y = vec3f(0.0); r.M = 0.0; }
    
    return vec4f(r.y, r.M);
}

// --- PASS 2: DISPLAY (Direct Light + Indirect Resolve + Denoise + Tonemap) ---
@fragment
fn fs_display(@builtin(position) fragCoord: vec4f, @location(0) uv: vec2f) -> @location(0) vec4f {
    let resolution = u.resolution;
    
    let ro = u.cameraPos.xyz;
    let ta = vec3f(0.0);
    let ww = normalize(ta - ro);
    let uu = normalize(cross(ww, vec3f(0.0, 1.0, 0.0)));
    let vv = normalize(cross(uu, ww));
    let p = (-resolution + 2.0 * uv * resolution) / resolution.y;
    let rd = normalize(p.x * uu + p.y * vv + 1.5 * ww);
    
    let hit = raymarch(ro, rd, 40.0);
    let pos = ro + rd * hit.x;
    let n = calcNormal(pos);
    
    // 1. Direct Lighting (PBR Approximation)
    var direct = vec3f(0.0);
    var albedo = vec3f(0.0);
    
    if (hit.y > 0.0) {
        let lightPos = vec3f(15.0 * cos(u.lightAz * 6.28), 10.0 * u.lightEl + 5.0, 15.0 * sin(u.lightAz * 6.28));
        let lDir = normalize(lightPos - pos);
        let viewDir = normalize(ro - pos);
        let dist = distance(pos, lightPos);
        
        var shadow = 1.0;
        // Increased bias (0.05) to fix floor flickering
        if (raymarch(pos + n * 0.05, lDir, dist).y > 0.0) { shadow = 0.0; }
        
        // PBR Logic
        // Calculate Roughness based on ID and Position (Wet Puddles)
        var roughness = u.roughness;
        var metallic = 0.0;
        
        if (hit.y == 1.0) { // Floor
            // Procedural Puddles: Use sine waves to create wet spots (roughness ~ 0)
            let noise = sin(pos.x * 2.0) * sin(pos.z * 2.5) + sin(pos.x * 0.5 + pos.z * 0.5);
            roughness = clamp(noise + 0.5, 0.05, 0.8); // 0.05 = wet, 0.8 = dry asphalt
            albedo = vec3f(0.05); // Neutral Dark Asphalt
        } else if (hit.y == 2.0) { // Artifact
            albedo = u.baseColor;
            metallic = 0.8;
            roughness = 0.2;
        } else { // Walls
            albedo = vec3f(0.1, 0.1, 0.12); // Concrete
            roughness = 0.9;
        }

        let diff = max(dot(n, lDir), 0.0);
        
        // Specular (Blinn-Phong)
        let halfDir = normalize(lDir + viewDir);
        let specPower = 128.0 * (1.0 - roughness) + 2.0;
        let spec = pow(max(dot(n, halfDir), 0.0), specPower);
        
        // Fresnel approximation for wet look
        let F0 = mix(vec3f(0.04), albedo, metallic);
        let fresnel = F0 + (1.0 - F0) * pow(1.0 - max(dot(viewDir, halfDir), 0.0), 5.0);
        
        let specColor = fresnel * spec * shadow * 2.0; 
        
        // Distance attenuation
        let atten = 100.0 / (dist * dist + 1.0);
        
        direct = (albedo * diff + specColor) * shadow * atten * 4.0;
    } else {
        // SKY
        direct = getSkyColor(rd) * 0.5; 
    }
    
    // 2. Fetch Indirect (ReSTIR)
    let rawIndirect = textureLoad(historyTexture, vec2u(fragCoord.xy), 0);
    var indirectSample = max(rawIndirect.rgb, vec3f(0.0));
    
    // --- SMART DENOISE (Bilateral Filter) ---
    // Aggressive Denoise when moving
    if (u.frameIndex < 60.0) { 
        var sum = vec3f(0.0);
        var wTotal = 0.0;
        let centerL = luminance(indirectSample);
        
        for(var x = -2; x <= 2; x++){ 
            for(var y = -2; y <= 2; y++){
                let off = vec2f(f32(x), f32(y));
                let coord = vec2u(clamp(fragCoord.xy + off, vec2f(0.0), resolution - 1.0));
                let s = textureLoad(historyTexture, coord, 0).rgb;
                let l = luminance(s);
                
                let dist = dot(off, off);
                let wSpace = exp(-dist * 0.3); 
                let wRange = exp(-abs(centerL - l) * 2.0);
                
                let w = wSpace * wRange;
                sum += s * w;
                wTotal += w;
            }
        }
        indirectSample = sum / max(wTotal, 0.001);
    }

    // Safety
    let isBadInd = any(indirectSample != indirectSample) || any(abs(indirectSample) > vec3f(65000.0));
    if (isBadInd) { indirectSample = vec3f(0.0); }
    
    // --- DEBUG MODES ---
    let mode = u32(u.debugMode);
    if (mode == 1u) { return vec4f(albedo, 1.0); } 
    if (mode == 2u) { return vec4f(n * 0.5 + 0.5, 1.0); } 
    if (mode == 3u) { return vec4f(direct, 1.0); } 
    if (mode == 4u) { return vec4f(indirectSample, 1.0); } 
    if (mode == 5u) { 
        let heat = clamp(rawIndirect.a / 12.0, 0.0, 1.0); 
        return vec4f(mix(vec3f(0.0,0.0,0.5), vec3f(1.0,0.2,0.0), heat), 1.0); 
    }
    
    var total = direct;
    if (hit.y > 0.0) {
        total += indirectSample;
    }
    
    // 3. Post Processing
    var color = total;
    
    // High Contrast Filmic Tonemap
    color = max(vec3f(0.0), color - 0.004);
    color = (color * (6.2 * color + 0.5)) / (color * (6.2 * color + 1.7) + 0.06);
    
    // Vignette
    let dV = length(uv - 0.5) * 1.5;
    color *= (1.0 - dV * 0.5);
    
    // Gamma
    color = pow(color, vec3f(1.0 / 2.2));
    
    // Aberration (Reduced to prevent green fringing)
    if (u.aberration > 0.0) {
        let off = u.aberration * 3.0; 
        let rCoord = vec2u(clamp(fragCoord.xy - vec2f(off, 0.0), vec2f(0.0), resolution - 1.0));
        let rVal = textureLoad(historyTexture, rCoord, 0).r; 
        let tmR = (rVal * (6.2 * rVal + 0.5)) / (rVal * (6.2 * rVal + 1.7) + 0.06);
        let rGamma = pow(tmR, 1.0/2.2);
        color.r = mix(color.r, rGamma, 0.6); 
    }
    
    // Grain 
    let noise = rng_float(fragCoord.xy, u.time, 99u);
    color += (noise - 0.5) * 0.08 * u.grainStrength;
    
    if (any(color != color)) { color = vec3f(0.0); }
    
    return vec4f(color, 1.0);
}
`