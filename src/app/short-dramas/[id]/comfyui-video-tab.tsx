'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { COMFYUI_SIZE_PRESETS, getComfyUISize } from '@/lib/comfyui-presets';

interface ComfyUIVideoTabProps {
  drama: any;
  dramaId: string;
  selectedEpisode: any;
  onSelectEpisode: (ep: any) => void;
  shots: any[];
  shotsLoading: boolean;
  getToken: () => string;
  onRefreshShots: () => void;
  prefillShot?: any | null;
  onSaveToShot?: (shotId: string, videoUrl: string, videoDownloadUrl: string) => Promise<void>;
  onClearPrefill?: () => void;
}

type RefImage = { id: string; data: string; name: string };
type RefAudio = { id: string; data: string; name: string };

interface ComfyUIVideoRecord {
  id: string;
  prompt: string;
  thumbnail?: string;       // 首张参考图或缩略图
  videoUrl: string;         // data URL (base64) 或原始URL
  videoDownloadUrl: string; // ComfyUI 原始下载 URL
  filename: string;
  mimeType: string;
  params: {
    aspectRatio: string;
    sizePresetIdx: number;
    duration: number;
    seed?: number;
    refImageCount: number;
    refAudioCount: number;
  };
  createdAt: number;
}

const IMAGE_SLOTS = 9;
const AUDIO_SLOTS = 3;

