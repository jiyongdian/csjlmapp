'use client';

import { useState, useEffect } from 'react';

interface Skill {
  id: string;
  name: string;
  description: string | null;
  category: string;
  systemPrompt: string | null;
  userPrompt: string | null;
  parameters: any;
  isDefault: number;
  isActive: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface SkillsPanelProps {
  token: string;
  selectedSkillId: string | null;
  onSelectSkill: (skillId: string | null) => void;
  appliedSkill?: { id: string; name: string; category: string; autoMatched: boolean } | null;
}

const CATEGORY_OPTIONS = [
  { value: 'writing', label: '写作', color: '#f59e0b', icon: '✍️' },
  { value: 'style', label: '风格', color: '#ec4899', icon: '🎨' },
  { value: 'plot', label: '剧情', color: '#8b5cf6', icon: '📖' },
  { value: 'character', label: '角色', color: '#10b981', icon: '👤' },
  { value: 'dialogue', label: '对话', color: '#3b82f6', icon: '💬' },
];

const categoryMeta = (cat: string) => CATEGORY_OPTIONS.find(c => c.value === cat) || CATEGORY_OPTIONS[0];

export function SkillsPanel({ token, selectedSkillId, onSelectSkill, appliedSkill }: SkillsPanelProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [form, setForm] = useState({ name: '', description: '', category: 'writing', systemPrompt: '', userPrompt: '' });

  const fetchSkills = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/skills', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setSkills(data.data.skills || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchSkills(); }, [token]);

  const resetForm = () => {
    setForm({ name: '', description: '', category: 'writing', systemPrompt: '', userPrompt: '' });
    setEditingId(null);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    try {
      if (editingId) {
        const res = await fetch(`/api/skills/${editingId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (data.success) {
          setShowForm(false);
          resetForm();
          fetchSkills();
        }
      } else {
        const res = await fetch('/api/skills', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (data.success) {
          setShowForm(false);
          resetForm();
          fetchSkills();
        }
      }
    } catch (e) { console.error(e); }
  };

  const handleEdit = (skill: Skill) => {
    setEditingId(skill.id);
    setForm({
      name: skill.name,
      description: skill.description || '',
      category: skill.category,
      systemPrompt: skill.systemPrompt || '',
      userPrompt: skill.userPrompt || '',
    });
    setShowForm(true);
    setExpandedId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此技能？')) return;
    try {
      await fetch(`/api/skills/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (selectedSkillId === id) onSelectSkill(null);
      fetchSkills();
    } catch (e) { console.error(e); }
  };

  const handleToggleSelect = (skillId: string) => {
    onSelectSkill(selectedSkillId === skillId ? null : skillId);
  };

  const filteredSkills = filterCategory === 'all'
    ? skills
    : skills.filter(s => s.category === filterCategory);

  const selectedSkill = skills.find(s => s.id === selectedSkillId);

  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 16, color: '#e2e8f0', marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>🎯 创作技能</h3>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          style={btnStyle}
        >
          {showForm ? '取消' : '+ 新建技能'}
        </button>
      </div>

      {/* 当前应用的技能提示 */}
      {selectedSkill && !appliedSkill && (
        <div style={{ background: `${categoryMeta(selectedSkill.category).color}22`, border: `1px solid ${categoryMeta(selectedSkill.category).color}`, borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12 }}>
            ✨ 已应用技能：<strong>{selectedSkill.name}</strong>
            <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.7 }}>（生成章节时生效）</span>
          </span>
          <button onClick={() => onSelectSkill(null)} style={{ ...btnStyle, fontSize: 11, padding: '2px 8px' }}>取消应用</button>
        </div>
      )}

      {/* 生成时实际应用的技能（含自动匹配标记） */}
      {appliedSkill && (
        <div style={{ background: appliedSkill.autoMatched ? '#0c4a6e22' : `${categoryMeta(appliedSkill.category).color}22`, border: `1px solid ${appliedSkill.autoMatched ? '#0ea5e9' : categoryMeta(appliedSkill.category).color}`, borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          <span style={{ fontSize: 12 }}>
            {appliedSkill.autoMatched ? '🎯 自动匹配技能：' : '✨ 已应用技能：'}<strong>{appliedSkill.name}</strong>
            <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.7 }}>[{categoryMeta(appliedSkill.category).label}]</span>
          </span>
        </div>
      )}

      {/* 新建/编辑表单 */}
      {showForm && (
        <div style={{ background: '#0f0f1e', padding: 12, borderRadius: 8, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a78bfa' }}>{editingId ? '✏️ 编辑技能' : '➕ 新建技能'}</div>
          <input placeholder="技能名称 *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          <input placeholder="描述（可选）" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={inputStyle} />
          <div style={{ display: 'flex', gap: 8 }}>
            {CATEGORY_OPTIONS.map(c => (
              <button
                key={c.value}
                onClick={() => setForm({ ...form, category: c.value })}
                style={{
                  ...btnStyle,
                  fontSize: 12,
                  padding: '4px 10px',
                  background: form.category === c.value ? c.color : '#334155',
                  flex: 1,
                }}
              >
                {c.icon} {c.label}
              </button>
            ))}
          </div>
          <textarea
            placeholder="系统提示词（核心指令，会注入到生成系统提示中）"
            value={form.systemPrompt}
            onChange={e => setForm({ ...form, systemPrompt: e.target.value })}
            style={{ ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          />
          <textarea
            placeholder="附加用户提示（可选，会附加到用户消息中）"
            value={form.userPrompt}
            onChange={e => setForm({ ...form, userPrompt: e.target.value })}
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSubmit} style={{ ...btnStyle, background: '#6366f1' }}>
              {editingId ? '保存修改' : '创建技能'}
            </button>
            <button onClick={() => { setShowForm(false); resetForm(); }} style={btnStyle}>取消</button>
          </div>
        </div>
      )}

      {/* 分类筛选 */}
      {skills.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => setFilterCategory('all')}
            style={{ ...btnStyle, fontSize: 11, padding: '3px 10px', background: filterCategory === 'all' ? '#6366f1' : '#334155' }}
          >全部 ({skills.length})</button>
          {CATEGORY_OPTIONS.map(c => {
            const count = skills.filter(s => s.category === c.value).length;
            if (count === 0) return null;
            return (
              <button
                key={c.value}
                onClick={() => setFilterCategory(c.value)}
                style={{ ...btnStyle, fontSize: 11, padding: '3px 10px', background: filterCategory === c.value ? c.color : '#334155' }}
              >
                {c.icon} {c.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>加载中...</div>
      ) : filteredSkills.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 13 }}>
          {skills.length === 0 ? '暂无技能，创建自定义写作技能提升生成质量' : '该分类下暂无技能'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredSkills.map(s => {
            const meta = categoryMeta(s.category);
            const isSelected = selectedSkillId === s.id;
            const isExpanded = expandedId === s.id;
            return (
              <div
                key={s.id}
                style={{
                  background: isSelected ? `${meta.color}15` : '#0f0f1e',
                  padding: 10,
                  borderRadius: 8,
                  borderLeft: `3px solid ${meta.color}`,
                  border: isSelected ? `1px solid ${meta.color}` : '1px solid transparent',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }} onClick={() => setExpandedId(isExpanded ? null : s.id)}>
                    {meta.icon}
                    <strong style={{ fontSize: 13 }}>{s.name}</strong>
                    <span style={{ fontSize: 11, color: meta.color, background: `${meta.color}22`, padding: '1px 6px', borderRadius: 4 }}>{meta.label}</span>
                    {isSelected && <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>● 已应用</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => handleToggleSelect(s.id)}
                      style={{
                        ...btnStyle,
                        fontSize: 11,
                        padding: '2px 8px',
                        background: isSelected ? '#22c55e' : '#334155',
                      }}
                    >
                      {isSelected ? '已应用' : '应用'}
                    </button>
                    <button onClick={() => handleEdit(s)} style={{ ...btnStyle, fontSize: 11, padding: '2px 8px' }}>编辑</button>
                    <button onClick={() => handleDelete(s.id)} style={{ ...btnStyle, fontSize: 11, padding: '2px 8px', background: '#7f1d1d' }}>删除</button>
                  </div>
                </div>

                {s.description && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{s.description}</div>}

                {/* 展开详情 */}
                {isExpanded && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #334155' }}>
                    {s.systemPrompt && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>📋 系统提示词：</div>
                        <pre style={{ background: '#1a1a2e', padding: 8, borderRadius: 4, fontSize: 11, color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: 200, overflow: 'auto' }}>{s.systemPrompt}</pre>
                      </div>
                    )}
                    {s.userPrompt && (
                      <div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>💬 用户提示：</div>
                        <pre style={{ background: '#1a1a2e', padding: 8, borderRadius: 4, fontSize: 11, color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: 150, overflow: 'auto' }}>{s.userPrompt}</pre>
                      </div>
                    )}
                  </div>
                )}

                {/* 未展开时的预览 */}
                {!isExpanded && s.systemPrompt && (
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, maxHeight: 36, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {s.systemPrompt}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = { background: '#334155', color: '#e2e8f0', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 };
const inputStyle: React.CSSProperties = { background: '#0f0f1e', color: '#e2e8f0', border: '1px solid #334155', padding: '6px 10px', borderRadius: 6, fontSize: 13, outline: 'none', width: '100%' };
