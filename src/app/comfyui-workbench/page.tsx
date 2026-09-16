'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ComfyUI MiniMax H3 尺寸预设
const SIZE_PRESETS: Array<{ label: string; megapixels: number; w16: number; h16: number }> = [
  { label: '0.2MP', megapixels: 0.2, w16: 608, h16: 352 },
  { label: '0.3MP', megapixels: 0.3, w16: 736, h16: 416 },
  { label: '0.4MP', megapixels: 0.4, w16: 864, h16: 480 },
  { label: '0.5MP', megapixels: 0.5, w16: 960, h16: 544 },
  { label: '0.6MP', megapixels: 0.6, w16: 1056, h16: 608 },
  { label: '0.7MP', megapixels: 0.7, w16: 1152, h16: 640 },
  { label: '0.8MP', megapixels: 0.8, w16: 1216, h16: 672 },
  { label: '0.9MP', megapixels: 0.9, w16: 1280, h16: 736 },
  { label: '1.0MP', megapixels: 1.0, w16: 1376, h16: 768 },
  { label: '1.2MP', megapixels: 1.2, w16: 1504, h16: 832 },
  { label: '1.5MP', megapixels: 1.5, w16: 1664, h16: 928 },
  { label: '2.0MP', megapixels: 2.0, w16: 1920, h16: 1088 },
];

type AspectRatio = '16:9' | '9:16' | '1:1';

function getSizeByAspect(aspect: AspectRatio, presetIndex: number): { width: number; height: number; label: string } {
  const p = SIZE_PRESETS[presetIndex] || SIZE_PRESETS[2];
  if (aspect === '9:16') {
    return { width: p.h16, height: p.w16, label: `${p.label} ${p.h16}×${p.w16}` };
  } else if (aspect === '1:1') {
    const sq = Math.min(p.w16, p.h16);
    return { width: sq, height: sq, label: `${p.label} ${sq}×${sq}` };
  }
  return { width: p.w16, height: p.h16, label: `${p.label} ${p.w16}×${p.h16}` };
}

type ConnectionStatus = 'idle' | 'testing' | 'online' | 'offline' | 'error';

interface ComfyUIConfig {
  serverUrl: string;
  workflowTemplate?: string;
  modelType: string;
}

interface GenerateParams {
  prompt: string;
  aspectRatio: AspectRatio;
  sizePresetIndex: number;
  width: number;
  height: number;
  duration: number;
  referenceImages: string[];
  seed?: number;
}

interface ConnectionResult {
  status: ConnectionStatus;
  serverUrl: string;
  responseTime: number;
  systemStats: {
    devices: number;
    vramTotal: number;
    vramUsed: number;
    os: string;
    pythonVersion: string;
  } | null;
  queueStatus: { running: number; pending: number } | null;
  error: string | null;
}

