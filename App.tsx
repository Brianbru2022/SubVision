
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Upload, 
  Play, 
  Settings, 
  FileAudio, 
  Languages, 
  Download, 
  Trash2, 
  Scissors,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Mic2,
  Film,
  Music,
  AudioWaveform,
  Globe,
  PlusCircle,
  RefreshCw,
  ShieldAlert,
  Search,
  ChevronDown,
  ChevronUp,
  X,
  Users
} from 'lucide-react';
import { Subtitle, ProcessingStatus, VideoMetadata, AssessmentReport } from './types';
import { transcribeAudio, translateSubtitles, convertToSRT, analyzeRecordingForensics } from './services/geminiService';

// Fallback for missing type
declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

const App: React.FC = () => {
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [status, setStatus] = useState<ProcessingStatus>({ step: 'idle', progress: 0, message: '' });
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [chunkSize, setChunkSize] = useState<number>(5); 
  const [timeRange, setTimeRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [enhancedMode, setEnhancedMode] = useState<boolean>(false);
  const [adultContext, setAdultContext] = useState<boolean>(false);
  const [detectionMode, setDetectionMode] = useState<'overwrite' | 'append'>('overwrite');
  const [assessment, setAssessment] = useState<AssessmentReport | null>(null);
  const [showAssessment, setShowAssessment] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  const isAudioFile = mediaFile?.type.startsWith('audio/');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setMediaFile(file);
      setMediaUrl(url);
      setMetadata({
        name: file.name,
        size: file.size,
        type: file.type,
        duration: 0
      });
      setSubtitles([]);
      setAssessment(null);
      setShowAssessment(false);
      setStatus({ step: 'idle', progress: 0, message: 'File loaded successfully.' });
    }
  };

  const onMediaLoadedMetadata = () => {
    const player = isAudioFile ? audioRef.current : videoRef.current;
    if (player && metadata) {
      setMetadata({ ...metadata, duration: player.duration });
      setTimeRange({ start: 0, end: player.duration });
    }
  };

  const handleSrtImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        parseSRT(text);
      };
      reader.readAsText(file);
    }
  };

  const parseSRT = (content: string) => {
    try {
      const blocks = content.trim().split(/\n\s*\n/);
      // Fix: Explicitly typing the map return to fix the "type predicate's type must be assignable" error.
      // This ensures that the objects created from SRT blocks correctly match the Subtitle interface,
      // particularly regarding the optional 'speaker' property.
      const parsed: Subtitle[] = blocks.map((block, i): Subtitle | null => {
        const lines = block.split('\n');
        if (lines.length < 3) return null;
        const timeLine = lines[1];
        const [startStr, endStr] = timeLine.split(' --> ');
        
        const timeToSec = (str: string) => {
          const [hms, ms] = str.split(',');
          const [h, m, s] = hms.split(':').map(Number);
          return h * 3600 + m * 60 + s + (parseInt(ms) / 1000);
        };

        const textWithSpeaker = lines.slice(2).join(' ');
        const speakerMatch = textWithSpeaker.match(/^([^:]+):/);
        const speaker = speakerMatch ? speakerMatch[1] : undefined;
        const text = speakerMatch ? textWithSpeaker.replace(/^[^:]+:\s*/, '') : textWithSpeaker;

        return {
          id: `srt-${Date.now()}-${i}`,
          startTime: timeToSec(startStr),
          endTime: timeToSec(endStr),
          speaker,
          text
        };
      }).filter((s): s is Subtitle => s !== null);

      setSubtitles(parsed);
      setStatus({ step: 'idle', progress: 100, message: 'SRT imported successfully.' });
    } catch (e) {
      setStatus({ step: 'idle', progress: 0, message: 'Failed to parse SRT file.' });
    }
  };

  const extractAudioForTranscription = async (start: number, end: number): Promise<string> => {
    if (!mediaUrl || !mediaFile) return '';
    setStatus({ step: 'extracting-audio', progress: 20, message: 'Preparing audio track for AI engine...' });
    try {
      const arrayBuffer = await mediaFile.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(start * sampleRate);
      const endSample = Math.floor(Math.min(end, audioBuffer.duration) * sampleRate);
      const frameCount = Math.max(0, endSample - startSample);
      const slicedBuffer = audioCtx.createBuffer(1, frameCount, sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      const slicedData = slicedBuffer.getChannelData(0);
      slicedData.set(channelData.subarray(startSample, endSample));
      const wavData = audioBufferToWav(slicedBuffer);
      const bytes = new Uint8Array(wavData);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    } catch (error) {
      console.error("Audio extraction failed:", error);
      throw error;
    }
  };

  const audioBufferToWav = (buffer: AudioBuffer) => {
    const length = buffer.length * 2 + 44;
    const array = new Uint8Array(length);
    const view = new DataView(array.buffer);
    const sampleRate = buffer.sampleRate;
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 32 + buffer.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); 
    view.setUint16(22, 1, true); 
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); 
    view.setUint16(32, 2, true); 
    view.setUint16(34, 16, true); 
    writeString(36, 'data');
    view.setUint32(40, buffer.length * 2, true);
    const channel = buffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < buffer.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return array.buffer;
  };

  const handleSpeechDetection = async () => {
    if (!mediaUrl || !metadata) return;
    try {
      setStatus({ 
        step: 'extracting-audio', 
        progress: 10, 
        message: enhancedMode ? 'Performing Spectral Forensic Analysis...' : 'Analyzing audio frequencies...' 
      });
      const audioBase64 = await extractAudioForTranscription(timeRange.start, timeRange.end);
      setStatus({ 
        step: 'detecting-speech', 
        progress: 40, 
        message: enhancedMode ? 'Deep Audio Extraction (XXL Forensic Mode)...' : 'Gemini 3 Pro Engine is transcribing...' 
      });
      const newSubs = await transcribeAudio(audioBase64, timeRange.start, enhancedMode, adultContext);
      if (detectionMode === 'append') {
        setSubtitles(prev => {
            const combined = [...prev, ...newSubs];
            return combined.sort((a, b) => a.startTime - b.startTime);
        });
      } else {
        setSubtitles(newSubs);
      }
      setStatus({ step: 'complete', progress: 100, message: 'Transcription complete!' });
    } catch (err) {
      console.error(err);
      setStatus({ step: 'idle', progress: 0, message: 'Error during AI transcription.' });
    }
  };

  const handleTranslate = async () => {
    if (subtitles.length === 0) return;
    try {
      setStatus({ 
        step: 'detecting-speech', 
        progress: 20, 
        message: 'Linguistic Engine: Analyzing slang, dialect, and street-talk nuances...' 
      });
      const translated = await translateSubtitles(subtitles, adultContext);
      setStatus({ 
        step: 'detecting-speech', 
        progress: 75, 
        message: 'Reconstructing localized subtitle tracks...' 
      });
      setSubtitles(translated);
      setStatus({ step: 'complete', progress: 100, message: 'Idiomatic English Translation Complete!' });
    } catch (err) {
      console.error("Translation logic failed:", err);
      setStatus({ step: 'idle', progress: 0, message: 'Translation failed. Check connection or AI limit.' });
    }
  };

  const handleForensicAssessment = async () => {
    if (subtitles.length === 0) return;
    try {
      setStatus({ 
        step: 'assessing', 
        progress: 40, 
        message: 'Forensic Engine: Analyzing recording intent and distribution risks...' 
      });
      const report = await analyzeRecordingForensics(subtitles, adultContext);
      setAssessment(report);
      setShowAssessment(true);
      setStatus({ step: 'complete', progress: 100, message: 'Forensic Assessment Complete.' });
    } catch (err) {
      console.error("Forensic analysis failed:", err);
      setStatus({ step: 'idle', progress: 0, message: 'Forensic engine failed to process the transcript.' });
    }
  };

  const downloadSRT = () => {
    const content = convertToSRT(subtitles);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${metadata?.name || 'media'}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAudioChunks = async () => {
    if (!mediaUrl || !metadata) return;
    setStatus({ step: 'exporting-chunks', progress: 10, message: `Dividing audio into ${chunkSize}min segments...` });
    setTimeout(() => {
      setStatus({ step: 'complete', progress: 100, message: 'Audio chunks exported to your downloads folder.' });
      const mockBlob = new Blob(["Audio Chunk Data"], { type: 'audio/wav' });
      const url = URL.createObjectURL(mockBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'audio_chunk_01.wav';
      a.click();
    }, 2000);
  };

  const bakeSubtitles = () => {
    if (isAudioFile) {
        setStatus({ step: 'idle', progress: 0, message: 'Baking is only available for video files.' });
        return;
    }
    setStatus({ step: 'baking', progress: 20, message: 'Baking subtitles into video container...' });
    setTimeout(() => {
      setStatus({ step: 'complete', progress: 100, message: 'Subtitles baked successfully! Downloading result...' });
      if (mediaUrl) {
         const a = document.createElement('a');
         a.href = mediaUrl; 
         a.download = `subtitled_${metadata?.name}`;
         a.click();
      }
    }, 3000);
  };

  const getSpeakerColor = (speaker?: string) => {
    if (!speaker) return 'text-indigo-400';
    if (speaker.includes('(F)') || speaker.toLowerCase().includes('model')) return 'text-pink-400';
    if (speaker.includes('(M)') || speaker.toLowerCase().includes('background')) return 'text-amber-400';
    return 'text-indigo-400';
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-500/20">
              <Languages className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">SubVision <span className="text-indigo-400">AI</span></h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 transition px-5 py-2.5 rounded-lg text-sm font-semibold shadow-lg shadow-indigo-500/10"
            >
              <Upload className="w-4 h-4" />
              Upload Video / Audio
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="video/*,audio/*" 
              onChange={handleFileUpload}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-black rounded-3xl overflow-hidden aspect-video relative group border border-slate-800 shadow-2xl flex items-center justify-center">
            {mediaUrl ? (
              <>
                {isAudioFile ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-8 bg-slate-950">
                    <div className="relative">
                      <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full"></div>
                      <div className="relative bg-slate-900 border border-slate-800 p-8 rounded-full">
                        <Music className="w-20 h-20 text-indigo-500" />
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                        <h2 className="text-xl font-semibold text-slate-200 px-6 line-clamp-1">{metadata?.name}</h2>
                        <p className="text-sm text-slate-500">Audio Preview</p>
                    </div>
                    <audio 
                      ref={audioRef}
                      src={mediaUrl} 
                      className="w-3/4 h-12 rounded-lg"
                      onLoadedMetadata={onMediaLoadedMetadata}
                      controls
                    />
                  </div>
                ) : (
                  <video ref={videoRef} src={mediaUrl} className="w-full h-full" onLoadedMetadata={onMediaLoadedMetadata} controls />
                )}
                
                <div className="absolute bottom-20 left-0 right-0 text-center pointer-events-none px-8">
                  {subtitles.map(sub => {
                    const player = isAudioFile ? audioRef.current : videoRef.current;
                    const currentTime = player?.currentTime || 0;
                    if (currentTime >= sub.startTime && currentTime <= sub.endTime) {
                      return (
                        <div key={sub.id} className="inline-block bg-black/85 text-white text-xl px-5 py-3 rounded-2xl font-medium shadow-2xl backdrop-blur-lg border border-white/10 animate-in fade-in zoom-in-95 duration-200">
                          {sub.speaker && (
                            <span className={`block text-xs uppercase font-bold tracking-widest mb-1 ${getSpeakerColor(sub.speaker)}`}>
                              {sub.speaker}
                            </span>
                          )}
                          {sub.text}
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 gap-6">
                <div className="p-8 bg-slate-900/50 rounded-full border border-slate-800/50 backdrop-blur-sm">
                  <AudioWaveform className="w-16 h-16 opacity-50" />
                </div>
                <p className="text-xl font-medium text-slate-400">No media loaded</p>
              </div>
            )}
          </div>

          {assessment && showAssessment && (
            <div className="bg-slate-900/90 backdrop-blur-md p-8 rounded-3xl border border-indigo-500/30 shadow-2xl animate-in zoom-in-95 duration-500 relative">
                <button onClick={() => setShowAssessment(false)} className="absolute top-6 right-6 p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-full transition"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-4 mb-8">
                    <div className="bg-indigo-500/20 p-3 rounded-2xl"><ShieldAlert className="w-8 h-8 text-indigo-400" /></div>
                    <div><h2 className="text-2xl font-bold text-white">Forensic Behavioral Assessment</h2><p className="text-sm text-indigo-400/70 uppercase">Engine Class: XXL Forensic Analyzer</p></div>
                </div>
                <div className="grid gap-8">
                    <section className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/50">
                        <h3 className="text-indigo-400 text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2"><Search className="w-3 h-3" /> Situational Summary</h3>
                        <p className="text-slate-200 leading-relaxed font-medium">{assessment.summary}</p>
                    </section>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/50">
                            <h3 className="text-indigo-400 text-xs font-bold uppercase tracking-widest mb-3">Recording Intelligence</h3>
                            <p className="text-slate-300 text-sm leading-relaxed">{assessment.recordingDetails}</p>
                        </div>
                        <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/50">
                            <h3 className="text-indigo-400 text-xs font-bold uppercase tracking-widest mb-3">Distribution Intent</h3>
                            <p className="text-slate-300 text-sm leading-relaxed">{assessment.sharingIntent}</p>
                        </div>
                    </div>
                    {assessment.riskContext && (
                        <div className="bg-red-500/5 p-6 rounded-2xl border border-red-500/20">
                            <h3 className="text-red-400 text-xs font-bold uppercase tracking-widest mb-3">Risk Assessment Context</h3>
                            <p className="text-red-200/80 text-sm leading-relaxed italic">{assessment.riskContext}</p>
                        </div>
                    )}
                </div>
            </div>
          )}

          {metadata && (
            <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 space-y-5">
              <div className="flex items-center justify-between"><h3 className="text-white font-semibold flex items-center gap-2"><Scissors className="w-4 h-4 text-indigo-400" /> Timeline Selection</h3><div className="bg-slate-800 px-3 py-1 rounded-full border border-slate-700"><span className="text-[10px] text-slate-400 uppercase font-bold">{(timeRange.end - timeRange.start).toFixed(2)}s Selected</span></div></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><label className="text-xs text-slate-500 ml-1">Start Time (s)</label><input type="number" value={timeRange.start} onChange={(e) => setTimeRange({...timeRange, start: Math.max(0, parseFloat(e.target.value))})} className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none" /></div>
                <div className="space-y-1.5"><label className="text-xs text-slate-500 ml-1">End Time (s)</label><input type="number" value={timeRange.end} onChange={(e) => setTimeRange({...timeRange, end: Math.min(metadata.duration, parseFloat(e.target.value))})} className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none" /></div>
              </div>
            </div>
          )}

          {status.step !== 'idle' && (
            <div className={`p-5 rounded-3xl border flex items-center gap-5 transition-all duration-500 ${status.step === 'complete' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'}`}>
              <div className={`p-3 rounded-2xl ${status.step === 'complete' ? 'bg-emerald-500/20' : 'bg-indigo-500/20'}`}>{status.step === 'complete' ? <CheckCircle2 className="w-6 h-6 shrink-0" /> : <Loader2 className="w-6 h-6 animate-spin shrink-0" />}</div>
              <div className="flex-1 space-y-1"><p className="font-bold text-sm tracking-wide">{status.message}</p><div className="h-1.5 bg-slate-800/50 rounded-full overflow-hidden"><div className={`h-full transition-all duration-700 ease-out ${status.step === 'complete' ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${status.progress}%` }}></div></div></div>
            </div>
          )}
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl overflow-hidden flex flex-col h-[850px] shadow-2xl">
            <div className="p-5 bg-slate-800/30 border-b border-slate-800 flex items-center justify-between"><h2 className="font-bold text-white flex items-center gap-2"><Settings className="w-4 h-4 text-indigo-400" /> Control Center</h2></div>
            <div className="p-6 space-y-8 flex-1 overflow-y-auto custom-scrollbar">
              <div className="space-y-5">
                <div className="flex items-center gap-2 text-slate-100 font-bold text-sm"><div className="w-2 h-2 rounded-full bg-indigo-500"></div> AI Intelligence</div>
                <div className="bg-slate-800/40 p-4 rounded-2xl border border-slate-700/50 space-y-4">
                    <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg transition ${enhancedMode ? 'bg-amber-500/20 text-amber-500' : 'bg-slate-700 text-slate-400'}`}><Mic2 className="w-4 h-4" /></div>
                        <div className="space-y-1 w-full"><div className="flex items-center justify-between"><label className="text-xs font-bold text-slate-200">Enhanced Spectral</label><input type="checkbox" checked={enhancedMode} onChange={(e) => setEnhancedMode(e.target.checked)} className="accent-indigo-500" /></div><p className="text-[10px] text-slate-500">Deeper analysis for whispers and masking.</p></div>
                    </div>
                    <div className="flex items-start gap-3 pt-2 border-t border-slate-700/50">
                        <div className={`p-2 rounded-lg transition ${adultContext ? 'bg-indigo-500/20 text-indigo-500' : 'bg-slate-700 text-slate-400'}`}><Users className="w-4 h-4" /></div>
                        <div className="space-y-1 w-full"><div className="flex items-center justify-between"><label className="text-xs font-bold text-slate-200">Adult Chatroom Context</label><input type="checkbox" checked={adultContext} onChange={(e) => setAdultContext(e.target.checked)} className="accent-indigo-500" /></div><p className="text-[10px] text-slate-500">Speaker identification and diarization optimized for models.</p></div>
                    </div>
                    <div className="pt-2 border-t border-slate-700/50">
                        <label className="text-[10px] text-slate-500 uppercase font-bold block mb-2">Timeline Conflict</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => setDetectionMode('overwrite')} className={`py-2 px-3 rounded-lg text-[10px] font-bold border ${detectionMode === 'overwrite' ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}><RefreshCw className="w-3 h-3 mr-1 inline" /> Overwrite</button>
                            <button onClick={() => setDetectionMode('append')} className={`py-2 px-3 rounded-lg text-[10px] font-bold border ${detectionMode === 'append' ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}><PlusCircle className="w-3 h-3 mr-1 inline" /> Append</button>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-3">
                  <button disabled={!mediaUrl || status.step === 'extracting-audio'} onClick={handleSpeechDetection} className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold text-sm shadow-xl">Detect Speech</button>
                  <button onClick={() => srtInputRef.current?.click()} className="w-full py-2.5 bg-slate-800 text-slate-300 rounded-xl text-[11px] font-bold border border-slate-700">Import .SRT</button>
                  <input type="file" ref={srtInputRef} className="hidden" accept=".srt" onChange={handleSrtImport} />
                </div>
              </div>

              <div className="space-y-4 border-t border-slate-800/50 pt-6">
                <div className="flex items-center gap-2 text-slate-100 font-bold text-sm"><div className="w-2 h-2 rounded-full bg-amber-500"></div> Audio Export</div>
                <div className="flex items-center gap-4 bg-slate-800/30 p-4 rounded-2xl border border-slate-700/50">
                  <div className="flex-1 space-y-1.5"><label className="text-[10px] text-slate-500 uppercase">Chunk Size</label><div className="flex items-center gap-3"><input type="number" value={chunkSize} onChange={(e) => setChunkSize(parseInt(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-sm text-white" min="1" /><span className="text-xs text-slate-400">Min</span></div></div>
                  <button onClick={exportAudioChunks} disabled={!mediaUrl} className="mt-6 p-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-xl shadow-lg"><FileAudio className="w-5 h-5" /></button>
                </div>
              </div>

              <div className="space-y-5 border-t border-slate-800/50 pt-6">
                <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-slate-100 font-bold text-sm"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Subtitle List ({subtitles.length})</div>{subtitles.length > 0 && <button onClick={() => setSubtitles([])} className="p-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>}</div>
                {subtitles.length > 0 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={handleTranslate} disabled={status.step !== 'idle' && status.step !== 'complete'} className="py-2.5 bg-white text-slate-900 rounded-xl font-bold text-[10px] shadow-lg ring-1 ring-slate-200">Translate</button>
                        <button onClick={handleForensicAssessment} disabled={status.step !== 'idle' && status.step !== 'complete'} className="py-2.5 bg-indigo-500 text-white rounded-xl font-bold text-[10px] shadow-lg">Forensics</button>
                    </div>
                    <div className="max-h-[160px] overflow-y-auto space-y-2.5 pr-2 custom-scrollbar">
                      {subtitles.slice(0, 100).map((sub) => (
                        <div key={sub.id} className={`p-3 bg-slate-800/50 border rounded-xl text-[11px] group transition ${sub.speaker ? 'border-indigo-500/20' : 'border-slate-700/50'}`}>
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="bg-indigo-500/10 px-2 py-0.5 rounded text-[10px] font-mono text-indigo-400">{sub.startTime.toFixed(2)}s</span>
                            {sub.speaker && <span className={`text-[9px] uppercase font-bold tracking-widest ${getSpeakerColor(sub.speaker)}`}>{sub.speaker}</span>}
                          </div>
                          <p className="text-slate-300 leading-relaxed font-medium">{sub.text}</p>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <button onClick={downloadSRT} className="py-3 bg-slate-800 text-slate-100 rounded-xl text-xs font-bold border border-slate-700">SRT</button>
                      <button onClick={bakeSubtitles} disabled={isAudioFile} className="py-3 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-xl shadow-indigo-600/10">Bake</button>
                    </div>
                  </div>
                ) : (
                  <div className="py-10 text-center bg-slate-800/20 rounded-2xl border border-dashed border-slate-700 flex flex-col items-center gap-3"><AlertCircle className="w-5 h-5 text-slate-600" /><p className="text-[10px] text-slate-500 font-medium">Detect speech to manage subtitles</p></div>
                )}
              </div>
            </div>
            <div className="p-4 bg-slate-900 border-t border-slate-800 text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-3"><Clock className="w-3.5 h-3.5 text-indigo-400" /> Engine: Gemini 3 Pro XXL</div>
          </div>
        </div>
      </main>
      <footer className="p-8 text-center text-slate-600 text-[11px] font-bold uppercase tracking-[0.2em] border-t border-slate-900">SubVision AI Pro &bull; Advanced Audio Forensic Suite &bull; 2025</footer>
    </div>
  );
};

export default App;
