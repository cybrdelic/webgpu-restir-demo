import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { ShaderError, ShaderParam, VideoConfig } from '../types';
import { calculateUniformLayout, writeParamsToBuffer, ParamsControlPanel } from './ShaderParams';

// --- WebGPU Type Stubs ---
type GPUDevice = any;
type GPUCanvasContext = any;
type GPURenderPipeline = any;
type GPUBuffer = any;
type GPUBindGroup = any;
type GPUTexture = any;
declare const GPUBufferUsage: any;
declare const GPUShaderStage: any;

const getErrorMessage = (err: any): string => {
  if (err === undefined) return "Undefined Error";
  if (err === null) return "Null Error";
  if (typeof err === 'string') return err;
  if (err.reason !== undefined && err.message !== undefined) return `Device Lost (${err.reason}): ${err.message}`;
  if (err.message !== undefined) return String(err.message);
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try { const json = JSON.stringify(err); if (json !== '{}') return json; } catch (e) {}
  return String(err);
};

export interface WebGPURendererRef {
  capture: (quality?: number) => void;
  startVideo: (config: VideoConfig) => void;
  stopVideo: () => void;
  loadTexture: (file: File) => void;
  toggleAudio: () => Promise<void>;
  setDebugMode: (mode: number) => void;
}

interface WebGPURendererProps {
  shaderCode: string;
  description?: string;
  onError: (error: ShaderError) => void;
  onClearError: () => void;
  onRecordProgress: (isRecording: boolean, timeLeft: number) => void;
}

