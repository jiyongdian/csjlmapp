'use client';

import { useState, useEffect } from 'react';

const MEMORY_TYPES = [
  { value: 'characterCard', label: '角色卡', color: '#6366f1' },
  { value: 'worldbuilding', label: '世界观', color: '#10b981' },
  { value: 'chapterSummary', label: '章节摘要', color: '#f59e0b' },
  { value: 'foreshadowing', label: '伏笔', color: '#ef4444' },
  { value: 'timelineEvent', label: '时间线', color: '#8b5cf6' },
  { value: 'relationshipState', label: '关系状态', color: '#ec4899' },
  { value: 'sceneState', label: '场景状态', color: '#14b8a6' },
  { value: 'storyArc', label: '故事弧', color: '#f97316' },
  { value: 'continuityRule', label: '连贯规则', color: '#64748b' },
  { value: 'stylePreference', label: '风格偏好', color: '#0ea5e9' },
  { value: 'novelSummary', label: '全书摘要', color: '#a855f7' },
];

const LAYERS = [
  { value: 'L1', label: 'L1 核心设定' },
  { value: 'L2', label: 'L2 章节上下文' },
  { value: 'L3', label: 'L3 全书走向' },
];

function getTypeInfo(type: string) {
  return MEMORY_TYPES.find(t => t.value === type) || { value: type, label: type, color: '#6b7280' };
}

export function StoryMemoryPanel({ novelId, token }: { novelId: string; token: string }) {
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>('');
  const [filterLayer, setFilterLayer] = useState<string>('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ memoryType: 'characterCard', title: '', content: '', importance: 70, sourceChapter: undefined as number | undefined });

  const fetchMemories = async () => {
    if (!novelId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType) params.set('type', filterType);
      if (filterLayer) params.set('layer', filterLayer);
      if (search) params.set('keyword', search);
      const res = await fetch(`/api/novels/${novelId}/memory?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setMemories(data.data.memories || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchMemories(); }, [novelId, filterType, filterLayer, search]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.content.trim()) return;
    try {
      const res = await fetch(`/api/novels/${novelId}/memory`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setShowForm(false);
        setForm({ memoryType: 'characterCard', title: '', content: '', importance: 70, sourceChapter: undefined });
        fetchMemories();
      }
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这条记忆？')) return;
    try {
      await fetch(`/api/novels/${novelId}/memory/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchMemories();
    } catch (e) { console.error(e); }
  };

  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 16, color: '#e2e8f0', marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>🧠 创作记忆</h3>
        <button onClick={() => setShowForm(!showForm)} style={btnStyle}>
          {showForm ? '取消' : '+ 新建记忆'}
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#0f0f1e', padding: 12, borderRadius: 8, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select value={form.memoryType} onChange={e => setForm({ ...form, memoryType: e.target.value })} style={inputStyle}>
            {MEMORY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input placeholder="记忆标题（如：主角陆沉）" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={inputStyle} />
          <textarea placeholder="记忆内容" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" placeholder="重要性 1-100" value={form.importance} onChange={e => setForm({ ...form, importance: +e.target.value })} style={{ ...inputStyle, width: 120 }} />
            <input type="number" placeholder="来源章节" value={form.sourceChapter || ''} onChange={e => setForm({ ...form, sourceChapter: e.target.value ? +e.target.value : undefined })} style={{ ...inputStyle, width: 120 }} />
            <button onClick={handleCreate} style={{ ...btnStyle, background: '#6366f1' }}>保存</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input placeholder="搜索记忆..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 150 }} />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={inputStyle}>
          <option value="">全部类型</option>
          {MEMORY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={filterLayer} onChange={e => setFilterLayer(e.target.value)} style={inputStyle}>
          <option value="">全部层级</option>
          {LAYERS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>加载中...</div> :
        memories.length === 0 ? <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>暂无记忆，生成章节后会自动沉淀摘要</div> :
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
            {memories.map(m => {
              const info = getTypeInfo(m.memoryType);
              return (
                <div key={m.id} style={{ background: '#0f0f1e', padding: 10, borderRadius: 8, borderLeft: `3px solid ${info.color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, background: info.color, color: '#fff', padding: '2px 6px', borderRadius: 4 }}>{info.label}</span>
                      <span style={{ fontSize: 11, color: '#64748b' }}>{m.layer}</span>
                      <strong style={{ fontSize: 13 }}>{m.title}</strong>
                    </div>
                    <button onClick={() => handleDelete(m.id)} style={{ ...btnStyle, fontSize: 11, padding: '2px 8px' }}>删除</button>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  {m.sourceChapter != null && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>来源：第{m.sourceChapter}章 · 重要性 {m.importance}</div>}
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

const btnStyle: React.CSSProperties = { background: '#334155', color: '#e2e8f0', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 };
const inputStyle: React.CSSProperties = { background: '#0f0f1e', color: '#e2e8f0', border: '1px solid #334155', padding: '6px 10px', borderRadius: 6, fontSize: 13, outline: 'none' };
