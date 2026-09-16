'use client';

import React, { useState, useRef, useEffect } from 'react';

interface ComfyWorkflow {
  id: string;
  name: string;
  description?: string;
  fileName?: string;
  workflowType?: string;
  modelType?: string;
  isDefault?: number;
  isActive?: number;
  createdAt?: string;
  updatedAt?: string;
  workflowJson?: string;
}

interface Props {
  selectedWorkflowId?: string;
  onSelectWorkflow: (id: string) => void;
  onWorkflowsChange?: () => void;
}

export default function WorkflowCompactSelector({
  selectedWorkflowId,
  onSelectWorkflow,
  onWorkflowsChange,
}: Props) {
  const [workflows, setWorkflows] = useState<ComfyWorkflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [editingWf, setEditingWf] = useState<ComfyWorkflow | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadJson, setUploadJson] = useState('');
  const [editName, setEditName] = useState('');
  const [editJson, setEditJson] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadWorkflows = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/comfyui/workflows?active=true');
      const data = await res.json();
      if (data.success) {
        setWorkflows(data.data);
      }
    } catch (err) {
      console.error('加载工作流失败:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadWorkflows();
  }, []);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowMenu(false);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      try {
        JSON.parse(content);
        setUploadJson(content);
        if (!uploadName) setUploadName(file.name.replace('.json', ''));
        setShowUpload(true);
      } catch {
        alert('文件不是有效的 JSON 格式');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (!uploadName.trim()) { alert('请输入工作流名称'); return; }
    if (!uploadJson.trim()) { alert('请上传工作流文件或粘贴 JSON'); return; }
    try {
      const res = await fetch('/api/comfyui/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: uploadName, workflowJson: uploadJson, workflowType: 'video' }),
      });
      const data = await res.json();
      if (data.success) {
        alert('上传成功！');
        setShowUpload(false);
        setUploadName('');
        setUploadJson('');
        await loadWorkflows();
        onWorkflowsChange?.();
      } else {
        alert(data.error || '上传失败');
      }
    } catch (err: any) {
      alert('上传失败: ' + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个工作流吗？')) return;
    try {
      const res = await fetch(`/api/comfyui/workflows/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        if (selectedWorkflowId === id) onSelectWorkflow('');
        loadWorkflows();
        onWorkflowsChange?.();
      } else {
        alert(data.error || '删除失败');
      }
    } catch (err: any) {
      alert('删除失败: ' + err.message);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      const res = await fetch(`/api/comfyui/workflows/${id}/set-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowType: 'video' }),
      });
      const data = await res.json();
      if (data.success) loadWorkflows();
      else alert(data.error || '操作失败');
    } catch {
      alert('操作失败');
    }
  };

  const handleOpenEditor = async (wf: ComfyWorkflow) => {
    setEditingWf(wf);
    setEditName(wf.name);
    let jsonContent = (wf as any).workflowJson;
    if (!jsonContent) {
      try {
        const res = await fetch(`/api/comfyui/workflows/${wf.id}`);
        const data = await res.json();
        if (data.success && data.data) jsonContent = (data.data as any).workflowJson;
      } catch {}
    }
    setEditJson(jsonContent ? (typeof jsonContent === 'string' ? jsonContent : JSON.stringify(jsonContent, null, 2)) : '');
    setShowUpload(true); // 复用弹窗
  };

  const handleSaveEdit = async () => {
    if (!editingWf) return;
    try {
      JSON.parse(editJson);
      const res = await fetch(`/api/comfyui/workflows/${editingWf.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, workflowJson: editJson }),
      });
      const data = await res.json();
      if (data.success) {
        alert('保存成功！');
        setShowUpload(false);
        setEditingWf(null);
        loadWorkflows();
      } else {
        alert(data.error || '保存失败');
      }
    } catch {
      alert('JSON 格式无效');
    }
  };

  const downloadWorkflow = (wf: ComfyWorkflow) => {
    if (!wf.workflowJson) return;
    const blob = new Blob([wf.workflowJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${wf.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedWf = workflows.find(w => w.id === selectedWorkflowId);
  const displayName = selectedWf?.name || (workflows.find(w => w.isDefault === 1)?.name) || '默认工作流';

  return (
    <div className="relative" ref={containerRef}>
      {/* 隐藏的文件输入 - 放在顶层避免被卸载 */}
      <input id="wf-upload-input" ref={fileInputRef} type="file" accept=".json" onChange={handleFileUpload} className="hidden" />

      {/* 触发按钮 */}
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-fuchsia-500/30 bg-black/40 text-fuchsia-200 hover:border-fuchsia-400/50 min-w-[140px] max-w-[200px] transition-colors"
      >
        <span className="truncate flex-1 text-left" title={displayName}>{displayName}</span>
        <svg className="w-3 h-3 text-fuchsia-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 下拉菜单 */}
      {showMenu && (
        <div className="absolute top-full left-0 mt-1 z-50 w-72 bg-gray-900 border border-fuchsia-500/30 rounded-xl shadow-2xl overflow-hidden">
          {/* 上传按钮 - label 关联 file input */}
          <div className="p-2 border-b border-white/10">
            <label
              htmlFor="wf-upload-input"
              className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 text-white text-xs font-semibold rounded-lg transition-all cursor-pointer"
            >
              📤 上传工作流插件
            </label>
          </div>

          {/* 工作流列表 */}
          <div className="max-h-60 overflow-auto">
            {loading ? (
              <div className="p-4 text-center text-xs text-gray-400">加载中...</div>
            ) : workflows.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-500">暂无工作流</div>
            ) : (
              workflows.map(w => (
                <div
                  key={w.id}
                  className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
                    selectedWorkflowId === w.id ? 'bg-fuchsia-500/20' : 'hover:bg-white/5'
                  }`}
                  onClick={() => {
                    onSelectWorkflow(w.id);
                    setShowMenu(false);
                  }}
                >
                  <span className={`text-xs ${w.isDefault === 1 ? 'text-yellow-400' : 'text-gray-500'}`}>
                    {w.isDefault === 1 ? '⭐' : '☆'}
                  </span>
                  <span className={`text-xs flex-1 truncate ${selectedWorkflowId === w.id ? 'text-fuchsia-200 font-medium' : 'text-gray-300'}`}>
                    {w.name}
                  </span>
                  <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleOpenEditor(w)}
                      className="text-[10px] text-fuchsia-400 hover:text-fuchsia-300 p-0.5 rounded hover:bg-fuchsia-500/10"
                      title="编辑"
                    >✏️</button>
                    <button
                      onClick={() => handleSetDefault(w.id)}
                      className="text-[10px] text-amber-400 hover:text-amber-300 p-0.5 rounded hover:bg-amber-500/10"
                      title="设为默认"
                    >{w.isDefault === 1 ? '⭐' : '☆'}</button>
                    <button
                      onClick={() => downloadWorkflow(w)}
                      className="text-[10px] text-blue-400 hover:text-blue-300 p-0.5 rounded hover:bg-blue-500/10"
                      title="下载"
                    >⬇️</button>
                    <button
                      onClick={() => handleDelete(w.id)}
                      className="text-[10px] text-red-400 hover:text-red-300 p-0.5 rounded hover:bg-red-500/10"
                      title="删除"
                    >🗑️</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 上传/编辑弹窗 */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-fuchsia-500/30 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <h3 className="text-lg font-bold text-white">
                {editingWf ? '✏️ 编辑工作流' : '⬆️ 上传工作流'}
              </h3>
              <button
                onClick={() => { setShowUpload(false); setEditingWf(null); }}
                className="text-gray-400 hover:text-white text-2xl"
              >×</button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">工作流名称</label>
                <input
                  type="text"
                  value={editingWf ? editName : uploadName}
                  onChange={(e) => editingWf ? setEditName(e.target.value) : setUploadName(e.target.value)}
                  placeholder="例如：MiniMax H3 多参工作流"
                  className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-white text-sm focus:outline-none focus:border-fuchsia-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">JSON 内容</label>
                <textarea
                  value={editingWf ? editJson : uploadJson}
                  onChange={(e) => editingWf ? setEditJson(e.target.value) : setUploadJson(e.target.value)}
                  placeholder='粘贴工作流 JSON 内容...'
                  rows={8}
                  className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-white text-xs font-mono focus:outline-none focus:border-fuchsia-500/50"
                />
              </div>
              <button
                onClick={editingWf ? handleSaveEdit : handleUpload}
                className="w-full px-4 py-2 bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 text-white font-semibold text-sm rounded-lg transition-all"
              >
                {editingWf ? '保存修改' : '确认上传'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
