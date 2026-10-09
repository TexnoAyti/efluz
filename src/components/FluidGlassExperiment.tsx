import React, { useState, Suspense, lazy } from 'react';
import { Sparkles, Eye, EyeOff, Layers, AlertCircle, Loader2 } from 'lucide-react';

const LazyFluidGlass = lazy(() => import('./FluidGlass'));

interface ErrorBoundaryProps {
  children: React.ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class WebGLErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>WebGL experimental context unavailable or model failed to load.</span>
        </div>
      );
    }
    return this.props.children;
  }
}

export const FluidGlassExperiment: React.FC = () => {
  const [experimentMode, setExperimentMode] = useState<'off' | 'lens' | 'bar'>('off');

  return (
    <div className="p-4 sm:p-5 rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-black text-[var(--efl-text)] uppercase tracking-wider">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          <span>Fluid Glass Experiment (React Bits 3D)</span>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
            Admin Lab
          </span>
        </div>

        {/* Experiment Mode Switcher: Off | Lens | Bar */}
        <div className="flex items-center gap-1 bg-[var(--efl-surface)] p-1 rounded-xl border border-[var(--efl-border)] self-start sm:self-auto shadow-xs">
          <button
            type="button"
            onClick={() => setExperimentMode('off')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              experimentMode === 'off'
                ? 'bg-[var(--efl-primary-soft)] text-[var(--efl-primary)] font-black'
                : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
            }`}
          >
            <EyeOff className="w-3 h-3" />
            <span>Off</span>
          </button>
          <button
            type="button"
            onClick={() => setExperimentMode('lens')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              experimentMode === 'lens'
                ? 'bg-indigo-600 text-white shadow-xs font-black'
                : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
            }`}
          >
            <Eye className="w-3 h-3" />
            <span>Lens</span>
          </button>
          <button
            type="button"
            onClick={() => setExperimentMode('bar')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              experimentMode === 'bar'
                ? 'bg-indigo-600 text-white shadow-xs font-black'
                : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>Bar</span>
          </button>
        </div>
      </div>

      <p className="text-[11px] text-[var(--efl-text-2)] leading-relaxed">
        Experimental optical refraction engine powered by Three.js & GLTF models (<code className="font-mono text-[10px]">lens.glb</code>, <code className="font-mono text-[10px]">bar.glb</code>). Default bottom navigation uses <strong>GlassSurface</strong> (SVG/CSS displacement) for 60fps mobile Telegram performance.
      </p>

      {/* Render Canvas ONLY when enabled */}
      {experimentMode !== 'off' && (
        <div className="relative rounded-2xl overflow-hidden border border-[var(--efl-border)] bg-[#070b14] h-72 shadow-inner">
          <WebGLErrorBoundary>
            <Suspense
              fallback={
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                  <span className="text-xs font-semibold">Loading 3D Refraction Engine...</span>
                </div>
              }
            >
              <LazyFluidGlass
                mode={experimentMode === 'bar' ? 'bar' : 'lens'}
                lensProps={{
                  scale: 0.25,
                  ior: 1.15,
                  thickness: 5,
                  chromaticAberration: 0.1,
                  anisotropy: 0.01,
                }}
                barProps={{
                  navItems: [
                    { label: 'Home', link: '#home' },
                    { label: 'Leagues', link: '#leagues' },
                    { label: 'Club', link: '#club' },
                  ],
                  scale: 0.16,
                  ior: 1.2,
                  thickness: 8,
                }}
                backgroundColor="#0a0f1d"
                textColor="#f8fafc"
              />
            </Suspense>
          </WebGLErrorBoundary>
          <div className="absolute top-2 left-3 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-bold text-white border border-white/10 pointer-events-none">
            {experimentMode === 'lens' ? 'Refractive Lens (Pointer tracked)' : 'Fluid Glass Bar (3-tab mockup)'}
          </div>
        </div>
      )}
    </div>
  );
};
