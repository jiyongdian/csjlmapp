"use client";

import { useState, useEffect, useCallback } from "react";
import { getToken as getAuthToken } from "@/lib/get-token";

interface AIConfig {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  scope: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}

interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
}

export default function AdminApiSettingsPage() {
  const [configs, setConfigs] = useState<AIConfig[]>([]);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // 表单数据
  const [formData, setFormData] = useState({
    name: "",
    provider: "deepseek",
    apiUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-v4-flash",
    temperature: 85,
    maxTokens: 8192,
    isDefault: false,
  });

  const getToken = useCallback(() => getAuthToken() || "", []);

  const fetchConfigs = async () => {
    try {
      const token = getToken();
      if (!token) return;

      const res = await fetch("/api/admin/ai-configs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setConfigs(data.data.configs || []);
        setProviders(data.data.providers || []);
      }
    } catch (error) {
      console.error("获取配置失败:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const handleProviderChange = (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    setFormData({
      ...formData,
      provider: providerId,
      apiUrl: provider?.baseUrl || "",
      model: provider?.models?.[0] || "",
    });
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.apiKey || !formData.model) {
      alert("请填写完整信息（名称、API密钥、模型）");
      return;
    }

    setSaving(true);
    try {
      const token = getToken();
      const url = editingId
        ? `/api/admin/ai-configs/${editingId}`
        : "/api/admin/ai-configs";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (data.success) {
        setShowForm(false);
        setEditingId(null);
        resetForm();
        fetchConfigs();
      } else {
        alert(data.error || "操作失败");
      }
    } catch (error) {
      alert("操作失败");
    }
    setSaving(false);
  };

  const handleEdit = (config: AIConfig) => {
    setFormData({
      name: config.name,
      provider: config.provider,
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      isDefault: config.isDefault,
    });
    setEditingId(config.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除此API配置吗？")) return;

    try {
      const token = getToken();
      const res = await fetch(`/api/admin/ai-configs/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        fetchConfigs();
      } else {
        alert(data.error || "删除失败");
      }
    } catch (error) {
      alert("删除失败");
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    setTestResult(null);
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/ai-configs/${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTestResult({ id, success: data.success, message: data.message || data.error || "测试完成" });
    } catch (error) {
      setTestResult({ id, success: false, message: "测试失败" });
    }
    setTesting(null);
  };

  const handleToggleDefault = async (id: string, isDefault: boolean) => {
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/ai-configs/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isDefault: !isDefault }),
      });
      const data = await res.json();
      if (data.success) {
        fetchConfigs();
      }
    } catch (error) {
      console.error("设置默认失败:", error);
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/ai-configs/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !isActive }),
      });
      const data = await res.json();
      if (data.success) {
        fetchConfigs();
      }
    } catch (error) {
      console.error("切换状态失败:", error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      provider: "deepseek",
      apiUrl: "https://api.deepseek.com/v1",
      apiKey: "",
      model: "deepseek-v4-flash",
      temperature: 85,
      maxTokens: 8192,
      isDefault: false,
    });
  };

  const getProviderName = (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    return provider?.name || providerId;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">API接口管理</h2>
          <p className="text-sm text-gray-500 mt-1">管理系统级AI接口配置，所有用户均可使用</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setEditingId(null);
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-500/20 transition-all duration-200 text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          添加API配置
        </button>
      </div>

      {/* 表单弹窗 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-white/10" style={{ background: 'rgba(15,12,41,0.95)' }}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-white">
                  {editingId ? "编辑API配置" : "添加API配置"}
                </h3>
                <button
                  onClick={() => setShowForm(false)}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* 提供商选择 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">AI提供商</label>
                  <select
                    value={formData.provider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all text-white bg-white/5"
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id} className="bg-gray-900 text-white">{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* 配置名称 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">配置名称</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="例如：DeepSeek V3"
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all text-white bg-white/5 placeholder:text-gray-500"
                  />
                </div>

                {/* API地址 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">API地址</label>
                  <input
                    type="text"
                    value={formData.apiUrl}
                    onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                    placeholder="https://api.deepseek.com/v1"
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all text-white bg-white/5 placeholder:text-gray-500"
                  />
                </div>

                {/* API密钥 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">API密钥</label>
                  <input
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all text-white bg-white/5 placeholder:text-gray-500"
                  />
                </div>

                {/* 模型 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">模型</label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    placeholder="deepseek-v4-flash"
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all text-white bg-white/5 placeholder:text-gray-500"
                  />
                  {formData.provider !== "custom" && (
                    <div className="mt-2">
                      <label className="text-xs text-gray-500 mb-1 block">可选模型：</label>
                      <div className="flex flex-wrap gap-1.5">
                        {providers.find((p) => p.id === formData.provider)?.models.map((m) => (
                          <button
                            key={m}
                            onClick={() => setFormData({ ...formData, model: m })}
                            className={`px-2.5 py-1 text-xs rounded-lg border transition-all ${
                              formData.model === m
                                ? "bg-purple-500/15 border-purple-400 text-purple-300"
                                : "border-white/15 text-gray-400 hover:border-white/25"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 温度 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    温度：{formData.temperature}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={formData.temperature}
                    onChange={(e) => setFormData({ ...formData, temperature: parseInt(e.target.value) })}
                    className="w-full accent-blue-600"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>精确</span>
                    <span>创意</span>
                  </div>
                </div>

                {/* 最大Token */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">最大Token</label>
                  <select
                    value={formData.maxTokens}
                    onChange={(e) => setFormData({ ...formData, maxTokens: parseInt(e.target.value) })}
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all text-white bg-white/5"
                  >
                    <option value={4096} className="bg-gray-900 text-white">4K</option>
                    <option value={8192} className="bg-gray-900 text-white">8K</option>
                    <option value={16384} className="bg-gray-900 text-white">16K</option>
                    <option value={32768} className="bg-gray-900 text-white">32K</option>
                    <option value={65536} className="bg-gray-900 text-white">64K</option>
                    <option value={131072} className="bg-gray-900 text-white">128K</option>
                  </select>
                </div>

                {/* 设为默认 */}
                <label className="flex items-center gap-3 p-3 bg-white/5 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-300">设为系统默认API配置</span>
                </label>
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2.5 border border-white/15 text-gray-400 rounded-xl hover:bg-white/10 transition-all text-sm font-medium"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all text-sm font-medium shadow-md shadow-blue-500/20"
                >
                  {saving ? "保存中..." : editingId ? "更新配置" : "创建配置"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 配置列表 */}
      <div className="backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {configs.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 bg-white/10 rounded-2xl flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-gray-500 font-medium">暂无系统API配置</p>
            <p className="text-sm text-gray-400 mt-1">点击上方"添加API配置"按钮创建</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {configs.map((config) => (
              <div key={config.id} className="p-5 hover:bg-white/5 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h4 className="text-base font-semibold text-white truncate">{config.name}</h4>
                      {config.isDefault && (
                        <span className="px-2.5 py-0.5 text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30 rounded-full">
                          系统默认
                        </span>
                      )}
                      <span className="px-2.5 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/30 rounded-full">
                        {getProviderName(config.provider)}
                      </span>
                      {!config.isActive && (
                        <span className="px-2.5 py-0.5 text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30 rounded-full">
                          已禁用
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
                      <span>模型：<span className="text-gray-300">{config.model}</span></span>
                      <span>温度：<span className="text-gray-300">{config.temperature}%</span></span>
                      <span>最大Token：<span className="text-gray-300">{config.maxTokens}</span></span>
                    </div>
                    <div className="mt-1 text-xs text-gray-400 truncate">
                      API地址：{config.apiUrl}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    {/* 启用/禁用开关 */}
                    <button
                      onClick={() => handleToggleActive(config.id, config.isActive)}
                      className={`p-2 rounded-lg transition-all ${
                        config.isActive
                          ? "text-green-500 hover:bg-green-500/15"
                          : "text-gray-300 hover:bg-red-500/15 hover:text-red-400"
                      }`}
                      title={config.isActive ? "点击禁用" : "点击启用"}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {config.isActive ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        )}
                      </svg>
                    </button>

                    {/* 测试连接 */}
                    <button
                      onClick={() => handleTest(config.id)}
                      disabled={testing === config.id}
                      className="p-2 text-gray-400 hover:text-green-400 hover:bg-green-500/15 rounded-lg transition-all"
                      title="测试连接"
                    >
                      {testing === config.id ? (
                        <div className="animate-spin w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full" />
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                    </button>

                    {/* 设为默认 */}
                    <button
                      onClick={() => handleToggleDefault(config.id, config.isDefault)}
                      className={`p-2 rounded-lg transition-all ${
                        config.isDefault
                          ? "text-yellow-500 hover:bg-yellow-500/15"
                          : "text-gray-400 hover:text-yellow-500 hover:bg-yellow-500/15"
                      }`}
                      title={config.isDefault ? "取消默认" : "设为默认"}
                    >
                      <svg className="w-4 h-4" fill={config.isDefault ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    </button>

                    {/* 编辑 */}
                    <button
                      onClick={() => handleEdit(config)}
                      className="p-2 text-gray-400 hover:text-blue-400 hover:bg-blue-500/15 rounded-lg transition-all"
                      title="编辑"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>

                    {/* 删除 */}
                    <button
                      onClick={() => handleDelete(config.id)}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/15 rounded-lg transition-all"
                      title="删除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* 测试结果 */}
                {testResult && testResult.id === config.id && (
                  <div className={`mt-3 px-4 py-2 rounded-xl text-sm ${
                    testResult.success
                      ? "bg-green-500/15 text-green-400 border border-green-500/30"
                      : "bg-red-500/15 text-red-400 border border-red-500/30"
                  }`}>
                    {testResult.success ? "✅ " : "❌ "}{testResult.message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 使用说明 */}
      <div className="backdrop-blur-xl rounded-2xl p-6 border border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <h3 className="text-sm font-semibold text-purple-300 mb-3">💡 使用说明</h3>
        <ul className="space-y-2 text-sm text-gray-400">
          <li className="flex items-start gap-2">
            <span className="mt-0.5">•</span>
            <span><strong>系统级配置</strong>：管理员添加的API配置，所有用户均可使用</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5">•</span>
            <span><strong>用户级配置</strong>：用户可在"AI设置"页面自行添加自己的API密钥</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5">•</span>
            <span>用户在小说生成器中可自由选择使用系统配置或自己的配置</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5">•</span>
            <span>设为"系统默认"的配置将作为所有用户的默认生成接口</span>
          </li>
        </ul>
      </div>
    </div>
  );
}