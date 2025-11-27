

import React, { useState, useEffect, useRef } from 'react';
import { ShaderError, VideoConfig, ShotType } from '../types';
import Editor, { useMonaco, Monaco } from '@monaco-editor/react';

// --- Types ---
export interface MenuItem {
    label: string;
    action: () => void;
    shortcut?: string;
}

export interface MenuGroup {
    label: string;
    items: MenuItem[];
}

// --- Components ---

interface ErrorDisplayProps {
  error: ShaderError | null;
  onClose: () => void;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, onClose }) => {
  const [copied, setCopied] = useState(false);
  if (!error) return null;

  const handleCopy = () => {
    const text = `${error.type.toUpperCase()} ERROR:\n${error.message}\n${error.lineNum ? `Line: ${error.lineNum}, Pos: ${error.linePos}` : ''}`;
    navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl px-6 animate-fade-in-up">
      <div className="bg-black border border-red-600 shadow-[0_0_50px_rgba(220,38,38,0.3)] relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-red-600 animate-pulse-fast"></div>
        <div className="p-8">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h2 className="text-3xl font-bold text-red-600 tracking-tighter uppercase mb-1">System Error</h2>
                    <p className="font-mono text-xs text-red-600/60 uppercase tracking-widest">
                        Module: {error.type} // Critical Failure
                    </p>
                </div>
                <button onClick={onClose} className="w-10 h-10 flex items-center justify-center border border-red-900 hover:bg-red-900/20 text-red-600 transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <div className="bg-red-950/10 border border-red-900/30 p-4 font-mono text-xs text-red-400 overflow-x-auto whitespace-pre-wrap max-h-64 custom-scrollbar mb-6">
                {error.message}
            </div>
            <div className="flex justify-between items-center">
                 {error.lineNum ? (
                     <div className="text-xs font-mono text-red-500 bg-red-950/30 px-2 py-1">
                         AT LINE {error.lineNum} : COL {error.linePos}
                     </div>
                 ) : <div></div>}
                 
                 <button onClick={handleCopy} className="text-xs font-mono font-bold text-white uppercase hover:text-red-500 transition-colors flex items-center gap-2">
                     {copied ? '[ LOG COPIED ]' : '[ COPY DIAGNOSTICS ]'}
                 </button>
            </div>
        </div>
      </div>
    </div>
  );
};

interface VideoExportOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onStartRecord: (config: VideoConfig) => void;
}

