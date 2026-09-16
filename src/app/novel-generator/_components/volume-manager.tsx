'use client';

import { useState, useEffect } from 'react';

export function VolumeManager({ novelId, token, chapters }: { novelId: string; token: string; chapters?: any[] }) {
  const [volumes, setVolumes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', summary: '' });
  const [expandedVol, setExpandedVol] = useState<string | null>(null);

  const fetchVolumes = async () => {
    if (!novelId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/novels/${novelId}/volumes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setVolumes(data.data.volumes || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchVolumes(); }, [novelId]);

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    try {
      const res = await fetch(`/api/novels/${novelId}/volumes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setShowForm(false);
        setForm({ title: '', summary: '' });
        fetchVolumes();
      }
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此卷？卷内章节将取消分配。')) return;
    try {
      await fetch(`/api/novels/${novelId}/volumes/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchVolumes();
    } catch (e) { console.error(e); }
  };

  const handleAssignChapter = async (chapterNumber: number, volumeId: string | null) => {
    try {
      await fetch(`/api/novels/${novelId}/volumes`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterNumber, volumeId }),
      });
      fetchVolumes();
    } catch (e) { console.error(e); }
  };

  const getChapterVolume = (chapterNumber: number): string | null => {
    const ch = chapters?.find(c => (c.index ?? 0) === chapterNumber);
    return ch?.volumeId || null;
  };

  const unassignedChapters = chapters?.filter(c => !c.volumeId) || [];

  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 16, color: '#e2e8f0', marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>📚 卷结构管理</h3>
        <button onClick={() => setShowForm(!showForm)} style={btnStyle}>
          {showForm ? '取消' : '+ 新建卷'}
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#0f0f1e', padding: 12, borderRadius: 8, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input placeholder="卷标题（如：第一卷·初入江湖）" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={inputStyle} />
          <input placeholder="卷摘要（可选）" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} style={inputStyle} />
          <button onClick={handleCreate} style={{ ...btnStyle, background: '#6366f1', alignSelf: 'flex-start' }}>创建</button>
        </div>
      )}

      {loading ? <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>加载中...</div> :
        volumes.length === 0 ? <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>暂无分卷，创建第一卷开始组织章节</div> :
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {volumes.map((v, i) => (
              <div key={v.id} style={{ background: '#0f0f1e', padding: 12, borderRadius: 8, borderLeft: '3px solid #6366f1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpandedVol(expandedVol === v.id ? null : v.id)}>
                  <div>
                    <strong style={{ fontSize: 14 }}>第{v.orderIndex || i + 1}卷 · {v.title}</strong>
                    <span style={{ fontSize: 12, color: '#64748b', marginLeft: 12 }}>
                      {v.chapterCount || 0} 章 · {(v.wordCount || 0).toLocaleString()} 字
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>{expandedVol === v.id ? '▼' : '▶'}</span>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(v.id); }} style={{ ...btnStyle, fontSize: 11, padding: '2px 8px' }}>删除</button>
                  </div>
                </div>
                {v.summary && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{v.summary}</div>}

                {expandedVol === v.id && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #334155' }}>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>已分配章节：</div>
                    {chapters?.filter(c => c.volumeId === v.id).length === 0 ? (
                      <div style={{ fontSize: 12, color: '#64748b' }}>暂无章节</div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {chapters?.filter(c => c.volumeId === v.id).map((c: any) => (
                          <span key={c.index} style={{ background: '#334155', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                            第{c.index}章 {c.title}
                            <button onClick={() => handleAssignChapter(c.index, null)} style={{ marginLeft: 6, background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
      }

      {/* 未分配章节 */}
      {chapters && unassignedChapters.length > 0 && volumes.length > 0 && (
        <div style={{ marginTop: 12, padding: 12, background: '#0f0f1e', borderRadius: 8, border: '1px dashed #334155' }}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>📌 未分配章节（点击分配到卷）：</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {unassignedChapters.map((c: any) => (
              <select
                key={c.index}
                value={getChapterVolume(c.index) || ''}
                onChange={(e) => handleAssignChapter(c.index, e.target.value || null)}
                style={{ background: '#1a1a2e', color: '#e2e8f0', border: '1px solid #334155', padding: '4px 8px', borderRadius: 4, fontSize: 11 }}
              >
                <option value="">第{c.index}章 · 未分配</option>
                {volumes.map(v => (
                  <option key={v.id} value={v.id}>→ 第{v.orderIndex}卷</option>
                ))}
              </select>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = { background: '#334155', color: '#e2e8f0', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 };
const inputStyle: React.CSSProperties = { background: '#0f0f1e', color: '#e2e8f0', border: '1px solid #334155', padding: '6px 10px', borderRadius: 6, fontSize: 13, outline: 'none', width: '100%' };
