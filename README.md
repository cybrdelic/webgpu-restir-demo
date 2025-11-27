# WebGPU ReSTIR GI Renderer

A high-performance WebGPU boilerplate implementing **ReSTIR GI (Reservoir Spatiotemporal Importance Resampling)** for real-time global illumination.

## 🌟 Features

1.  **ReSTIR GI Integration**: 
    *   Implements **Reservoir Sampling** to intelligently select high-contribution light paths.
    *   **Temporal Reuse**: Reprojects history buffers to accumulate lighting samples over time.
    *   **Spatial Reuse**: Borrows samples from neighboring pixels to rapidly converge indirect lighting.
    
2.  **Dual-Pass Pipeline (Ping-Pong)**:
    *   **Integrator Pass**: Renders to an off-screen floating point HDR texture (`rgba16float`).
    *   **Display Pass**: Performs ACES tonemapping, dithering, and chromatic aberration on the HDR result.

3.  **React + WebGPU**: 
    *   Engine logic (Buffers, Pipelines, Loop) is handled in React hooks.
    *   Shader logic (WGSL) is editable and hot-reloadable.

## 🛠 Architecture

*   **`FireRenderer.tsx`**: Manages the `GPUTexture` ping-pong buffers (History A/B). It executes two render passes per frame.
*   **`constants.ts`**: Contains the WGSL shader.
    *   `fs_main`: The **Integrator**. Raymarches the scene, calculates direct light, traces secondary rays, and performs ReSTIR logic.
    *   `fs_display`: The **Post-Processor**.

## 🎮 Controls

*   **GI Intensity**: Controls the brightness of the indirect bounce.
*   **Roughness**: Controls the material properties.
*   **Anim Speed**: Speeds up the SDF deformation (note: fast motion may cause temporal lag/ghosting).

## ⚠️ Notes
*   This implementation assumes a static camera-to-world projection for temporal reuse (no motion vectors), so rapid camera movement may streak.
*   Spatial reuse uses a simplified neighborhood kernel.