export default function ComfyUIWorkbenchPage() {
  const [config, setConfig] = useState<ComfyUIConfig>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('comfyui-config');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return {
      serverUrl: 'https://wlyjqdska7tvean3-8188.container.x-gpu.com',
      modelType: 'minimax-h3-reference',
    };
  });

  const [connection, setConnection] = useState<ConnectionResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<string>('');
  const [generatedVideo, setGeneratedVideo] = useState<{
    url: string;
    downloadUrl?: string;
    mimeType: string;
    filename: string;
    size: number;
  } | null>(null);
  const [error, setError] = useState<string>('');
  
  const [params, setParams] = useState<GenerateParams>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('comfyui-params') : null;
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    const size = getSizeByAspect('16:9', 2);
    return {
      prompt: '',
      aspectRatio: '16:9',
      sizePresetIndex: 2,
      width: size.width,
      height: size.height,
      duration: 10,
      referenceImages: [],
      seed: undefined,
    };
  });

  // 保存参数到 localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('comfyui-params', JSON.stringify({
        ...params,
        referenceImages: [], // 不保存图片
      }));
    }
  }, [params]);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [workflowJson, setWorkflowJson] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // 保存配置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('comfyui-config', JSON.stringify(config));
    }
  }, [config]);

  // 自动测试连接
  useEffect(() => {
    if (config.serverUrl) {
      // 延迟测试，等待输入停止
      const timer = setTimeout(() => {
        handleTestConnection(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [config.serverUrl]);

  const handleTestConnection = useCallback(async (silent = false) => {
    if (!config.serverUrl) {
      if (!silent) setError('请先输入 ComfyUI 服务器地址');
      return;
    }

    setIsTesting(true);
    if (!silent) setError('');
    
    try {
      const res = await fetch('/api/comfyui/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: config.serverUrl }),
      });
      const data = await res.json();
      
      if (data.success) {
        setConnection({
          status: 'online',
          serverUrl: data.data.serverUrl,
          responseTime: data.data.responseTime,
          systemStats: data.data.systemStats,
          queueStatus: data.data.queueStatus,
          error: null,
        });
      } else {
        setConnection({
          status: 'error',
          serverUrl: data.data?.serverUrl || config.serverUrl,
          responseTime: 0,
          systemStats: null,
          queueStatus: null,
          error: data.error || '连接失败',
        });
      }
    } catch (err: any) {
      setConnection({
        status: 'offline',
        serverUrl: config.serverUrl,
        responseTime: 0,
        systemStats: null,
        queueStatus: null,
        error: err.message,
      });
    } finally {
      setIsTesting(false);
    }
  }, [config.serverUrl]);

  const handleImageUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const newImages: string[] = [];
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        newImages.push(dataUrl);
      }
    }
    setParams(p => ({ ...p, referenceImages: [...p.referenceImages, ...newImages] }));
  };

  const removeReferenceImage = (index: number) => {
    setParams(p => ({
      ...p,
      referenceImages: p.referenceImages.filter((_, i) => i !== index),
    }));
  };

  const handleGenerate = async () => {
    if (!config.serverUrl) {
      setError('请先配置 ComfyUI 服务器地址');
      return;
    }
    if (!params.prompt.trim()) {
      setError('请输入视频提示词');
      return;
    }

    setIsGenerating(true);
    setError('');
    setGeneratedVideo(null);
    setGenerationProgress('准备提交工作流...');

    try {
      const requestBody: any = {
        serverUrl: config.serverUrl,
        prompt: params.prompt,
        width: params.width,
        height: params.height,
        aspectRatio: params.aspectRatio,
        sizePresetIndex: params.sizePresetIndex,
        duration: params.duration,
        referenceImages: params.referenceImages,
        modelType: config.modelType,
      };

      if (params.seed !== undefined) {
        requestBody.seed = params.seed;
      }

      if (workflowJson.trim()) {
        try {
          JSON.parse(workflowJson);
          requestBody.workflowTemplate = workflowJson;
        } catch {
          setError('工作流 JSON 格式错误');
          setIsGenerating(false);
          return;
        }
      }

      setGenerationProgress('提交到 ComfyUI...');

      const res = await fetch('/api/comfyui/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();

      if (data.success) {
        setGenerationProgress('完成！');
        setGeneratedVideo({
          url: data.data.videoUrl,
          downloadUrl: data.data.videoDownloadUrl || data.data.videoUrl,
          mimeType: data.data.mimeType,
          filename: data.data.filename,
          size: data.data.size,
        });
      } else {
        setError(data.error || '生成失败');
        setGenerationProgress('');
      }
    } catch (err: any) {
      setError(`生成请求失败: ${err.message}`);
      setGenerationProgress('');
    } finally {
      setIsGenerating(false);
    }
  };

  const getStatusColor = (status: ConnectionStatus) => {
    switch (status) {
      case 'online': return 'text-green-400 bg-green-500/10 border-green-500/30';
      case 'testing': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'offline': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'error': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      default: return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
    }
  };

  const getStatusText = (status: ConnectionStatus) => {
    switch (status) {
      case 'online': return '● 在线';
      case 'testing': return '◌ 测试中...';
      case 'offline': return '○ 离线';
      case 'error': return '⚠ 错误';
      default: return '○ 未连接';
    }
  };

  const vramPercent = connection?.systemStats
    ? (connection.systemStats.vramUsed / connection.systemStats.vramTotal) * 100
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* 顶部导航 */}
      <div className="border-b border-white/10 bg-slate-900/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xl font-bold">
              🎬
            </div>
            <div>
              <h1 className="text-xl font-bold">ComfyUI 视频工作台</h1>
              <p className="text-xs text-gray-400">MiniMax H3 多参视频生成</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {connection && (
              <div className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${getStatusColor(connection.status)}`}>
                {getStatusText(connection.status)}
                {connection.responseTime > 0 && (
                  <span className="ml-2 opacity-70">{connection.responseTime}ms</span>
                )}
              </div>
            )}
            <button
              onClick={() => handleTestConnection(false)}
              disabled={isTesting}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold transition-colors disabled:opacity-50"
            >
              {isTesting ? '测试中...' : '🔄 重新测试'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左侧：配置面板 */}
        <div className="lg:col-span-4 space-y-4">
          {/* 服务器配置 */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
              <span>🖥️</span> ComfyUI 服务器配置
            </h2>
            
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">服务器地址</label>
                <input
                  type="text"
                  value={config.serverUrl}
                  onChange={(e) => setConfig(c => ({ ...c, serverUrl: e.target.value }))}
                  placeholder="http://localhost:8188"
                  className="w-full px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">模型类型</label>
                <select
                  value={config.modelType}
                  onChange={(e) => setConfig(c => ({ ...c, modelType: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500/50"
                >
                  <option value="minimax-h3-reference">MiniMax H3 参考视频</option>
                  <option value="minimax-h3-text2vid">MiniMax H3 文生视频</option>
                  <option value="comfyui-workflow">自定义工作流</option>
                </select>
              </div>
            </div>

            {/* 服务器信息 */}
            {connection?.systemStats && (
              <div className="mt-4 p-3 bg-slate-900/40 rounded-lg border border-white/5">
                <div className="text-xs text-gray-500 mb-2">服务器信息</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-gray-400">GPU设备: {connection.systemStats.devices}</div>
                  <div className="text-gray-400">响应: {connection.responseTime}ms</div>
                  {connection.systemStats.vramTotal > 0 && (
                    <>
                      <div className="col-span-2">
                        <div className="flex justify-between text-gray-500 mb-1">
                          <span>显存使用</span>
                          <span>
                            {(connection.systemStats.vramUsed / 1024 / 1024).toFixed(1)}GB /{' '}
                            {(connection.systemStats.vramTotal / 1024 / 1024).toFixed(1)}GB
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${vramPercent > 80 ? 'bg-red-500' : vramPercent > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                            style={{ width: `${vramPercent}%` }}
                          />
                        </div>
                      </div>
                    </>
                  )}
                  {connection.queueStatus && (
                    <div className="col-span-2 text-gray-500">
                      队列: {connection.queueStatus.running}运行 / {connection.queueStatus.pending}等待
                    </div>
                  )}
                </div>
              </div>
            )}

            {connection?.error && (
              <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                {connection.error}
              </div>
            )}
          </div>

          {/* 参考图片 */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
              <span>🖼️</span> 参考图片 ({params.referenceImages.length}/9)
            </h2>
            
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => handleImageUpload(e.target.files)}
              className="hidden"
            />
            
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={params.referenceImages.length >= 9}
              className="w-full py-6 border-2 border-dashed border-white/20 hover:border-purple-500/50 rounded-lg text-center text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="text-2xl mb-1">📷</div>
              <div>点击上传参考图片</div>
              <div className="text-xs text-gray-500">支持多张，最多9张</div>
            </button>

            {params.referenceImages.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {params.referenceImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img src={img} alt={`ref-${i}`} className="w-full aspect-square object-cover rounded-lg" />
                    <button
                      onClick={() => removeReferenceImage(i)}
                      className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 高级设置 */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between text-sm font-bold text-gray-300"
            >
              <span className="flex items-center gap-2">⚙️ 高级设置</span>
              <span className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}>▼</span>
            </button>
            
            {showAdvanced && (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">工作流模板 (JSON)</label>
                  <textarea
                    value={workflowJson}
                    onChange={(e) => setWorkflowJson(e.target.value)}
                    placeholder="留空使用默认 MiniMax H3 工作流，或粘贴自定义 JSON..."
                    className="w-full h-32 px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">随机种子 (留空随机生成)</label>
                  <input
                    type="number"
                    value={params.seed ?? ''}
                    onChange={(e) => setParams(p => ({ ...p, seed: e.target.value ? parseInt(e.target.value) : undefined }))}
                    placeholder="留空自动生成"
                    className="w-full px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 中间：参数配置和生成 */}
        <div className="lg:col-span-5 space-y-4">
          {/* 生成参数 */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
              <span>🎨</span> 视频生成参数
            </h2>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">视频提示词</label>
                <textarea
                  value={params.prompt}
                  onChange={(e) => setParams(p => ({ ...p, prompt: e.target.value }))}
                  placeholder="描述你想要生成的视频场景...&#10;例如：角色在夕阳下的草原上奔跑，镜头从低角度跟拍..."
                  className="w-full h-32 px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 resize-none"
                />
                <div className="text-right text-xs text-gray-500 mt-1">
                  {params.prompt.length} 字符
                </div>
              </div>

              {/* 宽高比选择 */}
              <div>
                <label className="text-xs text-gray-500 mb-2 block">画面宽高比</label>
                <div className="flex gap-2">
                  {([
                    { v: '16:9', label: '横屏 16:9', icon: '▭' },
                    { v: '9:16', label: '竖屏 9:16', icon: '▯' },
                    { v: '1:1', label: '方形 1:1', icon: '◻' },
                  ] as const).map(r => (
                    <button
                      key={r.v}
                      onClick={() => {
                        const size = getSizeByAspect(r.v, params.sizePresetIndex);
                        setParams(p => ({ ...p, aspectRatio: r.v, width: size.width, height: size.height }));
                      }}
                      className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${
                        params.aspectRatio === r.v
                          ? 'bg-purple-500/20 border-purple-500/50 text-purple-300 font-bold'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                      }`}
                    >
                      {r.icon} {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 尺寸预设 */}
              <div>
                <label className="text-xs text-gray-500 mb-2 block">
                  生成尺寸 (megapixels) — 当前: {getSizeByAspect(params.aspectRatio, params.sizePresetIndex).width}×{getSizeByAspect(params.aspectRatio, params.sizePresetIndex).height}
                </label>
                <div className="flex gap-1.5 flex-wrap">
                  {SIZE_PRESETS.map((preset, i) => {
                    const size = getSizeByAspect(params.aspectRatio, i);
                    const active = params.sizePresetIndex === i;
                    return (
                      <button
                        key={preset.label}
                        onClick={() => setParams(p => ({ ...p, sizePresetIndex: i, width: size.width, height: size.height }))}
                        className={`px-2 py-1.5 text-[10px] rounded-lg border transition-colors ${
                          active
                            ? 'bg-purple-500/20 border-purple-500/50 text-purple-300 font-bold'
                            : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                        }`}
                        title={size.label}
                      >
                        {preset.label}
                        <div className="text-[8px] opacity-70">{size.width}×{size.height}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 时长 */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">时长 (秒)</label>
                <div className="flex gap-2">
                  {[5, 10, 15, 20].map(d => (
                    <button
                      key={d}
                      onClick={() => setParams(p => ({ ...p, duration: d }))}
                      className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${
                        params.duration === d
                          ? 'bg-purple-500/20 border-purple-500/50 text-purple-300 font-bold'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                      }`}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 生成按钮和进度 */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            {error && (
              <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                ⚠️ {error}
              </div>
            )}

            {generationProgress && (
              <div className="mb-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-blue-400">
                {generationProgress}
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={isGenerating || !params.prompt.trim()}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  生成中...
                </>
              ) : (
                <>🎬 开始生成视频</>
              )}
            </button>

            <div className="mt-3 text-xs text-gray-500 text-center">
              视频生成需要一定时间，MiniMax H3 生成约 1-5 分钟
            </div>
          </div>
        </div>

        {/* 右侧：生成结果 */}
        <div className="lg:col-span-3">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 sticky top-6">
            <h2 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
              <span>📺</span> 生成结果
            </h2>

            {!generatedVideo && !isGenerating && (
              <div className="aspect-video bg-slate-900/40 rounded-xl flex items-center justify-center text-gray-600">
                <div className="text-center">
                  <div className="text-4xl mb-2">🎞️</div>
                  <div className="text-sm">等待生成...</div>
                </div>
              </div>
            )}

            {isGenerating && !generatedVideo && (
              <div className="aspect-video bg-slate-900/40 rounded-xl flex items-center justify-center">
                <div className="text-center">
                  <svg className="animate-spin h-10 w-10 mx-auto text-purple-500" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <div className="text-sm text-gray-400 mt-3">
                    {generationProgress || '生成中...'}
                  </div>
                </div>
              </div>
            )}

            {generatedVideo && (
              <div className="space-y-3">
                <video
                  ref={videoRef}
                  src={generatedVideo.url}
                  controls
                  autoPlay
                  className="w-full aspect-video bg-black rounded-xl"
                />
                
                <div className="p-3 bg-slate-900/40 rounded-lg text-xs text-gray-400 space-y-1">
                  <div>文件名: {generatedVideo.filename}</div>
                  <div>格式: {generatedVideo.mimeType}</div>
                  <div>大小: {(generatedVideo.size / 1024 / 1024).toFixed(2)} MB</div>
                </div>

                <div className="flex gap-2">
                  <a
                    href={generatedVideo.downloadUrl || generatedVideo.url}
                    download={generatedVideo.filename || 'comfyui-video.mp4'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-center text-sm font-bold transition-colors"
                  >
                    ⬇️ 下载视频
                  </a>
                  <button
                    onClick={() => {
                      setGeneratedVideo(null);
                      setParams(p => ({ ...p, seed: undefined }));
                    }}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors"
                  >
                    🔄 重新生成
                  </button>
                </div>
              </div>
            )}

            {/* 历史记录区域（未来扩展） */}
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="text-xs text-gray-500">
                <div className="flex items-center justify-between mb-2">
                  <span>💡 使用提示</span>
                </div>
                <ul className="space-y-1 list-disc list-inside">
                  <li>确保 ComfyUI 服务器已启动并加载所需模型</li>
                  <li>工作流使用 MiniMax H3 多参模板</li>
                  <li>参考图片可提高视频一致性</li>
                  <li>生成时间与服务器GPU性能相关</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
