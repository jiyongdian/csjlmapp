"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useAuth } from "@/lib/api/client";
import MediaProviderSettings from "@/components/MediaProviderSettings";

interface AIConfig {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  model: string;
  temperature: number;
  isDefault: boolean;
  isActive: boolean;
  scope: string;
}

interface AIProviders {
  [key: string]: {
    name: string;
    apiUrl: string;
    model: string;
    description: string;
  };
}

export default function AISettingsPanel() {
  const { isAuthenticated, token, userInfo, getToken } = useAuth();
  const [configs, setConfigs] = useState<AIConfig[]>([]);
  const [systemConfigs, setSystemConfigs] = useState<AIConfig[]>([]);
  const [providers, setProviders] = useState<AIProviders>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

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

  useEffect(() => {
    if (isAuthenticated) {
      fetchConfigs();
    }
  }, [isAuthenticated]);

  const fetchConfigs = async () => {
    try {
      const currentToken = getToken();
      if (!currentToken) return;

      const res = await fetch("/api/ai/configs", {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      const data = await res.json();
      if (data.success) {
        setConfigs(data.data.configs || []);
        setSystemConfigs(data.data.systemConfigs || []);
        setProviders(data.data.providers || {});
      }
    } catch (error) {
      console.error("获取配置失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = (provider: string) => {
    const p = providers[provider];
    if (p) {
      setFormData({
        ...formData,
        provider,
        apiUrl: p.apiUrl,
        model: p.model,
      });
    } else {
      setFormData({ ...formData, provider, apiUrl: "", model: "" });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);

    try {
      const currentToken = getToken();
      if (!currentToken) return;

      const url = editingId ? `/api/ai/configs/${editingId}` : "/api/ai/configs";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (data.success) {
        await fetchConfigs();
        setShowForm(false);
        setEditingId(null);
        resetForm();
      } else {
        setTestResult({ success: false, message: data.error || "保存失败" });
      }
    } catch (error) {
      setTestResult({ success: false, message: "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (config: AIConfig) => {
    setFormData({
      name: config.name,
      provider: config.provider,
      apiUrl: config.apiUrl,
      apiKey: "", // 不返回API Key
      model: config.model,
      temperature: config.temperature,
      maxTokens: 8192,
      isDefault: config.isDefault,
    });
    setEditingId(config.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这个配置吗？")) return;

    try {
      const currentToken = getToken();
      if (!currentToken) return;

      const res = await fetch(`/api/ai/configs/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${currentToken}` },
      });

      if (res.ok) {
        await fetchConfigs();
      }
    } catch (error) {
      console.error("删除失败:", error);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      const currentToken = getToken();
      if (!currentToken) return;

      await fetch(`/api/ai/configs/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ isDefault: true }),
      });

      await fetchConfigs();
    } catch (error) {
      console.error("设置默认失败:", error);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const currentToken = getToken();
      if (!currentToken) return;

      // 先保存配置
      const url = editingId ? `/api/ai/configs/${editingId}` : "/api/ai/configs";
      const method = editingId ? "PUT" : "POST";

      const saveRes = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify(formData),
      });

      const saveData = await saveRes.json();
      if (!saveData.success) {
        setTestResult({ success: false, message: saveData.error || "保存失败" });
        setSaving(false);
        return;
      }

      // 验证配置
      const validateRes = await fetch(`/api/ai/configs/${saveData.data.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({
          apiUrl: formData.apiUrl,
          apiKey: formData.apiKey,
          model: formData.model,
          validate: true,
        }),
      });

      const validateData = await validateRes.json();
      if (validateData.success) {
        setTestResult({ success: true, message: "配置有效，连接成功！" });
        await fetchConfigs();
        setShowForm(false);
        setEditingId(null);
        resetForm();
      } else {
        setTestResult({
          success: false,
          message: validateData.validationError || validateData.error || "配置无效",
        });
      }
    } catch (error) {
      setTestResult({ success: false, message: "测试失败" });
    } finally {
      setSaving(false);
      setTesting(false);
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

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-gray-300">请先登录后再配置 AI 接口</p>
        <Link href="/auth/login" className="text-blue-400 hover:text-blue-300">前往登录</Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div>
        {/* 头部 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">AI API 配置</h1>
            <p className="text-gray-300">管理您的AI模型接口，支持使用系统配置或自建配置</p>
          </div>
          <button
            onClick={() => {
              setShowForm(true);
              setEditingId(null);
              resetForm();
            }}
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl font-medium hover:opacity-90 transition"
          >
            + 添加配置
          </button>
        </div>

        {loading ? (
          <div className="text-center text-gray-300 py-12">加载中...</div>
        ) : (
          <div className="space-y-8">
            {/* 系统级配置（管理员设置，全站可用） */}
            {systemConfigs.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  系统API配置（管理员提供）
                </h2>
                <div className="grid md:grid-cols-2 gap-4">
                  {systemConfigs.map((config) => (
                    <div
                      key={config.id}
                      className={`bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-yellow-400/20 ${
                        config.isDefault ? "ring-2 ring-yellow-400" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            {config.name}
                            {config.isDefault && (
                              <span className="text-xs bg-yellow-500 text-white px-2 py-0.5 rounded-full">
                                系统默认
                              </span>
                            )}
                            <span className="text-xs bg-blue-500/30 text-blue-300 px-2 py-0.5 rounded-full">
                              系统
                            </span>
                          </h3>
                          <p className="text-gray-400 text-sm">{providers[config.provider]?.name || config.provider}</p>
                        </div>
                        <div className={`w-3 h-3 rounded-full ${config.isActive ? "bg-green-400" : "bg-gray-500"}`} />
                      </div>

                      <div className="space-y-2 text-sm text-gray-300 mb-4">
                        <div className="flex">
                          <span className="w-20 text-gray-400">接口地址</span>
                          <span className="truncate">{config.apiUrl}</span>
                        </div>
                        <div className="flex">
                          <span className="w-20 text-gray-400">模型</span>
                          <span>{config.model}</span>
                        </div>
                        <div className="flex">
                          <span className="w-20 text-gray-400">温度</span>
                          <span>{config.temperature / 100}</span>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {!config.isDefault && (
                          <button
                            onClick={() => handleSetDefault(config.id)}
                            className="flex-1 px-3 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm hover:bg-yellow-500/30"
                          >
                            设为我的默认
                          </button>
                        )}
                        <div className="flex-1" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 用户级配置（自己添加的） */}
            <div>
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                我的API配置
              </h2>
              {configs.length === 0 ? (
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-12 text-center">
                  <p className="text-gray-300 mb-4">还没有配置自己的AI接口</p>
                  <p className="text-gray-400 text-sm">点击上方按钮添加您的第一个AI配置</p>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {configs.map((config) => (
                    <div
                      key={config.id}
                      className={`bg-white/10 backdrop-blur-lg rounded-2xl p-6 ${
                        config.isDefault ? "ring-2 ring-green-400" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            {config.name}
                            {config.isDefault && (
                              <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">
                                我的默认
                              </span>
                            )}
                          </h3>
                          <p className="text-gray-400 text-sm">{providers[config.provider]?.name || config.provider}</p>
                        </div>
                        <div className={`w-3 h-3 rounded-full ${config.isActive ? "bg-green-400" : "bg-gray-500"}`} />
                      </div>

                      <div className="space-y-2 text-sm text-gray-300 mb-4">
                        <div className="flex">
                          <span className="w-20 text-gray-400">接口地址</span>
                          <span className="truncate">{config.apiUrl}</span>
                        </div>
                        <div className="flex">
                          <span className="w-20 text-gray-400">模型</span>
                          <span>{config.model}</span>
                        </div>
                        <div className="flex">
                          <span className="w-20 text-gray-400">温度</span>
                          <span>{config.temperature / 100}</span>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {!config.isDefault && (
                          <button
                            onClick={() => handleSetDefault(config.id)}
                            className="flex-1 px-3 py-2 bg-green-500/20 text-green-400 rounded-lg text-sm hover:bg-green-500/30"
                          >
                            设为默认
                          </button>
                        )}
                        <button
                          onClick={() => handleEdit(config)}
                          className="flex-1 px-3 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-sm hover:bg-blue-500/30"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(config.id)}
                          className="px-3 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm hover:bg-red-500/30"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 短剧制作 AI 提供商（图片 / 视频 / 配音，可自定义添加） */}
        <MediaProviderSettings />

        {/* 添加/编辑表单弹窗 */}
        {showForm && createPortal(
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[9800]">
            <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold text-white mb-6">
                {editingId ? "编辑配置" : "添加新配置"}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* 配置名称 */}
                <div>
                  <label className="block text-gray-300 text-sm mb-2">配置名称</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="例如：我的DeepSeek"
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* 选择平台 */}
                <div>
                  <label className="block text-gray-300 text-sm mb-2">AI平台</label>
                  <select
                    value={formData.provider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Object.entries(providers).map(([key, p]) => (
                      <option key={key} value={key}>
                        {p.name} - {p.description}
                      </option>
                    ))}
                  </select>
                </div>

                {/* API地址 */}
                <div>
                  <label className="block text-gray-300 text-sm mb-2">API地址</label>
                  <input
                    type="url"
                    value={formData.apiUrl}
                    onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                    placeholder="https://api.deepseek.com/v1"
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-gray-300 text-sm mb-2">API Key</label>
                  <input
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    placeholder={editingId ? "不修改请留空" : "输入您的API Key"}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required={!editingId}
                  />
                </div>

                {/* 模型 */}
                <div>
                  <label className="block text-gray-300 text-sm mb-2">模型名称</label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    placeholder="deepseek-v4-flash"
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* 温度 */}
                <div>
                  <label className="block text-gray-300 text-sm mb-2">
                    温度 (创造性): {formData.temperature / 100}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={formData.temperature}
                    onChange={(e) => setFormData({ ...formData, temperature: Number(e.target.value) })}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>精确</span>
                    <span>创意</span>
                  </div>
                </div>

                {/* 最大Token */}
                <div>
                  <label className="block text-gray-300 text-sm mb-2">最大Token</label>
                  <input
                    type="number"
                    value={formData.maxTokens}
                    onChange={(e) => setFormData({ ...formData, maxTokens: Number(e.target.value) })}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="100"
                    max="128000"
                  />
                </div>

                {/* 设为默认 */}
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="isDefault"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="w-5 h-5 rounded bg-gray-800 border-gray-700"
                  />
                  <label htmlFor="isDefault" className="text-gray-300">
                    设为默认配置
                  </label>
                </div>

                {/* 测试结果 */}
                {testResult && (
                  <div className={`p-4 rounded-xl ${testResult.success ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                    {testResult.message}
                  </div>
                )}

                {/* 按钮 */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={saving || !formData.apiKey}
                    className="flex-1 px-4 py-3 bg-gray-700 text-white rounded-xl hover:bg-gray-600 disabled:opacity-50"
                  >
                    {testing ? "测试中..." : "保存并测试"}
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? "保存中..." : "保存"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      setEditingId(null);
                      resetForm();
                      setTestResult(null);
                    }}
                    className="px-4 py-3 bg-gray-700 text-white rounded-xl hover:bg-gray-600"
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}