const WebGPURenderer = forwardRef<WebGPURendererRef, WebGPURendererProps>(({ shaderCode, description, onError, onClearError, onRecordProgress }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  
  const deviceRef = useRef<GPUDevice | null>(null);
  const contextRef = useRef<GPUCanvasContext | null>(null);
  
  // Pipeline State
  const integratorPipelineRef = useRef<GPURenderPipeline | null>(null); // Pass 1: ReSTIR Integrator
  const displayPipelineRef = useRef<GPURenderPipeline | null>(null);    // Pass 2: Tonemap & Display
  
  const uniformBufferRef = useRef<GPUBuffer | null>(null);
  const userTextureRef = useRef<any>(null); 
  const defaultNoiseTextureRef = useRef<any>(null); 
  const samplerRef = useRef<any>(null); 
  
  // History / ReSTIR State (Ping-Pong)
  // We need two textures to read from Previous (A) and write to Current (B), then swap.
  const historyTextureARef = useRef<GPUTexture | null>(null);
  const historyTextureBRef = useRef<GPUTexture | null>(null);
  const frameIndexRef = useRef<number>(0);

  const requestRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(performance.now());
  const isMountedRef = useRef<boolean>(true);
  
  // Audio State
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const audioDataArrayRef = useRef<Uint8Array | null>(null);

  // Capture State
  const capturePendingRef = useRef<number>(0); 
  
  // Video Recording State
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingConfigRef = useRef<VideoConfig | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const isRecordingRef = useRef<boolean>(false);
  const recordedFramesRef = useRef<number>(0);

  // --- EASY PARAM WIRING ---
  const [params, setParams] = useState<ShaderParam[]>([
    { id: 'animSpeed', label: 'Animation Speed', type: 'float', value: 0.8, min: 0.0, max: 5.0 },
    { id: 'boxRoughness', label: 'Roughness', type: 'float', value: 0.1, min: 0.0, max: 1.0 },
    { id: 'indirectIntensity', label: 'Light Intensity', type: 'float', value: 1.8, min: 0.0, max: 10.0 }, 
    { id: 'grainStrength', label: 'Film Grain', type: 'float', value: 0.5, min: 0.0, max: 2.0 },
    { id: 'baseColor', label: 'Artifact Color', type: 'color', value: [0.8, 0.85, 1.0] }, // Cool White
    { id: 'lightAz', label: 'Light Azimuth', type: 'float', value: 0.9, min: 0.0, max: 1.0 }, // Side lighting
    { id: 'lightEl', label: 'Light Elevation', type: 'float', value: 0.2, min: 0.0, max: 1.0 }, // Low angle
    { id: 'aberrationStrength', label: 'Aberration', type: 'float', value: 0.02, min: 0.0, max: 1.0 }, // Very low to prevent green fringing
    { id: 'debugMode', label: 'Debug Mode', type: 'float', value: 0.0, min: 0.0, max: 5.0, step: 1.0 },
  ]);

  const paramsRef = useRef(params);
  useEffect(() => { paramsRef.current = params; }, [params]);

  const STANDARD_HEADER_SIZE = 48;
  const layout = calculateUniformLayout(params, STANDARD_HEADER_SIZE);
  const TOTAL_BUFFER_SIZE = 128; // Increased buffer size just in case

  const cameraState = useRef({ theta: 0.5, phi: 0.1, radius: 5.5, isDragging: false, lastX: 0, lastY: 0 });
  const mouseState = useRef({ x: 0, y: 0, isDown: 0 });

  // --- HELPER: Texture Creation ---
  const createTextureFromImage = async (device: GPUDevice, source: ImageBitmap | HTMLCanvasElement) => {
    const texture = device.createTexture({
        size: [source.width, source.height, 1],
        format: 'rgba8unorm',
        usage: 0x04 | 0x02 | 0x01 | 0x10, 
    });
    device.queue.copyExternalImageToTexture(
        { source },
        { texture },
        [source.width, source.height]
    );
    return texture;
  };
  
  const createDefaultTexture = (device: GPUDevice) => {
      // Noise Texture for initialization
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx) {
          const id = ctx.getImageData(0,0,size,size);
          for(let i=0; i<id.data.length; i+=4) {
              id.data[i] = Math.random() * 255;
              id.data[i+1] = Math.random() * 255;
              id.data[i+2] = Math.random() * 255;
              id.data[i+3] = 255;
          }
          ctx.putImageData(id, 0, 0);
      }
      return createTextureFromImage(device, canvas);
  };

  const createHistoryTexture = (device: GPUDevice, width: number, height: number) => {
      return device.createTexture({
          label: 'HistoryTexture',
          size: [width, height, 1],
          format: 'rgba16float', // HDR format critical for light accumulation
          usage: 0x04 | 0x02 | 0x10, // TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT
      });
  };

  useImperativeHandle(ref, () => ({
    capture: (quality = 1) => { capturePendingRef.current = quality; },
    loadTexture: async (file: File) => {
        if (!deviceRef.current || !file) return;
        try {
            const bitmap = await createImageBitmap(file);
            const texture = await createTextureFromImage(deviceRef.current, bitmap);
            userTextureRef.current = texture;
        } catch (e) { console.error("Failed to load texture", e); }
    },
    toggleAudio: async () => {
        if (audioContextRef.current) { audioContextRef.current.suspend(); audioContextRef.current = null; return; }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const ctx = new AudioContext();
            const source = ctx.createMediaStreamSource(stream);
            const analyzer = ctx.createAnalyser();
            analyzer.fftSize = 256;
            source.connect(analyzer);
            audioContextRef.current = ctx; analyzerRef.current = analyzer; audioDataArrayRef.current = new Uint8Array(analyzer.frequencyBinCount);
        } catch (e) { alert("Could not access microphone."); }
    },
    startVideo: (config: VideoConfig) => {
        if (!canvasRef.current) return;
        recordingConfigRef.current = config; chunksRef.current = []; recordedFramesRef.current = 0;
        canvasRef.current.width = 1920; canvasRef.current.height = 1080;
        const stream = canvasRef.current.captureStream(config.fps);
        recorderRef.current = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: config.bitrate * 1000000 });
        recorderRef.current.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        recorderRef.current.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `restir_render_${Date.now()}.webm`; a.click(); URL.revokeObjectURL(url);
            isRecordingRef.current = false; onRecordProgress(false, 0);
        };
        recorderRef.current.start(); recordingStartTimeRef.current = performance.now(); isRecordingRef.current = true;
    },
    stopVideo: () => { if (recorderRef.current && recorderRef.current.state === 'recording') recorderRef.current.stop(); },
    setDebugMode: (mode: number) => {
        setParams(prev => {
             const exists = prev.find(p => p.id === 'debugMode');
             if (exists) {
                 return prev.map(p => p.id === 'debugMode' ? { ...p, value: mode } : p);
             } else {
                 return [...prev, { id: 'debugMode', label: 'Debug View', type: 'float', value: mode, min: 0, max: 5 }];
             }
         });
    }
  }));

  const compilePipeline = async (device: GPUDevice, code: string, context: GPUCanvasContext) => {
      const screenFormat = (navigator as any).gpu.getPreferredCanvasFormat();
      const historyFormat = 'rgba16float';

      const shaderModule = device.createShaderModule({ label: 'Main', code });
      const compilationInfo = await shaderModule.getCompilationInfo();
      if (compilationInfo.messages.length > 0) {
        let hasError = false;
        for (const msg of compilationInfo.messages) {
          if (msg.type === 'error') {
              hasError = true;
              onError({ type: 'compilation', message: getErrorMessage(msg.message), lineNum: msg.lineNum, linePos: msg.linePos });
          }
        }
        if (hasError) return;
      }
      onClearError();

      // Common Layout
      const bindGroupLayout = device.createBindGroupLayout({ 
          entries: [
              { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' }},
              { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, // History (Input)
              { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }
          ]
      });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

      // Pipeline 1: Integrator (ReSTIR)
      // Renders to RGBA16Float (History Buffer)
      const integratorPipeline = device.createRenderPipeline({
        label: 'Integrator Pipeline',
        layout: pipelineLayout,
        vertex: { module: shaderModule, entryPoint: 'vs_main' },
        fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format: historyFormat }] },
        primitive: { topology: 'triangle-list' },
      });
      integratorPipelineRef.current = integratorPipeline;

      // Pipeline 2: Display (Tonemapper)
      // Renders to Screen
      const displayPipeline = device.createRenderPipeline({
        label: 'Display Pipeline',
        layout: pipelineLayout,
        vertex: { module: shaderModule, entryPoint: 'vs_main' },
        fragment: { module: shaderModule, entryPoint: 'fs_display', targets: [{ format: screenFormat }] },
        primitive: { topology: 'triangle-list' },
      });
      displayPipelineRef.current = displayPipeline;
      
      // Reset accumulation on shader recompile
      frameIndexRef.current = 0;
  };

  useEffect(() => {
    isMountedRef.current = true;
    const initWebGPU = async () => {
      const gpu = (navigator as any).gpu;
      if (!gpu) { setIsSupported(false); onError({ type: 'compilation', message: "WebGPU not supported." }); return; }

      try {
        const adapter = await gpu.requestAdapter();
        const device = await adapter.requestDevice();
        if (!isMountedRef.current) { device.destroy(); return; }
        deviceRef.current = device;

        device.lost.then((info: any) => { if (isMountedRef.current) onError({ type: 'runtime', message: getErrorMessage(info) }); });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('webgpu') as any;
        contextRef.current = context;
        context.configure({ device, format: gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });

        const uniformBuffer = device.createBuffer({ size: TOTAL_BUFFER_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        uniformBufferRef.current = uniformBuffer;

        const defaultTex = await createDefaultTexture(device);
        defaultNoiseTextureRef.current = defaultTex;
        
        const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
        samplerRef.current = sampler;

        await compilePipeline(device, shaderCode, context);
        requestRef.current = requestAnimationFrame(render);
      } catch (err: any) { onError({ type: 'compilation', message: getErrorMessage(err) }); }
    };
    initWebGPU();
    return () => { isMountedRef.current = false; if (requestRef.current !== null) cancelAnimationFrame(requestRef.current); };
  }, []);

  useEffect(() => {
      if (deviceRef.current && contextRef.current) {
          compilePipeline(deviceRef.current, shaderCode, contextRef.current);
      }
  }, [shaderCode]);

  const render = (time: number) => {
    const device = deviceRef.current;
    const context = contextRef.current;
    const integratorPipe = integratorPipelineRef.current;
    const displayPipe = displayPipelineRef.current;
    const uniformBuffer = uniformBufferRef.current;
    const canvas = canvasRef.current;

    if (!device || !context || !integratorPipe || !displayPipe || !uniformBuffer) {
         requestRef.current = requestAnimationFrame(render); return;
    }

    // --- CANVAS SIZING ---
    let width, height;
    if (capturePendingRef.current > 0) { width = 3840; height = 2160; }
    else if (isRecordingRef.current) { width = 1920; height = 1080; }
    else {
        const dpr = window.devicePixelRatio || 1; 
        width = Math.floor(canvas.clientWidth * dpr);
        height = Math.floor(canvas.clientHeight * dpr);
    }
    
    // Ensure History Buffers Exist and are Correct Size
    if (canvas.width !== width || canvas.height !== height || !historyTextureARef.current || !historyTextureBRef.current) { 
        canvas.width = width; canvas.height = height; 
        
        // Destroy old if exist
        if (historyTextureARef.current) historyTextureARef.current.destroy();
        if (historyTextureBRef.current) historyTextureBRef.current.destroy();

        historyTextureARef.current = createHistoryTexture(device, width, height);
        historyTextureBRef.current = createHistoryTexture(device, width, height);
        
        frameIndexRef.current = 0; // Reset accumulation on resize
    }

    // --- TIMING & PHYSICS ---
    let elapsedTime = (time - startTimeRef.current) * 0.001;
    let cameraTheta = cameraState.current.theta;
    let cameraPhi = cameraState.current.phi;
    let cameraRadius = cameraState.current.radius;
    
    // Check input state for reset
    const camMoved = mouseState.current.isDown > 0.5 || isRecordingRef.current || cameraState.current.isDragging;
    
    if (isRecordingRef.current && recordingConfigRef.current) {
        const fps = recordingConfigRef.current.fps;
        elapsedTime = recordedFramesRef.current / fps;
        recordedFramesRef.current++;
        const duration = recordingConfigRef.current.duration;
        onRecordProgress(true, Math.max(0, duration - elapsedTime));
        
        if (elapsedTime >= duration) {
             if (recorderRef.current && recorderRef.current.state === 'recording') recorderRef.current.stop();
        }
    }

    const cx = cameraRadius * Math.cos(cameraPhi) * Math.sin(cameraTheta);
    const cy = cameraRadius * Math.sin(cameraPhi);
    const cz = cameraRadius * Math.cos(cameraPhi) * Math.cos(cameraTheta);
    
    // Update Uniforms
    const currentParams = [...paramsRef.current];
    const uniformData = new Float32Array(TOTAL_BUFFER_SIZE / 4); 
    uniformData[0] = width; uniformData[1] = height; uniformData[2] = elapsedTime; uniformData[3] = frameIndexRef.current;
    uniformData[4] = cx; uniformData[5] = cy; uniformData[6] = cz;
    uniformData[8] = mouseState.current.x; uniformData[9] = mouseState.current.y; uniformData[10] = mouseState.current.isDown;
    writeParamsToBuffer(uniformData, currentParams, layout);

    // Audio FFT logic
    let vol = 0;
    if (analyzerRef.current && audioDataArrayRef.current) {
        analyzerRef.current.getByteFrequencyData(audioDataArrayRef.current);
        const data = audioDataArrayRef.current;
        for(let i=0; i<data.length; i++) vol += data[i];
        vol /= (data.length * 255);
    }
    uniformData[31] = vol; // Audio Vol at end
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const commandEncoder = device.createCommandEncoder();

    // ----------------------------------------------------
    // PASS 1: INTEGRATOR (ReSTIR)
    // ----------------------------------------------------
    // Read from A (Previous), Write to B (Current)
    // If Frame 0, Input is Noise/Black.
    const sourceTexture = historyTextureARef.current;
    const destTexture = historyTextureBRef.current;
    
    const integratorBindGroup = device.createBindGroup({
        layout: integratorPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: (frameIndexRef.current === 0) ? defaultNoiseTextureRef.current.createView() : sourceTexture.createView() },
            { binding: 2, resource: samplerRef.current }
        ]
    });

    const pass1 = commandEncoder.beginRenderPass({
        label: 'Integrator Pass',
        colorAttachments: [{
            view: destTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear', storeOp: 'store'
        }]
    });
    pass1.setPipeline(integratorPipe);
    pass1.setBindGroup(0, integratorBindGroup);
    pass1.draw(6);
    pass1.end();

    // ----------------------------------------------------
    // PASS 2: DISPLAY (Tonemapping)
    // ----------------------------------------------------
    // Read from B (Current Result), Write to Screen
    const displayBindGroup = device.createBindGroup({
        layout: displayPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: destTexture.createView() }, // Read the texture we just wrote to
            { binding: 2, resource: samplerRef.current }
        ]
    });

    const textureView = context.getCurrentTexture().createView();
    const pass2 = commandEncoder.beginRenderPass({
        label: 'Display Pass',
        colorAttachments: [{
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear', storeOp: 'store'
        }]
    });
    pass2.setPipeline(displayPipe);
    pass2.setBindGroup(0, displayBindGroup);
    pass2.draw(6);
    pass2.end();

    device.queue.submit([commandEncoder.finish()]);

    // ----------------------------------------------------
    // PING-PONG SWAP
    // ----------------------------------------------------
    // Swap A and B. B becomes the 'Previous' for the next frame.
    const temp = historyTextureARef.current;
    historyTextureARef.current = historyTextureBRef.current;
    historyTextureBRef.current = temp;
    frameIndexRef.current++;

    if (capturePendingRef.current > 0) {
        const link = document.createElement('a');
        link.download = `restir_capture_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();
        capturePendingRef.current = 0;
    }

    requestRef.current = requestAnimationFrame(render);
  };

  const handlePointerDown = (e: React.PointerEvent) => { 
      if (isRecordingRef.current) return; 
      canvasRef.current?.setPointerCapture(e.pointerId); 
      cameraState.current.isDragging = true; 
      cameraState.current.lastX = e.clientX; 
      cameraState.current.lastY = e.clientY; 
      mouseState.current.isDown = 1.0; 
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if(rect) { mouseState.current.x = e.clientX - rect.left; mouseState.current.y = e.clientY - rect.top; }
    if (cameraState.current.isDragging) {
      const dx = e.clientX - cameraState.current.lastX; const dy = e.clientY - cameraState.current.lastY;
      cameraState.current.lastX = e.clientX; cameraState.current.lastY = e.clientY;
      cameraState.current.theta -= dx * 0.01; cameraState.current.phi += dy * 0.01;
      cameraState.current.phi = Math.max(-1.5, Math.min(1.5, cameraState.current.phi));
      // Reset accumulation on move
      frameIndexRef.current = 0;
    }
  };
  const handlePointerUp = (e: React.PointerEvent) => { canvasRef.current?.releasePointerCapture(e.pointerId); cameraState.current.isDragging = false; mouseState.current.isDown = 0.0; };
  const handleWheel = (e: React.WheelEvent) => { 
      cameraState.current.radius = Math.max(1.0, Math.min(50.0, cameraState.current.radius + e.deltaY * 0.005)); 
      frameIndexRef.current = 0;
  };

  if (!isSupported) return <div className="w-full h-full flex items-center justify-center bg-black text-red-500 font-mono"><p>WebGPU not supported.</p></div>;

  return (
    <>
        <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair touch-none" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp} onWheel={handleWheel} />
        <ParamsControlPanel params={params} setParams={setParams} description={description} />
    </>
  );
});

export default WebGPURenderer;