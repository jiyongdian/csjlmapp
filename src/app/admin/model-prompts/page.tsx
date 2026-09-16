"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/get-token";

interface ModelPrompt {
  id: string;
  code: string;
  name: string;
  description: string | null;
  module: string;
  systemPrompt: string;
  userPrompt: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

const MODULE_LABELS: Record<string, string> = {
  'novel-creation': '小说创作',
  'chapter-generation': '章节生成',
  'script-generation': '剧本生成',
  'visual-prompts': '视觉提示词',
  'agent-skills': 'Agent技能',
};

const MODULE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'novel-creation': { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  'chapter-generation': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  'script-generation': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  'visual-prompts': { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  'agent-skills': { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
};

export default function ModelPromptsPage() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<ModelPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPrompt, setEditingPrompt] = useState<ModelPrompt | null>(null);
  const [editForm, setEditForm] = useState({ systemPrompt: '', userPrompt: '', name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [activeModule, setActiveModule] = useState<string>('all');
  const [searchText, setSearchText] = useState('');
  const [token, setToken] = useState<string>('');

  useEffect(() => {
    const t = getToken();
    if (!t) {
      router.push('/auth/login');
      return;
    }
    setToken(t);
    fetchPrompts(t);
  }, [router]);

  const fetchPrompts = async (t?: string) => {
    const authToken = t || token;
    if (!authToken) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/model-prompts', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (data.success) {
        setPrompts(data.data);
      }
    } catch (err) {
      console.error('获取提示词失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (prompt: ModelPrompt) => {
    setEditingPrompt(prompt);
    setEditForm({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt || '',
      name: prompt.name,
      description: prompt.description || '',
    });
  };

  const handleSave = async () => {
    if (!editingPrompt || !token) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/model-prompts/${editingPrompt.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description,
          systemPrompt: editForm.systemPrompt,
          userPrompt: editForm.userPrompt || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPrompts(prev => prev.map(p => p.id === editingPrompt.id ? { ...p, ...data.data } : p));
        setEditingPrompt(null);
      } else {
        alert(data.error || '保存失败');
      }
    } catch (err) {
      console.error('保存失败:', err);
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!token) return;
    if (!confirm('确定要重置所有提示词为默认值吗？此操作不可撤销。')) return;
    try {
      const res = await fetch('/api/admin/model-prompts/seed', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        alert(`重置成功！创建 ${data.created} 条，更新 ${data.updated} 条`);
        fetchPrompts();
      }
    } catch (err) {
      console.error('重置失败:', err);
    }
  };

  const handleSyncAgentSkills = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/admin/agent-skills/sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        alert(`Agent技能同步完成！创建 ${data.created} 条，更新 ${data.updated} 条，共 ${data.total} 条`);
        fetchPrompts();
      } else {
        alert(data.error || '同步失败');
      }
    } catch (err) {
      console.error('同步Agent技能失败:', err);
      alert('同步Agent技能失败');
    }
  };

  const handleToggleActive = async (prompt: ModelPrompt) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/model-prompts/${prompt.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !prompt.isActive }),
      });
      const data = await res.json();
      if (data.success) {
        setPrompts(prev => prev.map(p => p.id === prompt.id ? { ...p, isActive: !prompt.isActive } : p));
      }
    } catch (err) {
      console.error('切换状态失败:', err);
    }
  };

  const filteredPrompts = prompts.filter(p => {
    if (activeModule !== 'all' && p.module !== activeModule) return false;
    if (searchText) {
      const s = searchText.toLowerCase();
      return p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s) || (p.description || '').toLowerCase().includes(s);
    }
    return true;
  });

  const modules = [...new Set(prompts.map(p => p.module))];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-base">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-white/10 px-8 py-5 backdrop-blur-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/admin/members')} className="text-gray-400 hover:text-white transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold text-white">模型提示词管理</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSyncAgentSkills}
              className="px-5 py-2.5 text-sm font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30 rounded-lg hover:bg-sky-500/25 transition-colors"
            >
              同步Agent技能
            </button>
            <button
              onClick={handleReset}
              className="px-5 py-2.5 text-sm font-medium bg-orange-500/15 text-orange-400 border border-orange-500/30 rounded-lg hover:bg-orange-500/25 transition-colors"
            >
              重置为默认值
            </button>
            <button
              onClick={() => fetchPrompts()}
              className="px-5 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              刷新
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-6">
        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-400">模块：</span>
            <button
              onClick={() => setActiveModule('all')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeModule === 'all' ? 'bg-purple-600 text-white' : 'bg-white/5 text-gray-300 border border-white/15 hover:bg-white/10'
              }`}
            >
              全部
            </button>
            {modules.map(m => (
              <button
                key={m}
                onClick={() => setActiveModule(m)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeModule === m ? 'bg-purple-600 text-white' : 'bg-white/5 text-gray-300 border border-white/15 hover:bg-white/10'
                }`}
              >
                {MODULE_LABELS[m] || m}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="搜索提示词..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="flex-1 max-w-xs px-4 py-2 text-sm text-white bg-white/5 border border-white/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 placeholder:text-gray-500"
          />
        </div>

        {/* Prompt Cards */}
        <div className="space-y-5">
          {filteredPrompts.map(prompt => {
            const mc = MODULE_COLORS[prompt.module] || { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' };
            return (
              <div
                key={prompt.id}
                className={`backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden hover:border-white/20 transition-all ${
                  !prompt.isActive ? 'opacity-50' : ''
                }`}
              >
                {/* Card Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 text-xs font-semibold rounded-md ${mc.bg} ${mc.text} ${mc.border} border`}>
                      {MODULE_LABELS[prompt.module] || prompt.module}
                    </span>
                    <h3 className="text-base font-semibold text-white">{prompt.name}</h3>
                    <span className="text-xs text-gray-400 font-mono bg-white/10 px-2 py-0.5 rounded">{prompt.code}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleToggleActive(prompt)}
                      className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                        prompt.isActive
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                          : 'bg-white/5 text-gray-400 border border-white/15 hover:bg-white/10'
                      }`}
                    >
                      {prompt.isActive ? '启用中' : '已禁用'}
                    </button>
                    <button
                      onClick={() => handleEdit(prompt)}
                      className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      编辑
                    </button>
                  </div>
                </div>
                {/* Card Body - Preview */}
                <div className="px-6 py-4">
                  {prompt.description && (
                    <p className="text-sm text-gray-400 mb-3 leading-relaxed">{prompt.description}</p>
                  )}
                  <div className="grid grid-cols-2 gap-5">
                    <div>
                      <div className="text-sm font-semibold text-gray-300 mb-2">系统提示词（System Prompt）</div>
                      <div className="text-sm text-gray-400 bg-white/5 border border-white/10 rounded-lg p-4 max-h-28 overflow-hidden whitespace-pre-line line-clamp-4 leading-relaxed">
                        {prompt.systemPrompt || '(空)'}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-300 mb-2">用户提示词（User Prompt）</div>
                      <div className="text-sm text-gray-400 bg-white/5 border border-white/10 rounded-lg p-4 max-h-28 overflow-hidden whitespace-pre-line line-clamp-4 leading-relaxed">
                        {prompt.userPrompt || '(空)'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredPrompts.length === 0 && (
          <div className="text-center py-16 text-gray-500 text-base">暂无提示词数据</div>
        )}
      </div>

      {/* Edit Modal */}
      {editingPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col border border-white/10" style={{ background: 'rgba(15,12,41,0.95)' }}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div>
                <h2 className="text-xl font-bold text-white">{editingPrompt.name}</h2>
                <p className="text-sm text-gray-400 mt-1">
                  {MODULE_LABELS[editingPrompt.module] || editingPrompt.module} · <span className="font-mono text-gray-500">{editingPrompt.code}</span>
                </p>
              </div>
              <button
                onClick={() => setEditingPrompt(null)}
                className="text-gray-400 hover:text-white transition-colors p-1"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">提示词名称</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2.5 text-sm text-white bg-white/5 border border-white/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">描述</label>
                  <input
                    type="text"
                    value={editForm.description}
                    onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-4 py-2.5 text-sm text-white bg-white/5 border border-white/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  系统提示词（System Prompt）
                </label>
                <p className="text-xs text-gray-500 mb-2">这是发送给AI模型的核心指令，决定了生成内容的风格和格式</p>
                <textarea
                  value={editForm.systemPrompt}
                  onChange={e => setEditForm(prev => ({ ...prev, systemPrompt: e.target.value }))}
                  className="w-full px-4 py-3 text-sm text-white bg-white/5 border border-white/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono leading-relaxed"
                  rows={20}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  用户提示词（User Prompt）
                </label>
                <p className="text-xs text-gray-500 mb-2">可选。附加在用户消息中的提示词</p>
                <textarea
                  value={editForm.userPrompt}
                  onChange={e => setEditForm(prev => ({ ...prev, userPrompt: e.target.value }))}
                  className="w-full px-4 py-3 text-sm text-white bg-white/5 border border-white/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono leading-relaxed"
                  rows={6}
                  placeholder="(可选，留空则不使用)"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-4 px-8 py-5 border-t border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <button
                onClick={() => setEditingPrompt(null)}
                className="px-6 py-2.5 text-sm font-medium text-gray-400 bg-white/5 border border-white/15 rounded-lg hover:bg-white/10 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? '保存中...' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
