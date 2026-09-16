'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/lib/get-token';

interface ComfyServer {
  id: string;
  name: string;
  url: string;
  isDefault: boolean;
  remark?: string;
  createdAt: string;
}

interface TestResult {
  status: 'online' | 'offline' | 'testing' | 'error';
  responseTime?: number;
  deviceCount?: number;
  vramUsed?: number;
  vramTotal?: number;
  error?: string;
}

const STORAGE_KEY = 'comfyui-servers';

function loadServers(): ComfyServer[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [
    {
      id: 'default-1',
      name: '默认服务器',
      url: 'https://wlyjqdska7tvean3-8188.container.x-gpu.com',
      isDefault: true,
      remark: 'MiniMax H3 多参工作流',
      createdAt: new Date().toISOString(),
    }
  ];
}

function saveServers(servers: ComfyServer[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
}

export default function ComfyUIAdminPage() {
  const [servers, setServers] = useState<ComfyServer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [form, setForm] = useState({ name: '', url: '', remark: '' });

  useEffect(() => {
    setServers(loadServers());
  }, []);

  useEffect(() => {
    if (servers.length > 0) saveServers(servers);
  }, [servers]);

  const handleSave = () => {
    if (!form.name.trim() || !form.url.trim()) {
      alert('请填写服务器名称和地址');
      return;
    }

    if (editingId) {
      setServers(prev => prev.map(s =>
        s.id === editingId ? { ...s, name: form.name.trim(), url: form.url.trim(), remark: form.remark.trim() } : s
      ));
    } else {
      const newServer: ComfyServer = {
        id: Date.now().toString(),
        name: form.name.trim(),
        url: form.url.trim(),
        isDefault: servers.length === 0,
        remark: form.remark.trim(),
        createdAt: new Date().toISOString(),
      };
      setServers(prev => [...prev, newServer]);
    }
    setShowForm(false);
    setEditingId(null);
    setForm({ name: '', url: '', remark: '' });
  };

  const handleTest = async (id: string) => {
    const server = servers.find(s => s.id === id);
    if (!server) return;
    
    setTestingId(id);
    setTestResults(prev => ({ ...prev, [id]: { status: 'testing' } }));
    
    try {
      const res = await fetch('/api/comfyui/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: server.url }),
      });
      const data = await res.json();
      
      setTestResults(prev => ({
        ...prev,
        [id]: data.success ? {
          status: 'online',
          responseTime: data.data?.responseTime,
          deviceCount: data.data?.systemStats?.devices,
          vramUsed: data.data?.systemStats?.vramUsed,
          vramTotal: data.data?.systemStats?.vramTotal,
        } : {
          status: 'error',
          error: data.error || '连接失败',
        }
      }));
    } catch (err: any) {
      setTestResults(prev => ({
        ...prev,
        [id]: { status: 'offline', error: err.message }
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm('确认删除此服务器配置？')) return;
    setServers(prev => prev.filter(s => s.id !== id));
    setTestResults(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const setDefault = (id: string) => {
    setServers(prev => prev.map(s => ({ ...s, isDefault: s.id === id })));
  };

  const getStatusBadge = (id: string) => {
    const r = testResults[id];
    if (!r) return <span className="px-2 py-0.5 bg-gray-700 text-gray-300 text-[10px] rounded-full">未检测</span>;
    if (r.status === 'testing') return <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-[10px] rounded-full">检测中...</span>;
    if (r.status === 'online') return <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-[10px] rounded-full">● 在线 {r.responseTime}ms</span>;
    if (r.status === 'error') return <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-[10px] rounded-full">⚠ 错误</span>;
    return <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-[10px] rounded-full">○ 离线</span>;
  };

  const openForm = (server?: ComfyServer) => {
    if (server) {
      setEditingId(server.id);
      setForm({ name: server.name, url: server.url, remark: server.remark || '' });
    } else {
      setEditingId(null);
      setForm({ name: '', url: '', remark: '' });
    }
    setShowForm(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xl">🎬</span>
              ComfyUI 服务器管理
            </h1>
            <p className="text-sm text-gray-400 mt-1">管理 MiniMax H3 视频生成的 ComfyUI 服务器连接（独立于媒体 API 配置）</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => servers.forEach(s => handleTest(s.id))}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors"
            >
              🔄 全部检测
            </button>
            <button
              onClick={() => openForm()}
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-lg text-sm font-bold transition-colors"
            >
              + 添加服务器
            </button>
          </div>
        </div>

        {/* 服务器列表 */}
        <div className="space-y-3">
          {servers.length === 0 && (
            <div className="py-20 text-center text-gray-500">
              <div className="text-4xl mb-3">📡</div>
              <div>暂无服务器配置，点击上方按钮添加</div>
            </div>
          )}
          {servers.map((server) => {
            const result = testResults[server.id];
            const vramPercent = result?.vramTotal && result.vramTotal > 0
              ? (result.vramUsed! / result.vramTotal!) * 100
              : 0;
            
            return (
              <div key={server.id} className="bg-white/5 border border-white/10 rounded-xl p-5 hover:border-white/20 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold">{server.name}</h3>
                      {server.isDefault && <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-[10px] rounded-full font-bold">默认</span>}
                      {getStatusBadge(server.id)}
                    </div>
                    <code className="text-sm text-gray-400 block mb-2">{server.url}</code>
                    {server.remark && <p className="text-xs text-gray-500">{server.remark}</p>}
                    
                    {/* 检测结果详情 */}
                    {result?.status === 'online' && (
                      <div className="mt-3 p-3 bg-green-500/5 border border-green-500/10 rounded-lg">
                        <div className="grid grid-cols-3 gap-3 text-xs">
                          <div>
                            <span className="text-gray-500">GPU设备: </span>
                            <span className="text-green-400 font-bold">{result.deviceCount}</span>
                          </div>
                          {result.vramTotal && result.vramTotal > 0 && (
                            <div className="col-span-2">
                              <div className="flex justify-between text-gray-500 mb-1">
                                <span>显存</span>
                                <span>
                                  {(result.vramUsed! / 1024 / 1024).toFixed(1)}GB / {(result.vramTotal! / 1024 / 1024).toFixed(1)}GB
                                </span>
                              </div>
                              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div className={`h-full ${vramPercent > 80 ? 'bg-red-500' : vramPercent > 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${vramPercent}%` }} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {result?.status === 'error' && (
                      <div className="mt-3 p-3 bg-red-500/5 border border-red-500/10 rounded-lg text-xs text-red-400">
                        {result.error}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => handleTest(server.id)}
                      disabled={testingId === server.id}
                      className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-lg text-xs text-blue-300 transition-colors disabled:opacity-50"
                    >
                      {testingId === server.id ? '检测中...' : '🔌 检测'}
                    </button>
                    <button
                      onClick={() => openForm(server)}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs transition-colors"
                    >
                      编辑
                    </button>
                    {!server.isDefault && (
                      <button
                        onClick={() => setDefault(server.id)}
                        className="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 rounded-lg text-xs text-purple-300 transition-colors"
                      >
                        设为默认
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(server.id)}
                      className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-xs text-red-400 transition-colors"
                    >
                      删除
                    </button>
                    <button
                      onClick={() => window.open(`/comfyui-workbench?server=${encodeURIComponent(server.url)}`, '_blank')}
                      className="px-3 py-1.5 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-lg text-xs text-green-400 transition-colors"
                    >
                      🎨 工作台
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 添加/编辑弹窗 */}
        {showForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900 border border-white/20 rounded-2xl p-6 w-full max-w-md">
              <h2 className="text-lg font-bold mb-4">{editingId ? '编辑服务器' : '添加服务器'}</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">服务器名称 *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="如: 我的 ComfyUI 服务器"
                    className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">服务器地址 *</label>
                  <input
                    value={form.url}
                    onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                    placeholder="https://your-server:8188"
                    className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">备注说明</label>
                  <textarea
                    value={form.remark}
                    onChange={e => setForm(f => ({ ...f, remark: e.target.value }))}
                    placeholder="工作流版本、模型信息等..."
                    rows={2}
                    className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 resize-none"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => { setShowForm(false); setEditingId(null); setForm({ name: '', url: '', remark: '' }); }}
                  className="flex-1 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-lg text-sm font-bold transition-colors"
                >
                  {editingId ? '保存' : '添加'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