export default function ComfyUIVideoTab({
  drama, dramaId, selectedEpisode, onSelectEpisode,
  shots, shotsLoading, getToken, onRefreshShots,
  prefillShot, onSaveToShot, onClearPrefill,
}: ComfyUIVideoTabProps) {
  
  // ── Server config ──
  const [serverUrl, setServerUrl] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('comfyui-server-url') || '' : ''
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>('');

  // ── Generation params ──
  const [prompt, setPrompt] = useState('');
  const [sizePresetIdx, setSizePresetIdx] = useState(2); // 0.4MP default
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [duration, setDuration] = useState(10);
  const [seed, setSeed] = useState<number | undefined>();
  
  // ── Workflow selection ──
  const [workflows, setWorkflows] = useState<Array<{id: string; name: string; modelType?: string; isDefault?: boolean}>>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);

  // ── References ──
  const [refImages, setRefImages] = useState<RefImage[]>([]);
  const [refAudios, setRefAudios] = useState<RefAudio[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // ── Generation state ──
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState('');
  const [genResult, setGenResult] = useState<any>(null);
  const [genError, setGenError] = useState('');

  // ── Video Library ──
  const VIDEO_HISTORY_KEY = 'comfyui-video-history';
  const [videoHistory, setVideoHistory] = useState<ComfyUIVideoRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(VIDEO_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [showLibrary, setShowLibrary] = useState(false);
  const [playingRecord, setPlayingRecord] = useState<ComfyUIVideoRecord | null>(null);

  // ── Persist history helper ──
  const persistHistory = (records: ComfyUIVideoRecord[]) => {
    setVideoHistory(records);
    if (typeof window !== 'undefined') {
      try {
        // 限制历史记录数量（最多50条）和总大小
        const trimmed = records.slice(0, 50);
        // 估算大小，如果超过 4MB 就截断旧记录
        const serialized = JSON.stringify(trimmed);
        if (serialized.length > 4 * 1024 * 1024) {
          trimmed.length = Math.max(5, Math.floor(trimmed.length * 0.5));
        }
        localStorage.setItem(VIDEO_HISTORY_KEY, JSON.stringify(trimmed));
      } catch (e) {
        console.warn('[ComfyUI] 保存历史失败:', e);
        // localStorage 可能满了，清除最旧的记录重试
        try {
          const trimmed = records.slice(0, 10);
          localStorage.setItem(VIDEO_HISTORY_KEY, JSON.stringify(trimmed));
          setVideoHistory(trimmed);
        } catch {}
      }
    }
  };

  // ── Save server URL ──
  const saveServerUrl = (url: string) => {
    setServerUrl(url);
    if (typeof window !== 'undefined') {
      localStorage.setItem('comfyui-server-url', url);
    }
  };

  // ── Test connection ──
  const testConnection = async () => {
    if (!serverUrl) { setTestResult('请先填写服务器地址'); return; }
    setTesting(true);
    setTestResult('');
    try {
      const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/system_stats`);
      if (res.ok) {
        const data = await res.json();
        setTestResult(`✅ 连接成功！GPU: ${data.devices?.[0]?.name || 'N/A'} · ${data.devices?.[0]?.vram_total ? (data.devices[0].vram_total / 1024 / 1024 / 1024).toFixed(1) + 'GB VRAM' : ''}`);
      } else {
        setTestResult(`❌ 连接失败 (HTTP ${res.status})`);
      }
    } catch (e: any) {
      setTestResult(`❌ 无法连接: ${e.message}`);
    }
    setTesting(false);
  };

  // ── Load workflows from API ──
  const loadWorkflows = async () => {
    setWorkflowsLoading(true);
    try {
      const res = await fetch('/api/comfyui/workflows?active=true');
      if (res.ok) {
        const data = await res.json();
        const list = data.data || data.workflows || [];
        setWorkflows(list);
        // Auto-select default workflow or first one
        const defaultWf = list.find((w: any) => w.isDefault) || list[0];
        if (defaultWf && !selectedWorkflowId) {
          setSelectedWorkflowId(defaultWf.id);
        }
      }
    } catch (e) {
      console.warn('[ComfyUI] 加载工作流失败:', e);
    } finally {
      setWorkflowsLoading(false);
    }
  };

  // Load workflows on mount
  useEffect(() => {
    loadWorkflows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Image upload handler ──
  const handleImageUpload = async (files: FileList | null) => {
    if (!files) return;
    const slotsAvailable = IMAGE_SLOTS - refImages.length;
    const filesToProcess = Array.from(files).slice(0, slotsAvailable);
    
    const newImages: RefImage[] = [];
    for (const file of filesToProcess) {
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await readFileAsDataURL(file);
      newImages.push({
        id: Math.random().toString(36).slice(2),
        data: dataUrl,
        name: file.name,
      });
    }
    setRefImages(prev => [...prev, ...newImages]);
  };

  // ── Audio upload handler ──
  const handleAudioUpload = async (files: FileList | null) => {
    if (!files) return;
    const slotsAvailable = AUDIO_SLOTS - refAudios.length;
    const filesToProcess = Array.from(files).slice(0, slotsAvailable);
    
    const newAudios: RefAudio[] = [];
    for (const file of filesToProcess) {
      if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|mp4)$/i.test(file.name)) continue;
      const dataUrl = await readFileAsDataURL(file);
      newAudios.push({
        id: Math.random().toString(36).slice(2),
        data: dataUrl,
        name: file.name,
      });
    }
    setRefAudios(prev => [...prev, ...newAudios]);
  };

  const removeImage = (id: string) => setRefImages(prev => prev.filter(i => i.id !== id));
  const removeAudio = (id: string) => setRefAudios(prev => prev.filter(i => i.id !== id));

  // ── Generate ──
  const handleGenerate = async () => {
    if (!serverUrl) { setGenError('请先填写 ComfyUI 服务器地址'); return; }
    if (!prompt.trim()) { setGenError('请输入提示词'); return; }
    
    setGenerating(true);
    setGenError('');
    setGenResult(null);
    setGenProgress('正在提交任务到 ComfyUI...');

    try {
      const res = await fetch('/api/comfyui/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          serverUrl,
          prompt: prompt.trim(),
          aspectRatio,
          sizePresetIndex: sizePresetIdx,
          duration,
          seed: seed ?? undefined,
          referenceImages: refImages.map(i => i.data),
          referenceAudios: refAudios.map(a => a.data),
          workflowId: selectedWorkflowId || undefined,
          pollInterval: 3000,
          maxPolls: 120,
        }),
      });

      setGenProgress('正在生成视频（轮询中）...');
      const data = await res.json();
      handleResponse(data);
    } catch (e: any) {
      setGenError(`生成失败: ${e.message}`);
    } finally {
      setGenerating(false);
      setGenProgress('');
    }
  };

  const handleResponse = (data: any) => {
    if (data.success) {
      const result = data.data;
      const newResult = {
        videoUrl: result.videoUrl,
        videoDownloadUrl: result.videoDownloadUrl,
        mimeType: result.mimeType,
        filename: result.filename,
        size: result.size,
      };
      setGenResult(newResult);
      setGenProgress('✅ 生成完成！');

      // 保存到历史记录
      const thumbData = refImages[0]?.data?.startsWith('data:')
        ? refImages[0].data.slice(0, 50000) // 截断缩略图避免过大
        : refImages[0]?.data || '';
      const record: ComfyUIVideoRecord = {
        id: Math.random().toString(36).slice(2) + Date.now().toString(36),
        prompt: prompt.trim().slice(0, 500),
        thumbnail: thumbData,
        videoUrl: result.videoUrl,
        videoDownloadUrl: result.videoDownloadUrl,
        filename: result.filename,
        mimeType: result.mimeType,
        params: {
          aspectRatio,
          sizePresetIdx,
          duration,
          seed,
          refImageCount: refImages.length,
          refAudioCount: refAudios.length,
        },
        createdAt: Date.now(),
      };
      persistHistory([record, ...videoHistory]);
    } else {
      setGenError(data.error || '生成失败');
      setGenProgress('');
    }
  };

  // ── History actions ──
  const loadFromHistory = (record: ComfyUIVideoRecord) => {
    setPrompt(record.prompt);
    setAspectRatio(record.params.aspectRatio);
    setSizePresetIdx(record.params.sizePresetIdx);
    setDuration(record.params.duration);
    setSeed(record.params.seed);
    // 清空当前参考图/音频（历史不保存 base64 以节省空间）
    setRefImages([]);
    setRefAudios([]);
    // 播放该视频
    setPlayingRecord(record);
  };

  const deleteHistoryRecord = (id: string) => {
    if (!confirm('确定删除此记录？')) return;
    persistHistory(videoHistory.filter(r => r.id !== id));
    if (playingRecord?.id === id) setPlayingRecord(null);
  };

  const clearAllHistory = () => {
    if (!confirm('确定清空所有历史记录？此操作不可恢复！')) return;
    persistHistory([]);
    setPlayingRecord(null);
  };

  // ── Load prompt from shot ──
  const loadFromShot = (shot: any) => {
    let p = shot?.videoPrompt || '';
    try { const parsed = JSON.parse(p); if (parsed.prompt) p = parsed.prompt; } catch {}
    setPrompt(p);
    // Load reference images from shot
    const refs = shot?.referenceImages || [];
    if (Array.isArray(refs) && refs.length) {
      const imgs: RefImage[] = [];
      for (const r of refs.slice(0, IMAGE_SLOTS)) {
        if (typeof r === 'string' && r.startsWith('data:')) {
          imgs.push({ id: Math.random().toString(36).slice(2), data: r, name: 'ref.png' });
        } else if (typeof r === 'string' && r.startsWith('http')) {
          imgs.push({ id: Math.random().toString(36).slice(2), data: r, name: 'ref.png' });
        } else if (typeof r === 'object' && r?.url) {
          imgs.push({ id: Math.random().toString(36).slice(2), data: r.url, name: r.name || 'ref.png' });
        }
      }
      if (imgs.length) setRefImages(imgs);
    }
  };

  // ── Prefill from shot ──
  useEffect(() => {
    if (!prefillShot) return;
    // Prefill prompt
    let p = prefillShot?.videoPrompt || prefillShot?.prompt || '';
    try { const parsed = JSON.parse(p); if (parsed.prompt) p = parsed.prompt; } catch {}
    if (p) setPrompt(p);
    // Prefill reference images
    const refs = prefillShot?.referenceImages || [];
    if (Array.isArray(refs) && refs.length) {
      const imgs: RefImage[] = [];
      for (const r of refs.slice(0, IMAGE_SLOTS)) {
        if (typeof r === 'string' && r.startsWith('data:')) {
          imgs.push({ id: Math.random().toString(36).slice(2), data: r, name: 'ref.png' });
        } else if (typeof r === 'string' && r.startsWith('http')) {
          imgs.push({ id: Math.random().toString(36).slice(2), data: r, name: 'ref.png' });
        } else if (typeof r === 'object' && r?.url) {
          imgs.push({ id: Math.random().toString(36).slice(2), data: r.url, name: r.name || 'ref.png' });
        }
      }
      if (imgs.length) setRefImages(imgs);
    }
    // Prefill aspect ratio
    if (prefillShot?.videoAspect) {
      const ar = prefillShot.videoAspect;
      if (['16:9', '9:16', '1:1'].includes(ar)) setAspectRatio(ar);
    }
    // Auto-clear so it doesn't re-prefill on every render
    if (onClearPrefill) onClearPrefill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillShot]);

  const currentSize = getComfyUISize(aspectRatio, sizePresetIdx);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-600 flex items-center justify-center text-xl">🔮</div>
        <div>
          <h2 className="text-lg font-bold text-white">ComfyUI 视频生成</h2>
          <p className="text-xs text-gray-400">MiniMax H3 工作流 · 支持 9 参考图 + 3 参考音频 + 文字提示</p>
        </div>
      </div>

      {/* Server Config Card */}
      <div className="bg-slate-900/50 border border-fuchsia-500/20 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-fuchsia-300">🖥️ ComfyUI 服务器</span>
          {testResult && (
            <span className={`text-xs px-2 py-0.5 rounded ${testResult.startsWith('✅') ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
              {testResult}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={serverUrl}
            onChange={e => saveServerUrl(e.target.value)}
            placeholder="https://wlyjqdska7tvean3-8188.container.x-gpu.com"
            className="flex-1 text-sm bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-fuchsia-500/50"
          />
          <button
            onClick={testConnection}
            disabled={testing || !serverUrl}
            className="px-3 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 rounded-lg text-xs font-bold transition-colors"
          >
            {testing ? '测试中...' : '测试连接'}
          </button>
        </div>
      </div>

      {/* Workflow Selector */}
      <div className="bg-slate-900/50 border border-cyan-500/20 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-cyan-300">⚙️ 工作流插件</span>
          <button
            onClick={loadWorkflows}
            className="text-xs text-cyan-400 hover:text-cyan-300"
          >🔄 刷新</button>
        </div>
        {workflowsLoading ? (
          <div className="text-xs text-gray-500">加载中...</div>
        ) : workflows.length === 0 ? (
          <div className="text-xs text-gray-500">暂无工作流，请先在管理后台添加</div>
        ) : (
          <select
            value={selectedWorkflowId || ''}
            onChange={e => setSelectedWorkflowId(e.target.value || null)}
            className="w-full text-sm bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500/50"
          >
            <option value="">自动选择（使用默认）</option>
            {workflows.map(w => (
              <option key={w.id} value={w.id}>
                {w.name} {w.isDefault ? '⭐' : ''} {w.modelType ? `[${w.modelType}]` : ''}
              </option>
            ))}
          </select>
        )}
        {selectedWorkflowId && (
          <div className="text-xs text-cyan-400">
            已选: {workflows.find(w => w.id === selectedWorkflowId)?.name}
          </div>
        )}
      </div>

      {/* Main Config Grid */}
      <div className="grid grid-cols-12 gap-4">
        {/* Left Column: Prompt + References */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          {/* Prompt */}
          <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-300">📝 视频提示词</span>
              <div className="flex gap-2">
                {/* Load from shot */}
                {shots.length > 0 && (
                  <select
                    onChange={e => { if (e.target.value) loadFromShot(shots.find(s => s.id === e.target.value)); e.target.value = ''; }}
                    className="text-xs bg-slate-950 border border-white/10 rounded px-2 py-1 text-gray-400 focus:outline-none"
                  >
                    <option value="">从分镜加载...</option>
                    {shots.slice(0, 20).map(s => (
                      <option key={s.id} value={s.id}>#{s.shotNumber} {s.title || '镜头'}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="输入视频生成提示词...&#10;支持 @角色名 引用角色&#10;支持分镜式描述：【0-3秒】... 【4-8秒】..."
              rows={12}
              className="w-full text-sm bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-fuchsia-500/50 font-mono resize-none"
            />
            <div className="text-xs text-gray-500">{prompt.length} 字符</div>
          </div>

          {/* Reference Images (9 slots) */}
          <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-300">🖼️ 参考图 ({refImages.length}/{IMAGE_SLOTS})</span>
              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={refImages.length >= IMAGE_SLOTS}
                className="text-xs px-3 py-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-30 rounded font-medium transition-colors"
              >
                + 添加图片
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => { handleImageUpload(e.target.files); if (imageInputRef.current) imageInputRef.current.value = ''; }}
              />
            </div>
            {refImages.length === 0 ? (
              <div className="border-2 border-dashed border-white/10 rounded-lg p-8 text-center text-gray-500 text-sm">
                点击"添加图片"上传参考图（最多 {IMAGE_SLOTS} 张）
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2">
                {Array.from({ length: IMAGE_SLOTS }).map((_, idx) => {
                  const img = refImages[idx];
                  return (
                    <div key={idx} className="relative aspect-square group">
                      {img ? (
                        <>
                          <img src={img.data} alt={img.name} className="w-full h-full object-cover rounded-lg border border-fuchsia-500/30" />
                          <button
                            onClick={() => removeImage(img.id)}
                            className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 hover:bg-red-600 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                          >✕</button>
                          <div className="absolute bottom-0.5 left-0.5 text-[9px] bg-black/60 text-white px-1 rounded">
                            #{idx + 1}
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full rounded-lg border border-dashed border-white/10 bg-white/2 flex items-center justify-center text-gray-600 text-xs">
                          {idx + 1}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Reference Audios (3 slots) */}
          <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-300">🎵 参考音频 ({refAudios.length}/{AUDIO_SLOTS})</span>
              <button
                onClick={() => audioInputRef.current?.click()}
                disabled={refAudios.length >= AUDIO_SLOTS}
                className="text-xs px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-30 rounded font-medium transition-colors"
              >
                + 添加音频
              </button>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={e => { handleAudioUpload(e.target.files); if (audioInputRef.current) audioInputRef.current.value = ''; }}
              />
            </div>
            {refAudios.length === 0 ? (
              <div className="border-2 border-dashed border-white/10 rounded-lg p-4 text-center text-gray-500 text-sm">
                可选：添加参考音频/音效（最多 {AUDIO_SLOTS} 个）
              </div>
            ) : (
              <div className="space-y-2">
                {Array.from({ length: AUDIO_SLOTS }).map((_, idx) => {
                  const audio = refAudios[idx];
                  return (
                    <div key={idx} className="flex items-center gap-2 bg-slate-950/50 rounded-lg p-2">
                      <span className="text-xs text-gray-500 w-6">#{idx + 1}</span>
                      {audio ? (
                        <>
                          <span className="text-sm text-white flex-1 truncate">{audio.name}</span>
                          <audio src={audio.data} controls className="h-6" />
                          <button
                            onClick={() => removeAudio(audio.id)}
                            className="w-6 h-6 bg-red-600/20 hover:bg-red-600 rounded text-red-400 text-xs transition-colors"
                          >✕</button>
                        </>
                      ) : (
                        <span className="text-xs text-gray-600">空</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Settings */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          {/* Size Preset */}
          <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4 space-y-3">
            <span className="text-sm font-semibold text-gray-300">📐 尺寸预设</span>
            <div className="grid grid-cols-2 gap-2">
              {COMFYUI_SIZE_PRESETS.map((preset, idx) => (
                <button
                  key={preset.label}
                  onClick={() => setSizePresetIdx(idx)}
                  className={`text-xs py-1.5 rounded-lg transition-all ${
                    sizePresetIdx === idx
                      ? 'bg-fuchsia-600 text-white font-bold ring-2 ring-fuchsia-400/50'
                      : 'bg-slate-800 hover:bg-slate-700 text-gray-300'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="text-xs text-fuchsia-300 bg-fuchsia-500/10 rounded p-2">
              当前: <span className="font-bold">{currentSize.label}</span>
            </div>
          </div>

          {/* Aspect Ratio */}
          <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4 space-y-3">
            <span className="text-sm font-semibold text-gray-300">📱 画面比例</span>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: '16:9', label: '横屏', icon: '▭' },
                { key: '9:16', label: '竖屏', icon: '▯' },
                { key: '1:1', label: '方形', icon: '◻' },
              ].map(r => (
                <button
                  key={r.key}
                  onClick={() => setAspectRatio(r.key)}
                  className={`py-2 rounded-lg text-sm transition-all ${
                    aspectRatio === r.key
                      ? 'bg-fuchsia-600 text-white font-bold'
                      : 'bg-slate-800 hover:bg-slate-700 text-gray-300'
                  }`}
                >
                  {r.icon} {r.label}
                </button>
              ))}
            </div>
            <div className="text-xs text-gray-400">
              竖屏时自动交换宽高 · 输出: {currentSize.width}×{currentSize.height}
            </div>
          </div>

          {/* Duration */}
          <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-300">⏱️ 视频时长</span>
              <span className="text-xl font-bold text-fuchsia-400">{duration}秒</span>
            </div>
            <input
              type="range"
              min={5}
              max={15}
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              className="w-full accent-fuchsia-500"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>5秒</span><span>10秒</span><span>15秒</span>
            </div>
          </div>

          {/* Seed */}
          <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-300">🎲 种子 (可选)</span>
              <button
                onClick={() => setSeed(Math.floor(Math.random() * 1_000_000_000))}
                className="text-xs px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded"
              >🎲 随机</button>
            </div>
            <input
              type="number"
              value={seed ?? ''}
              onChange={e => setSeed(e.target.value ? Number(e.target.value) : undefined)}
              placeholder="留空自动生成"
              className="w-full text-sm bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-fuchsia-500/50"
            />
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={generating || !serverUrl || !prompt.trim()}
            className="w-full py-3 bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 disabled:opacity-50 rounded-xl font-bold text-white text-sm transition-all shadow-lg shadow-fuchsia-500/20"
          >
            {generating ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                生成中...
              </span>
            ) : (
              '🔮 开始生成视频'
            )}
          </button>

          {genProgress && !genResult && (
            <div className="text-center text-xs text-fuchsia-300 animate-pulse">{genProgress}</div>
          )}
          {genError && (
            <div className="text-center text-xs text-red-400 bg-red-500/10 rounded p-2">{genError}</div>
          )}
        </div>
      </div>

      {/* Result */}
      {genResult && (
        <div className="bg-slate-900/50 border border-green-500/20 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-green-300">✅ 生成结果</span>
            <span className="text-xs text-gray-500">{genResult.filename}</span>
          </div>
          {/* Prefill source hint */}
          {prefillShot && (
            <div className="bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-lg px-3 py-2 text-xs text-fuchsia-300 flex items-center justify-between">
              <span>📌 来自分镜 #{prefillShot.shotNumber} - {prefillShot.title || '未命名'}</span>
              {onSaveToShot && (
                <button
                  onClick={async () => {
                    try {
                      await onSaveToShot(prefillShot.id, genResult.videoUrl, genResult.videoDownloadUrl || genResult.videoUrl);
                      alert(`✅ 已保存到分镜 #${prefillShot.shotNumber}！可在「视频分镜」标签页查看。`);
                    } catch (e: any) {
                      alert(`保存失败: ${e.message}`);
                    }
                  }}
                  className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-white font-bold text-xs transition-colors"
                >💾 保存到分镜</button>
              )}
            </div>
          )}
          <video
            src={genResult.videoUrl}
            controls
            autoPlay
            className="w-full aspect-video bg-black rounded-lg"
          />
          <div className="flex gap-2">
            {genResult.videoDownloadUrl && (
              <a
                href={genResult.videoDownloadUrl}
                download={genResult.filename}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 rounded-lg text-center text-xs font-bold transition-colors"
              >⬇️ 下载视频</a>
            )}
            <button
              onClick={() => { setGenResult(null); setPrompt(''); setRefImages([]); setRefAudios([]); }}
              className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-center text-xs font-bold transition-colors"
            >🔄 重新生成</button>
          </div>
        </div>
      )}

      {/* ── Video Library ── */}
      <div className="bg-slate-900/50 border border-white/10 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowLibrary(v => !v)}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">📚</span>
            <span className="text-sm font-semibold text-gray-300">视频库</span>
            <span className="text-xs bg-fuchsia-500/20 text-fuchsia-300 px-2 py-0.5 rounded-full">
              {videoHistory.length} 条记录
            </span>
          </div>
          <div className="flex items-center gap-2">
            {videoHistory.length > 0 && (
              <span
                onClick={(e) => { e.stopPropagation(); clearAllHistory(); }}
                className="text-xs text-red-400 hover:text-red-300 px-2 py-0.5 rounded hover:bg-red-500/10 transition-colors"
              >清空</span>
            )}
            <span className={`text-gray-400 transition-transform ${showLibrary ? 'rotate-180' : ''}`}>▼</span>
          </div>
        </button>

        {showLibrary && (
          <div className="border-t border-white/10">
            {videoHistory.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                暂无历史记录，生成的视频会自动保存在这里
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 p-3">
                {videoHistory.map(record => (
                  <div
                    key={record.id}
                    className="group relative bg-slate-950/50 rounded-lg border border-white/5 hover:border-fuchsia-500/30 transition-colors cursor-pointer overflow-hidden"
                    onClick={() => setPlayingRecord(record)}
                  >
                    {/* Thumbnail / Video preview */}
                    <div className="aspect-video bg-black relative">
                      {record.thumbnail ? (
                        <img src={record.thumbnail} alt="" className="w-full h-full object-cover opacity-60" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600 text-2xl">🎬</div>
                      )}
                      {/* Play overlay */}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                        <span className="text-2xl opacity-0 group-hover:opacity-100 transition-opacity">▶️</span>
                      </div>
                      {/* Duration badge */}
                      <div className="absolute bottom-1 right-1 text-[9px] bg-black/70 text-white px-1 rounded">
                        {record.params.duration}s
                      </div>
                    </div>
                    {/* Info */}
                    <div className="p-2 space-y-1">
                      <div className="text-[10px] text-gray-400 line-clamp-2 leading-tight h-7">
                        {record.prompt || '（无提示词）'}
                      </div>
                      <div className="flex items-center justify-between text-[9px] text-gray-600">
                        <span>{record.params.aspectRatio} · {record.params.sizePresetIdx < COMFYUI_SIZE_PRESETS.length ? COMFYUI_SIZE_PRESETS[record.params.sizePresetIdx]?.label : ''}</span>
                        <span>{formatTime(record.createdAt)}</span>
                      </div>
                    </div>
                    {/* Actions overlay */}
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); loadFromHistory(record); }}
                        title="重载参数"
                        className="w-5 h-5 bg-blue-600/80 hover:bg-blue-500 rounded text-white text-[9px]"
                      >⚙️</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteHistoryRecord(record.id); }}
                        title="删除"
                        className="w-5 h-5 bg-red-600/80 hover:bg-red-500 rounded text-white text-[9px]"
                      >✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Player Modal for History Records ── */}
      {playingRecord && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setPlayingRecord(null)}
        >
          <div
            className="bg-slate-900 rounded-xl border border-white/10 max-w-3xl w-full max-h-[90vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <span className="text-sm font-semibold text-white">{playingRecord.filename}</span>
              <button
                onClick={() => setPlayingRecord(null)}
                className="w-6 h-6 bg-white/10 hover:bg-white/20 rounded text-white transition-colors"
              >✕</button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(90vh-140px)]">
              <video
                src={playingRecord.videoUrl}
                controls
                autoPlay
                className="w-full aspect-video bg-black rounded-lg"
              />
              <div className="bg-slate-950/50 rounded-lg p-3 space-y-2">
                <div className="text-xs text-gray-400">
                  <span className="text-fuchsia-400">提示词：</span>
                  <span className="text-gray-300 whitespace-pre-wrap break-words">{playingRecord.prompt}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                  <span>比例: {playingRecord.params.aspectRatio}</span>
                  <span>尺寸: {COMFYUI_SIZE_PRESETS[playingRecord.params.sizePresetIdx]?.label || '未知'}</span>
                  <span>时长: {playingRecord.params.duration}秒</span>
                  <span>参考图: {playingRecord.params.refImageCount}张</span>
                  <span>参考音频: {playingRecord.params.refAudioCount}个</span>
                  <span>时间: {new Date(playingRecord.createdAt).toLocaleString('zh-CN')}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-white/10">
              {playingRecord.videoDownloadUrl && (
                <a
                  href={playingRecord.videoDownloadUrl}
                  download={playingRecord.filename}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 rounded-lg text-center text-xs font-bold transition-colors"
                >⬇️ 下载视频</a>
              )}
              <button
                onClick={() => { loadFromHistory(playingRecord); setPlayingRecord(null); }}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-center text-xs font-bold transition-colors"
              >⚙️ 载入参数重新生成</button>
              <button
                onClick={() => deleteHistoryRecord(playingRecord.id)}
                className="px-4 py-2 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded-lg text-xs font-bold transition-colors"
              >🗑️ 删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper: format time
function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - ts;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}天前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// Helper: read file as data URL
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