export const VideoExportOverlay: React.FC<VideoExportOverlayProps> = ({ isOpen, onClose, onStartRecord }) => {
    const [config, setConfig] = useState<VideoConfig>({
        duration: 5,
        fps: 60,
        bitrate: 25,
        shotType: 'orbit',
        orchestrate: false,
        postProcess: { grain: 0.1, aberration: 0.2 },
        format: 'webm'
    });

    if (!isOpen) return null;

    const shotTypes: { id: ShotType, label: string }[] = [
        { id: 'orbit', label: 'Classic Orbit' },
        { id: 'sweep', label: 'Low Sweep' },
        { id: 'dolly', label: 'Slow Zoom' },
        { id: 'breathing', label: 'Breathing' },
        { id: 'chaos', label: 'Handheld Chaos' },
    ];

    const previewStyles = `
      @keyframes preview-orbit { 0% { transform: rotateY(0deg); } 100% { transform: rotateY(360deg); } }
      @keyframes preview-sweep { 0%, 100% { transform: translateY(0) rotateX(0); } 50% { transform: translateY(20px) rotateX(15deg); } }
      @keyframes preview-dolly { 0%, 100% { transform: scale(0.6); } 50% { transform: scale(1.1); } }
      @keyframes preview-breathing { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
      @keyframes preview-chaos { 
          0% { transform: translate(0,0) rotate(0deg); } 
          25% { transform: translate(2px, -2px) rotate(1deg); }
          50% { transform: translate(-2px, 2px) rotate(-1deg); }
          75% { transform: translate(-1px, -1px) rotate(0.5deg); }
          100% { transform: translate(0,0) rotate(0deg); }
      }
    `;

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in-up">
            <style>{previewStyles}</style>
            <div className="w-full max-w-4xl bg-black border border-white/20 shadow-2xl flex flex-col md:flex-row overflow-hidden max-h-[90vh]">
                
                {/* Left: Settings */}
                <div className="flex-1 p-8 space-y-6 overflow-y-auto custom-scrollbar">
                    <div className="flex justify-between items-start">
                        <h2 className="text-2xl font-bold uppercase tracking-tighter">Video Export</h2>
                        <button onClick={onClose} className="text-white/40 hover:text-white"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-mono uppercase text-gray-400">Duration (Sec)</label>
                            <input type="range" min="1" max="20" step="1" value={config.duration} onChange={e => setConfig({...config, duration: Number(e.target.value)})} />
                            <div className="text-right font-mono text-xs">{config.duration}s</div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-mono uppercase text-gray-400">Framerate</label>
                            <div className="flex gap-2">
                                {[30, 60].map(f => (
                                    <button key={f} onClick={() => setConfig({...config, fps: f})} className={`flex-1 py-2 font-mono text-xs border ${config.fps === f ? 'bg-white text-black border-white' : 'border-white/20 text-white/50 hover:border-white'}`}>
                                        {f} FPS
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-mono uppercase text-gray-400">Camera Movement</label>
                            <div className="grid grid-cols-2 gap-2">
                                {shotTypes.map(t => (
                                    <button key={t.id} onClick={() => setConfig({...config, shotType: t.id})} className={`px-3 py-2 text-left font-mono text-[10px] border transition-all ${config.shotType === t.id ? 'bg-acid text-black border-acid' : 'border-white/10 hover:border-white/40'}`}>
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <button onClick={() => onStartRecord(config)} className="w-full py-4 bg-white text-black font-bold uppercase tracking-widest hover:bg-acid transition-colors flex items-center justify-center gap-2">
                        <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse"></div>
                        Start Render
                    </button>
                </div>

                {/* Right: Visualizer */}
                <div className="w-full md:w-80 bg-white/5 border-l border-white/10 p-8 flex flex-col justify-center items-center relative overflow-hidden">
                     <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
                     
                     <div className="relative w-40 h-40 border border-white/20 rounded-full flex items-center justify-center perspective-1000">
                         <div 
                            className="w-20 h-20 border border-acid/50 bg-acid/10 backdrop-blur-md"
                            style={{ 
                                animation: `preview-${config.shotType} 4s infinite linear`,
                                transformStyle: 'preserve-3d' 
                            }}
                         >
                            <div className="absolute inset-0 border border-acid/30 translate-z-4"></div>
                         </div>
                     </div>
                     <div className="mt-8 text-center space-y-2">
                         <p className="font-mono text-xs text-acid uppercase tracking-widest">{config.shotType}</p>
                         <p className="font-mono text-[10px] text-white/40">The camera will perform a procedural {config.shotType} movement around the artifact.</p>
                     </div>
                </div>
            </div>
        </div>
    );
};

interface RecordingIndicatorProps {
  isRecording: boolean;
  timeLeft: number;
  onStop: () => void;
}

export const RecordingIndicator: React.FC<RecordingIndicatorProps> = ({ isRecording, timeLeft, onStop }) => {
    if (!isRecording) return null;
    return (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-2 flex items-center gap-4 shadow-[0_0_30px_rgba(220,38,38,0.5)] animate-pulse-fast z-50">
            <div className="w-2 h-2 bg-white rounded-full"></div>
            <span className="font-mono font-bold tracking-widest text-sm">REC {timeLeft.toFixed(1)}s</span>
            <button onClick={onStop} className="ml-2 w-6 h-6 flex items-center justify-center bg-white text-red-600 rounded hover:scale-110 transition-transform">
                <div className="w-2 h-2 bg-current"></div>
            </button>
        </div>
    );
};

// --- Documentation Overlay ---
interface DocumentationOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DocumentationOverlay: React.FC<DocumentationOverlayProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 bg-black/90 backdrop-blur-md flex justify-end animate-slide-in-right">
      <div className="w-full max-w-2xl h-full bg-black border-l border-white/20 p-8 md:p-12 overflow-y-auto custom-scrollbar relative">
        <button onClick={onClose} className="absolute top-8 right-8 text-white/50 hover:text-white transition-colors">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        <div className="space-y-12">
            <div>
                <h1 className="text-4xl font-bold tracking-tighter mb-2">ReSTIR GI Renderer</h1>
                <p className="font-mono text-acid text-xs uppercase tracking-widest">v2.0.4 // Gemini Native</p>
            </div>

            <div className="space-y-6 text-gray-300 font-light leading-relaxed">
                <p>
                    This engine implements <strong>Reservoir Spatiotemporal Importance Resampling (ReSTIR)</strong> to achieve real-time global illumination on the web.
                    Unlike standard path tracing which requires thousands of samples per pixel, ReSTIR intelligently "reuses" light samples from neighboring pixels and previous frames.
                </p>
                <div className="p-4 border border-white/10 bg-white/5 space-y-2">
                    <h3 className="font-bold text-white">Controls</h3>
                    <ul className="list-disc list-inside text-sm space-y-1 text-gray-400">
                        <li><strong>Left Click + Drag</strong>: Rotate Camera</li>
                        <li><strong>Scroll</strong>: Zoom In/Out</li>
                        <li><strong>V</strong>: Open Video Export Menu</li>
                        <li><strong>F11</strong>: Toggle Fullscreen</li>
                    </ul>
                </div>
            </div>

            <div>
                <h2 className="text-2xl font-bold mb-4">Pipeline Architecture</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 border border-white/10 hover:border-acid/50 transition-colors">
                        <div className="font-mono text-xs text-acid mb-2">PASS 01</div>
                        <h3 className="font-bold mb-1">Integrator</h3>
                        <p className="text-xs text-gray-400">Raymarches scene geometry. Calculates direct lighting. Traces 1 bounce for GI. Resamples reservoirs temporally and spatially.</p>
                    </div>
                    <div className="p-4 border border-white/10 hover:border-acid/50 transition-colors">
                        <div className="font-mono text-xs text-acid mb-2">PASS 02</div>
                        <h3 className="font-bold mb-1">Display</h3>
                        <p className="text-xs text-gray-400">Applies Bilateral Denoising, ACES Tonemapping, Chromatic Aberration, and Dithering.</p>
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

// --- Research Overlay ---
interface ResearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ResearchOverlay: React.FC<ResearchOverlayProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-50 bg-black/95 backdrop-blur-xl flex items-center justify-center animate-fade-in-up p-4">
            <div className="w-full max-w-3xl border border-white/10 bg-black shadow-2xl relative max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center p-6 border-b border-white/10">
                    <h2 className="text-xl font-mono uppercase tracking-widest text-acid">Research / References</h2>
                    <button onClick={onClose} className="text-white/50 hover:text-white"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                </div>
                
                <div className="p-8 overflow-y-auto custom-scrollbar space-y-8">
                    <div>
                        <h3 className="text-2xl font-bold mb-2">Spatiotemporal Reservoir Resampling (ReSTIR)</h3>
                        <p className="text-sm text-gray-400 leading-relaxed mb-4">
                            Bitterli et al., SIGGRAPH 2020. This technique allows for rendering millions of dynamic lights in real-time by resampling a set of "candidate" lights. 
                            Our implementation adapts this for Global Illumination (ReSTIR GI, Ouyang et al. 2021) to reuse indirect light paths.
                        </p>
                        <div className="flex gap-2">
                             <div className="px-2 py-1 bg-white/10 text-[10px] font-mono uppercase">Streaming RIS</div>
                             <div className="px-2 py-1 bg-white/10 text-[10px] font-mono uppercase">Weighted Reservoir</div>
                             <div className="px-2 py-1 bg-white/10 text-[10px] font-mono uppercase">Spatial Reuse</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 border border-white/10 bg-white/5">
                            <h4 className="font-bold text-sm mb-2">Temporal Reuse</h4>
                            <p className="text-xs text-gray-500">
                                We reproject the previous frame's reservoirs to the current frame. This effectively increases the sample count (M) per pixel over time, reducing noise.
                                <em>Challenge: Ghosting occurs if M is not clamped.</em>
                            </p>
                        </div>
                        <div className="p-4 border border-white/10 bg-white/5">
                            <h4 className="font-bold text-sm mb-2">Spatial Reuse</h4>
                            <p className="text-xs text-gray-500">
                                We select random neighbors and combine their reservoirs. This spreads high-contribution samples (bright spots) to neighbors, rapidly filling in the image.
                                <em>Challenge: Light leaking occurs if geometric edges are ignored.</em>
                            </p>
                        </div>
                    </div>

                    <div className="p-4 border border-acid/20 bg-acid/5">
                        <h4 className="font-bold text-sm mb-2 text-acid">Implementation Notes</h4>
                        <ul className="text-xs text-gray-400 space-y-2 font-mono">
                           <li>• Spatial Radius: 10px (Tightened to prevent bleeding)</li>
                           <li>• Max Temporal History: 12 Frames (Reduced ghosting)</li>
                           <li>• Denoising: Bilateral Filter (Edge-preserving blur)</li>
                           <li>• Bias: 0.05 Ray Offset (Prevents shadow acne)</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Shader Editor ---
interface ShaderEditorProps {
    isOpen: boolean;
    onClose: () => void;
    code: string;
    onCodeChange: (code: string) => void;
    error: ShaderError | null;
}

export const ShaderEditor: React.FC<ShaderEditorProps> = ({ isOpen, onClose, code, onCodeChange, error }) => {
    return (
        <div className={`fixed inset-y-0 left-0 w-[600px] bg-[#1e1e1e] shadow-2xl transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] z-40 flex flex-col border-r border-white/10 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="flex items-center justify-between p-4 bg-[#252526] border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <span className="font-mono text-xs text-gray-400 uppercase tracking-widest">constants.ts / WGSL</span>
                </div>
                <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            
            <div className="flex-1 relative">
                <Editor 
                    height="100%"
                    defaultLanguage="rust" // WGSL isn't standard in Monaco yet, Rust provides decent highlighting
                    theme="vs-dark"
                    value={code}
                    onChange={(value) => onCodeChange(value || '')}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 12,
                        fontFamily: 'JetBrains Mono',
                        padding: { top: 20 },
                        scrollBeyondLastLine: false,
                        smoothScrolling: true,
                    }}
                />
            </div>

            {error && (
                <div className="p-4 bg-red-900/20 border-t border-red-900/50">
                    <div className="text-red-500 font-mono text-xs flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        COMPILATION FAILED
                    </div>
                </div>
            )}
        </div>
    );
};

// --- Menu Bar ---
interface MenuBarProps {
    menus: MenuGroup[];
}

export const MenuBar: React.FC<MenuBarProps> = ({ menus }) => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null);

    // Click outside to close
    useEffect(() => {
        const handleClick = () => setActiveMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    return (
        <div className="fixed top-0 left-0 w-full h-10 bg-black/80 backdrop-blur-md border-b border-white/10 flex items-center px-4 z-50 select-none">
            <div className="font-bold tracking-tighter mr-6">ReSTIR <span className="text-acid">GI</span></div>
            
            <div className="flex h-full">
                {menus.map(group => (
                    <div key={group.label} className="relative h-full">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === group.label ? null : group.label); }}
                            className={`h-full px-4 text-xs font-mono uppercase tracking-wider hover:bg-white/10 transition-colors ${activeMenu === group.label ? 'bg-white/10 text-white' : 'text-gray-400'}`}
                        >
                            {group.label}
                        </button>
                        
                        {activeMenu === group.label && (
                            <div className="absolute top-full left-0 w-56 bg-[#1e1e1e] border border-white/10 shadow-xl py-2 flex flex-col animate-fade-in-up origin-top-left">
                                {group.items.map((item, i) => (
                                    <button 
                                        key={i}
                                        onClick={(e) => { e.stopPropagation(); item.action(); setActiveMenu(null); }}
                                        className="w-full text-left px-4 py-2 hover:bg-white/10 flex justify-between items-center group"
                                    >
                                        <span className="text-sm text-gray-300 group-hover:text-white">{item.label}</span>
                                        {item.shortcut && <span className="text-[10px] font-mono text-gray-600 group-hover:text-acid">{item.shortcut}</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>

             {/* Accumulation Indicator (Right Side) */}
            <div className="ml-auto flex items-center gap-4">
                 <div className="hidden md:flex items-center gap-2">
                    <div className="flex gap-0.5">
                         {[...Array(5)].map((_, i) => (
                             <div key={i} className={`w-0.5 h-3 bg-acid ${i < 3 ? 'opacity-100' : 'opacity-20 animate-pulse'}`}></div>
                         ))}
                    </div>
                    <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Denoising Active</span>
                 </div>
            </div>
        </div>
    );
};
