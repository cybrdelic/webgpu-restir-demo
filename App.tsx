import React, { useState, useEffect, useRef } from 'react';
import WebGPURenderer, { WebGPURendererRef } from './components/FireRenderer';
import { ErrorDisplay, DocumentationOverlay, MenuBar, MenuGroup, VideoExportOverlay, RecordingIndicator, ShaderEditor, ResearchOverlay } from './components/UIComponents';
import { ShaderError } from './types';
import { BOILERPLATE_SHADER_WGSL } from './constants';

const App: React.FC = () => {
  const [error, setError] = useState<ShaderError | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [shaderCode, setShaderCode] = useState(BOILERPLATE_SHADER_WGSL);
  const [recordingStatus, setRecordingStatus] = useState({ isRecording: false, timeLeft: 0 });
  const [fps, setFps] = useState(0);
  const rendererRef = useRef<WebGPURendererRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce Shader Updates
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCodeChange = (newCode: string) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
          setShaderCode(newCode);
      }, 500); // 500ms debounce
  };

  useEffect(() => {
    let lastTime = performance.now();
    let frame = 0;
    const loop = () => {
      const now = performance.now();
      frame++;
      if (now - lastTime >= 1000) {
        setFps(frame);
        frame = 0;
        lastTime = now;
      }
      requestAnimationFrame(loop);
    };
    loop();
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          rendererRef.current?.loadTexture(file);
      }
  };

  // Menu Configuration
  const menus: MenuGroup[] = [
    {
        label: 'File',
        items: [
            { label: 'Reset Scene', action: () => window.location.reload(), shortcut: 'CMD+R' },
            { label: 'Load Texture...', action: () => fileInputRef.current?.click(), shortcut: 'CMD+O' },
            { label: 'GitHub Repo', action: () => window.open('https://github.com/google/genai-sdk-js', '_blank') }
        ]
    },
    {
        label: 'View',
        items: [
            { label: 'Toggle Code Editor', action: () => setShowEditor(!showEditor), shortcut: 'E' },
            { label: 'Documentation', action: () => setShowDocs(true), shortcut: 'F1' },
            { label: 'Toggle Fullscreen', action: () => {
                if (!document.fullscreenElement) document.documentElement.requestFullscreen();
                else if (document.exitFullscreen) document.exitFullscreen();
            }, shortcut: 'F11' }
        ]
    },
    {
        label: 'Debug',
        items: [
            { label: 'Final Render', action: () => rendererRef.current?.setDebugMode(0), shortcut: '0' },
            { label: 'Albedo', action: () => rendererRef.current?.setDebugMode(1), shortcut: '1' },
            { label: 'Normals', action: () => rendererRef.current?.setDebugMode(2), shortcut: '2' },
            { label: 'Direct Light', action: () => rendererRef.current?.setDebugMode(3), shortcut: '3' },
            { label: 'Indirect (ReSTIR)', action: () => rendererRef.current?.setDebugMode(4), shortcut: '4' },
            { label: 'Sample Heatmap', action: () => rendererRef.current?.setDebugMode(5), shortcut: '5' },
        ]
    },
    {
        label: 'Render',
        items: [
            { label: 'Capture 4K (Standard)', action: () => rendererRef.current?.capture(1), shortcut: 'P' },
            { label: 'Capture 4K (Ultra + RT)', action: () => rendererRef.current?.capture(2), shortcut: 'SHIFT+P' },
            { label: 'Record Video...', action: () => setShowVideoModal(true), shortcut: 'V' }
        ]
    },
    {
        label: 'Research',
        items: [
            { label: 'About ReSTIR GI', action: () => setShowResearch(true) },
            { label: 'View Papers', action: () => setShowResearch(true) },
        ]
    },
    {
        label: 'Audio',
        items: [
            { label: 'Start Microphone', action: () => rendererRef.current?.toggleAudio() },
        ]
    },
    {
        label: 'Help',
        items: [
            { label: 'Troubleshooting', action: () => setShowDocs(true) },
        ]
    }
  ];

  const sceneDescription = "A real-time procedural artifact rendered via Raymarching. The geometry is defined by Signed Distance Functions (SDFs) and lit using a physical approximation with Soft Shadows and Ambient Occlusion. The surface reacts to audio frequencies, distorting the spatial grid.";

  return (
    <div className="w-screen h-screen relative bg-void overflow-hidden font-sans text-white select-none pt-10 antialiased">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileSelect} />
      
      {/* Top Menu Bar */}
      <MenuBar menus={menus} />

      {/* 3D Canvas Layer */}
      <div className={`absolute inset-0 z-0 top-10 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showEditor ? 'left-[600px]' : 'left-0'}`}>
        <WebGPURenderer 
          ref={rendererRef}
          shaderCode={shaderCode}
          description={sceneDescription}
          onError={(e) => setError(e)}
          onClearError={() => setError(null)}
          onRecordProgress={(isRecording, timeLeft) => setRecordingStatus({ isRecording, timeLeft })}
        />
      </div>

      {/* HUD Layer (Non-Header parts) */}
      <div className={`absolute inset-0 z-10 pointer-events-none p-6 md:p-12 flex flex-col justify-end transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showEditor ? 'left-[600px]' : 'left-0'}`}>
        <footer className="flex justify-between items-end">
            <div className="flex flex-col gap-1 pointer-events-auto opacity-50 hover:opacity-100 transition-opacity">
                 <div className="flex items-center gap-2 font-mono text-[10px] text-acid">
                    <span className="animate-pulse">●</span> SYSTEM_READY
                 </div>
                 <div className="font-mono text-[10px] text-white/40 tracking-widest">
                    {fps} FPS // {window.innerWidth}x{window.innerHeight}
                 </div>
            </div>
            <div className="text-right pointer-events-auto">
               <span className="text-[10px] font-mono text-white/30 tracking-widest uppercase">
                   Generated by Gemini 2.0 Flash
               </span>
            </div>
        </footer>
      </div>
      
      {/* Modals & Overlays */}
      <div className="pointer-events-auto">
           <ErrorDisplay error={error} onClose={() => setError(null)} />
           <DocumentationOverlay isOpen={showDocs} onClose={() => setShowDocs(false)} />
           <ResearchOverlay isOpen={showResearch} onClose={() => setShowResearch(false)} />
           <ShaderEditor 
                isOpen={showEditor} 
                onClose={() => setShowEditor(false)} 
                code={shaderCode} 
                onCodeChange={handleCodeChange} 
                error={error}
           />
           <VideoExportOverlay 
                isOpen={showVideoModal} 
                onClose={() => setShowVideoModal(false)}
                onStartRecord={(config) => rendererRef.current?.startVideo(config)}
           />
           <RecordingIndicator 
                isRecording={recordingStatus.isRecording} 
                timeLeft={recordingStatus.timeLeft} 
                onStop={() => rendererRef.current?.stopVideo()}
           />
      </div>
    </div>
  );
};

export default App;