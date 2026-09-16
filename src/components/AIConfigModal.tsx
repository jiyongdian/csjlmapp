"use client";

import { useState, useEffect } from "react";
import { apiClient } from "@/lib/api/client";

interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
}

interface AIConfig {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  isDefault: boolean;
  isActive: boolean;
}

interface AIConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AIConfigModal({ isOpen, onClose }: AIConfigModalProps) {
  const [activeTab, setActiveTab] = useState<"list" | "add">("list");
  const [configs, setConfigs] = useState<AIConfig[]>([]);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [defaultConfigId, setDefaultConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);

  // 新建配置表单
  const [formData, setFormData] = useState({
    name: "",
    provider: "openai",
    apiUrl: "",
    apiKey: "",
    model: "",
    temperature: 70,
    maxTokens: 4000,
    isDefault: true,
  });

  const [editingConfig, setEditingConfig] = useState<AIConfig | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchConfigs();
    }
  }, [isOpen]);

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("/ai/configs");
      if (res.success) {
        setConfigs(res.data.configs || []);
        setProviders(res.data.providers || []);
        setDefaultConfigId(res.data.defaultConfigId);
        if (res.data.message) {
          setLoginMessage(res.data.message);
        } else {
          setLoginMessage(null);
        }
      }
    } catch (error) {
      console.error("获取配置失败:", error);
    }
    setLoading(false);
  };

  const handleProviderChange = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId);
    setFormData({
      ...formData,
      provider: providerId,
      apiUrl: provider?.baseUrl || "",
      model: provider?.models[0] || "",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        name: formData.name,
        provider: formData.provider,
        apiUrl: formData.apiUrl,
        apiKey: formData.apiKey,
        model: formData.model,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
        isDefault: formData.isDefault,
      };

      let res;
      if (editingConfig) {
        res = await apiClient.put(`/ai/configs/${editingConfig.id}`, payload);
      } else {
        res = await apiClient.post("/ai/configs", payload);
      }

      if (res.success) {
        fetchConfigs();
        setActiveTab("list");
        setEditingConfig(null);
        setFormData({
          name: "",
          provider: "openai",
          apiUrl: "",
          apiKey: "",
          model: "",
          temperature: 70,
          maxTokens: 4000,
          isDefault: true,
        });
      } else {
        alert(res.error || "保存失败");
      }
    } catch (error) {
      console.error("保存失败:", error);
      alert("保存失败");
    }
    setLoading(false);
  };

  const handleEdit = (config: AIConfig) => {
    setEditingConfig(config);
    setFormData({
      name: config.name,
      provider: config.provider,
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens || 4000,
      isDefault: config.isDefault,
    });
    setActiveTab("add");
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这个配置吗？")) return;
    try {
      const res = await apiClient.delete(`/ai/configs/${id}`);
      if (res.success) {
        fetchConfigs();
      }
    } catch (error) {
      console.error("删除失败:", error);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      const res = await apiClient.put(`/ai/configs/${id}`, { isDefault: true });
      if (res.success) {
        fetchConfigs();
      }
    } catch (error) {
      console.error("设置默认失败:", error);
    }
  };

  const handleTest = async (config: AIConfig) => {
    setTesting(config.id);
    setTestResult(null);
    try {
      const res = await apiClient.post("/ai/configs/" + config.id + "/validate", {});
      setTestResult({
        id: config.id,
        success: res.success,
        message: res.success ? "连接成功！" : (res.error || "连接失败"),
      });
    } catch (error: any) {
      setTestResult({
        id: config.id,
        success: false,
        message: error.message || "连接失败",
      });
    }
    setTesting(null);
  };

  const selectedProvider = providers.find(p => p.id === formData.provider);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-violet-500 to-purple-500">
          <h2 className="text-xl font-bold text-white">AI 配置设置</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab切换 */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => { setActiveTab("list"); setEditingConfig(null); }}
            className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === "list"
                ? "text-violet-600 border-b-2 border-violet-600 bg-violet-50 dark:bg-violet-900/20"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            配置列表
          </button>
          <button
            onClick={() => setActiveTab("add")}
            className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === "add"
                ? "text-violet-600 border-b-2 border-violet-600 bg-violet-50 dark:bg-violet-900/20"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            {editingConfig ? "编辑配置" : "添加配置"}
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {activeTab === "list" ? (
            <div className="space-y-4">
              {loading ? (
                <div className="text-center py-8 text-gray-500">加载中...</div>
              ) : configs.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-4">暂无配置</p>
                  <button
                    onClick={() => setActiveTab("add")}
                    className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
                  >
                    添加第一个配置
                  </button>
                </div>
              ) : (
                configs.map(config => (
                  <div
                    key={config.id}
                    className={`p-4 rounded-xl border-2 transition-colors ${
                      config.isDefault
                        ? "border-violet-500 bg-violet-50 dark:bg-violet-900/20"
                        : "border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-bold text-gray-900 dark:text-white">{config.name}</h3>
                          {config.isDefault && (
                            <span className="px-2 py-0.5 text-xs bg-violet-600 text-white rounded-full">默认</span>
                          )}
                          <span className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full">
                            {providers.find(p => p.id === config.provider)?.name || config.provider}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                          API: {config.apiUrl}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          模型: {config.model}
                        </p>
                        {testResult?.id === config.id && (
                          <p className={`text-sm mt-2 ${testResult.success ? "text-green-600" : "text-red-600"}`}>
                            {testResult.message}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => handleTest(config)}
                          disabled={testing === config.id}
                          className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                        >
                          {testing === config.id ? "测试中..." : "测试"}
                        </button>
                        {!config.isDefault && (
                          <button
                            onClick={() => handleSetDefault(config.id)}
                            className="px-3 py-1.5 text-sm bg-violet-100 dark:bg-violet-900 text-violet-600 dark:text-violet-400 rounded-lg hover:bg-violet-200 dark:hover:bg-violet-800 transition-colors"
                          >
                            设为默认
                          </button>
                        )}
                        <button
                          onClick={() => handleEdit(config)}
                          className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(config.id)}
                          className="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {loginMessage && (
                <div className="p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl text-amber-700 dark:text-amber-300 text-sm">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    {loginMessage}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  配置名称
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例如：我的DeepSeek配置"
                  className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  AI 平台
                </label>
                {loading && providers.length === 0 ? (
                  <div className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500">
                    加载中...
                  </div>
                ) : providers.length === 0 ? (
                  <div className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500">
                    请先登录获取平台列表
                  </div>
                ) : (
                  <select
                    value={formData.provider}
                    onChange={e => handleProviderChange(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                    required
                  >
                    {providers.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
                {providers.length > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    选择平台后会自动填充API地址
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  API 地址
                </label>
                <input
                  type="text"
                  value={formData.apiUrl}
                  onChange={e => setFormData({ ...formData, apiUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-violet-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={formData.apiKey}
                  onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-violet-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  模型
                </label>
                <input
                  type="text"
                  value={formData.model}
                  onChange={e => setFormData({ ...formData, model: e.target.value })}
                  placeholder="例如：gpt-6-astra、claude-opus-5、qwen3.8-max"
                  className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">可直接输入模型名称，如 gpt-6-astra、claude-opus-5、gemini-3.8-flash</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Temperature: {formData.temperature}
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={formData.temperature}
                  onChange={e => setFormData({ ...formData, temperature: parseInt(e.target.value) })}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>精确</span>
                  <span>创意</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  最大 Tokens: {formData.maxTokens}
                </label>
                <input
                  type="range"
                  min="1000"
                  max="8000"
                  step="500"
                  value={formData.maxTokens}
                  onChange={e => setFormData({ ...formData, maxTokens: parseInt(e.target.value) })}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={formData.isDefault}
                  onChange={e => setFormData({ ...formData, isDefault: e.target.checked })}
                  className="w-4 h-4 text-violet-600 border-gray-300 rounded focus:ring-violet-500"
                />
                <label htmlFor="isDefault" className="text-sm text-gray-700 dark:text-gray-300">
                  设为默认配置
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setActiveTab("list"); setEditingConfig(null); }}
                  className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl hover:from-violet-700 hover:to-purple-700 disabled:opacity-50 transition-colors font-medium"
                >
                  {loading ? "保存中..." : "保存配置"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
