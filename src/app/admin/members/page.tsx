"use client";

import { useState, useEffect, useCallback } from "react";
import { authApi } from "@/lib/api/client";
import { getToken } from "@/lib/get-token";
import { formatYuan } from "@/lib/price";
import { useRouter } from "next/navigation";

interface MemberLevel {
  id: string;
  code: string;
  name: string;
  price: number;
  duration: number;
  description?: string;
  features?: string[];
  chapterLimit?: number;
  storageLimit?: number;
  isActive?: boolean;
  sortOrder?: number;
}

interface Member {
  id: string;
  username: string;
  email: string;
  nickname: string | null;
  avatar: string | null;
  memberLevelId: string | null;
  memberLevelName: string;
  memberLevelCode: string | null;
  memberStatus: string;
  memberExpireAt: string | null;
  isActive: boolean;
  ordersCount: number;
  novelsCount: number;
  totalChaptersUsed?: number;
  chapterLimit?: number;
  remainingChapters?: number;
  _originalChapterLimit?: number | null;
  createdAt: string;
}

interface MemberDetail {
  id: string;
  username: string;
  email: string;
  nickname: string | null;
  avatar: string | null;
  memberLevelId: string | null;
  memberLevelName: string;
  memberLevelCode: string | null;
  memberLevel: MemberLevel | null;
  memberStatus: string;
  memberExpireAt: string | null;
  isActive: boolean;
  totalChaptersUsed?: number;
  chapterLimit?: number;
  _originalChapterLimit?: number | null;
  remainingChapters?: number;
  orders: any[];
  novelsCount: number;
  createdAt: string;
}

interface Order {
  id: string;
  orderNo: string;
  userId: string;
  username: string;
  email: string;
  memberLevelId: string;
  levelName: string;
  levelCode: string;
  amount: number;
  paymentMethod: string;
  paymentStatus: string;
  paymentTime: string | null;
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
}

export default function AdminMembersPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"members" | "orders" | "levels" | "payments" | "invite-codes">("members");
  const [members, setMembers] = useState<Member[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [selectedMember, setSelectedMember] = useState<MemberDetail | null>(null);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [memberLevels, setMemberLevels] = useState<MemberLevel[]>([]);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterLevel, setFilterLevel] = useState("all");
  const [orderFilterStatus, setOrderFilterStatus] = useState("all");
  const [orderSearchKeyword, setOrderSearchKeyword] = useState("");
  const [editingLevel, setEditingLevel] = useState<MemberLevel | null>(null);
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [paymentStats, setPaymentStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // 邀请码管理状态
  const [inviteCodes, setInviteCodes] = useState<any[]>([]);
  const [inviteCodeTotal, setInviteCodeTotal] = useState(0);
  const [inviteCounts, setInviteCounts] = useState<Record<string, number>>({});
  const [inviteCodeLoading, setInviteCodeLoading] = useState(false);
  const [showInviteCodeModal, setShowInviteCodeModal] = useState(false);
  const [editInviteCode, setEditInviteCode] = useState<any>(null);
  const [newInviteCode, setNewInviteCode] = useState({
    code: "", description: "", memberLevelId: "", expiresAt: "",
  });

  // 检查登录状态
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await authApi.me() as any;
        if (!user || user.role !== "admin") {
          router.push("/auth/login");
          return;
        }
        setCurrentUser(user);
        await loadMemberLevels();
      } catch (error) {
        console.error("认证检查失败:", error);
        router.push("/auth/login");
      }
    };
    checkAuth();
  }, [router]);

  // 加载会员等级
  const loadMemberLevels = async () => {
    try {
      const token = getToken();
      const response = await fetch("/api/admin/member-levels", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json();
      if (data.success) {
        setMemberLevels(data.data);
      }
    } catch (error) {
      console.error("加载会员等级失败:", error);
    }
  };
  
  // 删除会员等级
  const handleDeleteLevel = async (id: string) => {
    if (!confirm("确定要删除这个会员等级吗？")) {
      return;
    }
    try {
      const token = getToken();
      const response = await fetch(`/api/admin/levels/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (data.success) {
        alert("会员等级删除成功！");
        await loadMemberLevels();
      } else {
        alert(data.error || "删除失败");
      }
    } catch (error) {
      console.error("删除等级失败:", error);
      alert("删除等级失败");
    }
  };

  // 调整会员等级排序（上移/下移），交换后归一化为 1..n，避免出现相同排序号
  const handleMoveLevel = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= memberLevels.length) return;

    const ordered = [...memberLevels];
    const tmp = ordered[index];
    ordered[index] = ordered[target];
    ordered[target] = tmp;

    try {
      const token = getToken();
      const changed = ordered
        .map((level, i) => ({ level, sortOrder: i + 1 }))
        .filter(({ level, sortOrder }) => Number(level.sortOrder) !== sortOrder);
      if (changed.length === 0) return;

      for (const { level, sortOrder } of changed) {
        await fetch(`/api/admin/levels/${level.id}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sortOrder }),
        });
      }
      await loadMemberLevels();
    } catch (error) {
      console.error("调整排序失败:", error);
      alert("调整排序失败");
    }
  };

  // 加载会员列表
  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      const response = await fetch("/api/admin/members", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setMembers(data.data.members || data.data);
      }
    } catch (error) {
      console.error("加载会员列表失败:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载订单列表
  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      const response = await fetch("/api/admin/orders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setOrders(data.data.orders || data.data);
      }
    } catch (error) {
      console.error("加载订单列表失败:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载支付统计
  const loadPaymentStats = async () => {
    setStatsLoading(true);
    try {
      const token = getToken();
      const response = await fetch("/api/admin/stats/payments", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setPaymentStats(data.data);
      }
    } catch (error) {
      console.error("加载支付统计失败:", error);
    } finally {
      setStatsLoading(false);
    }
  };

  // 加载邀请码列表
  const loadInviteCodes = useCallback(async () => {
    setInviteCodeLoading(true);
    try {
      const token = getToken();
      const response = await fetch("/api/admin/invite-codes?pageSize=100", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setInviteCodes(data.data.codes || []);
        setInviteCodeTotal(data.data.total || 0);
      }
    } catch (error) {
      console.error("加载邀请码列表失败:", error);
    } finally {
      setInviteCodeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      if (activeTab === "members") {
        loadMembers();
      } else if (activeTab === "orders") {
        loadOrders();
      } else if (activeTab === "payments") {
        loadPaymentStats();
      } else if (activeTab === "invite-codes") {
        loadInviteCodes();
      }
    }
  }, [currentUser, activeTab, loadMembers, loadOrders, loadInviteCodes]);

  // 查看会员详情
  const handleViewMember = async (id: string) => {
    try {
      const token = getToken();
      const response = await fetch(`/api/admin/members/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setSelectedMember(data.data);
        setShowMemberModal(true);
      }
    } catch (error) {
      console.error("获取会员详情失败:", error);
    }
  };

  // 更新会员状态
  const handleUpdateMember = async (id: string, updates: any) => {
    try {
      const token = getToken();
      const response = await fetch(`/api/admin/members/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });
      const data = await response.json();
      if (data.success) {
        alert("会员信息更新成功！");
        await loadMembers();
        if (selectedMember?.id === id) {
          handleViewMember(id);
        }
      } else {
        alert(data.error || "更新失败");
      }
    } catch (error) {
      console.error("更新会员失败:", error);
      alert("更新失败，请重试");
    }
  };

  // 更新会员等级
  const handleUpdateLevel = async (id: string, updates: any) => {
    try {
      const token = getToken();
      const response = await fetch(`/api/admin/levels/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });
      const data = await response.json();
      if (data.success) {
        alert("会员等级更新成功！");
        await loadMemberLevels();
        setShowLevelModal(false);
        setEditingLevel(null);
      } else {
        alert(data.error || "更新失败");
      }
    } catch (error) {
      console.error("更新等级失败:", error);
      alert("更新等级失败");
    }
  };

  // 新增会员等级
  const handleCreateLevel = async (payload: any) => {
    try {
      const token = getToken();
      const response = await fetch("/api/admin/member-levels", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (data.success) {
        alert("会员等级创建成功！");
        await loadMemberLevels();
        setShowLevelModal(false);
        setEditingLevel(null);
      } else {
        alert(data.error || "创建失败");
      }
    } catch (error) {
      console.error("创建等级失败:", error);
      alert("创建等级失败");
    }
  };

  // 查看订单详情
  const handleViewOrder = async (id: string) => {
    try {
      const token = getToken();
      const response = await fetch(`/api/admin/orders/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setSelectedOrder(data.data);
        setShowOrderModal(true);
      }
    } catch (error) {
      console.error("加载订单详情失败:", error);
    }
  };

  // 更新订单状态
  const handleUpdateOrder = async (id: string, updates: any) => {
    try {
      const token = getToken();
      const response = await fetch(`/api/admin/orders/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });
      const data = await response.json();
      if (data.success) {
        alert("订单更新成功！");
        setShowOrderModal(false);
        setSelectedOrder(null);
        await loadOrders();
        await loadPaymentStats();
      } else {
        alert(data.error || "更新失败");
      }
    } catch (error) {
      console.error("更新订单失败:", error);
      alert("更新订单失败");
    }
  };

  // 删除会员
  const handleDeleteMember = async (id: string) => {
    if (!confirm("确定要删除该会员吗？此操作不可恢复！")) {
      return;
    }
    try {
      const token = getToken();
      const response = await fetch(`/api/admin/members/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        alert("会员删除成功！");
        await loadMembers();
        setShowMemberModal(false);
      } else {
        alert(data.error || "删除失败");
      }
    } catch (error) {
      console.error("删除会员失败:", error);
      alert("删除失败，请重试");
    }
  };

  // 切换邀请码状态
  const handleToggleInviteCode = async (id: string, isActive: boolean) => {
    try {
      const token = getToken();
      const response = await fetch(`/api/admin/invite-codes/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isActive }),
      });
      const data = await response.json();
      if (data.success) {
        await loadInviteCodes();
      } else {
        alert(data.error || "操作失败");
      }
    } catch (error) {
      console.error("更新邀请码状态失败:", error);
      alert("操作失败");
    }
  };

  // 删除邀请码
  const handleDeleteInviteCode = async (id: string) => {
    if (!confirm("确定要删除该邀请码吗？")) return;
    try {
      const token = getToken();
      const response = await fetch(`/api/admin/invite-codes/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        await loadInviteCodes();
      } else {
        alert(data.error || "删除失败");
      }
    } catch (error) {
      console.error("删除邀请码失败:", error);
      alert("删除失败");
    }
  };

  // 创建邀请码
  const handleCreateInviteCode = async () => {
    try {
      const token = getToken();
      // 根据 memberLevelId 查找 levelType
      const selectedLevel = memberLevels.find((l: any) => l.id === newInviteCode.memberLevelId);
      const body: any = {
        code: newInviteCode.code,
        description: newInviteCode.description || undefined,
        memberLevelId: newInviteCode.memberLevelId || undefined,
        levelType: selectedLevel?.code || undefined,
      };
      if (newInviteCode.expiresAt) {
        body.expiresAt = new Date(newInviteCode.expiresAt).toISOString();
      }
      const response = await fetch("/api/admin/invite-codes", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (data.success) {
        alert("邀请码创建成功！");
        setShowInviteCodeModal(false);
        await loadInviteCodes();
      } else {
        alert(data.error || "创建失败");
      }
    } catch (error) {
      console.error("创建邀请码失败:", error);
      alert("创建失败");
    }
  };

  // 快速生成指定等级的邀请码（支持自定义数量，1-100 个）
  const handleQuickCreateInvite = async (levelCode: string, count: number = 1) => {
    const level = memberLevels.find((l: any) => l.code === levelCode);
    if (!level) {
      alert("未找到对应的会员等级");
      return;
    }
    const total = Math.max(1, Math.min(100, Math.floor(Number(count) || 1)));
    const token = getToken();
    let success = 0;
    let failed = 0;

    for (let i = 0; i < total; i++) {
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        const code = levelCode.toUpperCase() + Math.random().toString(36).substring(2, 8).toUpperCase();
        try {
          const response = await fetch("/api/admin/invite-codes", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify({
              code,
              maxUses: 1,
              description: level.name + "邀请码",
              memberLevelId: level.id,
              levelType: levelCode,
            }),
          });
          const data = await response.json();
          if (data.success) {
            ok = true;
            success++;
          }
        } catch {
          // 失败自动重试
        }
      }
      if (!ok) failed++;
    }

    await loadInviteCodes();
    if (failed === 0) {
      alert("已生成 " + success + " 个「" + level.name + "」邀请码");
    } else {
      alert("已生成 " + success + " 个，失败 " + failed + " 个");
    }
  };

  // 复制邀请码
  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      // 简单的成功提示
      const tempDiv = document.createElement('div');
      tempDiv.className = 'fixed top-4 right-4 z-50 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg';
      tempDiv.textContent = '已复制: ' + code;
      document.body.appendChild(tempDiv);
      setTimeout(() => tempDiv.remove(), 2000);
    } catch (err) {
      console.error('复制失败:', err);
      alert('复制失败，请手动复制');
    }
  };

  // 导出邀请码为 CSV（带 BOM，Excel 可直接打开；可传全部或单个）
  const exportInviteCodes = (rows: any[], filename: string) => {
    const esc = (v: any) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const statusText = (c: any) =>
      c.status === "used_up" ? "已用完" : c.status === "disabled" ? "已禁用" : c.status === "expired" ? "已过期" : "可用";
    const levelName = (c: any) => {
      const lv = memberLevels.find((l: any) => l.code === c.levelType);
      return lv ? lv.name : c.levelType || "-";
    };
    const timeText = (v: any) => (v ? new Date(v).toLocaleString("zh-CN") : "永久");
    const header = ["邀请码", "等级类型", "说明", "使用状态", "状态", "过期时间", "创建时间"];
    const body = rows.map((c: any) =>
      [
        c.code,
        levelName(c),
        c.description || "",
        c.isUsedUp ? "已使用" : "未使用",
        statusText(c),
        c.expiresAt ? timeText(c.expiresAt) : "永久",
        c.createdAt ? timeText(c.createdAt) : "",
      ]
        .map(esc)
        .join(",")
    );
    const csv = "\uFEFF" + [header.map(esc).join(",")].concat(body).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 筛选会员
  const filteredMembers = members.filter((member) => {
    const matchSearch =
      searchKeyword === "" ||
      member.username.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      member.email.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      (member.nickname && member.nickname.toLowerCase().includes(searchKeyword.toLowerCase()));

    const matchStatus = filterStatus === "all" || member.memberStatus === filterStatus;
    const matchLevel = filterLevel === "all" || member.memberLevelCode === filterLevel;

    return matchSearch && matchStatus && matchLevel;
  });

  // 筛选订单
  const filteredOrders = orders.filter((order) => {
    const matchSearch =
      orderSearchKeyword === "" ||
      order.orderNo.toLowerCase().includes(orderSearchKeyword.toLowerCase()) ||
      order.username.toLowerCase().includes(orderSearchKeyword.toLowerCase()) ||
      order.email.toLowerCase().includes(orderSearchKeyword.toLowerCase());

    const matchStatus = orderFilterStatus === "all" || order.paymentStatus === orderFilterStatus;

    return matchSearch && matchStatus;
  });

  // 获取支付方式文本
  const getPaymentMethodText = (method: string | null) => {
    switch (method) {
      case "wechat": return "微信支付";
      case "alipay": return "支付宝";
      case "third_party": return "银联支付";
      default: return method || "-";
    }
  };

  // 获取支付方式颜色
  const getPaymentMethodColor = (method: string | null) => {
    switch (method) {
      case "wechat": return "text-green-600 bg-green-50";
      case "alipay": return "text-blue-600 bg-blue-50";
      case "third_party": return "text-purple-600 bg-purple-50";
      default: return "text-gray-400 bg-white/5";
    }
  };

  // 格式化金额
  const formatAmount = (amount: number) => {
    return `¥${formatYuan(amount)}`;
  };

  // 格式化日期时间
  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleString("zh-CN");
  };
  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
      case "completed":
      case "paid":
        return "bg-green-500/15 text-green-300 ring-1 ring-green-500/30";
      case "expired":
      case "failed":
        return "bg-red-500/15 text-red-300 ring-1 ring-red-500/30";
      case "pending":
      case "inactive":
        return "bg-white/10 text-gray-300 ring-1 ring-white/10";
      case "processing":
        return "bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/30";
      default:
        return "bg-white/10 text-gray-300 ring-1 ring-white/10";
    }
  };

  // 获取状态文本
  const getStatusText = (status: string) => {
    switch (status) {
      case "active":
      case "completed":
      case "paid":
        return "已完成";
      case "expired":
      case "failed":
        return "已失败";
      case "pending":
      case "inactive":
        return "待支付";
      case "processing":
        return "处理中";
      default:
        return status;
    }
  };

  // 获取等级标签样式
  const getLevelStyle = (code: string | null) => {
    switch (code) {
      case "svip":
        return "bg-purple-500/15 text-purple-300";
      case "vip":
        return "bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/30";
      case "free":
      default:
        return "bg-white/10 text-gray-300 ring-1 ring-white/10";
    }
  };

  // 格式化日期
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("zh-CN");
  };

  return (
    <div>
      {/* 内部Tab导航 */}
      <div className="flex gap-1.5 mb-6 p-1.5 rounded-2xl border border-white/5 overflow-x-auto" style={{ background: 'rgba(255,255,255,0.03)' }}>
        <button
          onClick={() => setActiveTab("members")}
          className={`flex items-center justify-center gap-1.5 flex-1 py-2.5 px-2 text-sm font-medium rounded-xl transition-all duration-200 whitespace-nowrap ${
            activeTab === "members"
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/20"
              : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
          }`}
        >
          <span className="text-base">👥</span> 会员管理
        </button>
        <button
          onClick={() => setActiveTab("orders")}
          className={`flex items-center justify-center gap-1.5 flex-1 py-2.5 px-2 text-sm font-medium rounded-xl transition-all duration-200 whitespace-nowrap ${
            activeTab === "orders"
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/20"
              : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
          }`}
        >
          <span className="text-base">📋</span> 订单管理
        </button>
        <button
          onClick={() => setActiveTab("levels")}
          className={`flex items-center justify-center gap-1.5 flex-1 py-2.5 px-2 text-sm font-medium rounded-xl transition-all duration-200 whitespace-nowrap ${
            activeTab === "levels"
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/20"
              : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
          }`}
        >
          <span className="text-base">⭐</span> 会员等级
        </button>
        <button
          onClick={() => setActiveTab("payments")}
          className={`flex items-center justify-center gap-1.5 flex-1 py-2.5 px-2 text-sm font-medium rounded-xl transition-all duration-200 whitespace-nowrap ${
            activeTab === "payments"
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/20"
              : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
          }`}
        >
          <span className="text-base">💰</span> 支付统计
        </button>
        <button
          onClick={() => setActiveTab("invite-codes")}
          className={`flex items-center justify-center gap-1.5 flex-1 py-2.5 px-2 text-sm font-medium rounded-xl transition-all duration-200 whitespace-nowrap ${
            activeTab === "invite-codes"
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/20"
              : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
          }`}
        >
          <span className="text-base">🔑</span> 邀请码
        </button>
      </div>
        {/* 会员管理Tab */}
        {activeTab === "members" && (
          <div className="backdrop-blur-xl rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="p-6 border-b border-white/8">
              <div className="flex flex-col sm:flex-row gap-4">
                {/* 搜索框 */}
                <div className="flex-1 relative">
                  <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="搜索用户名、邮箱、昵称..."
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    className="w-full pl-10 pr-10 py-2.5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 bg-white/5 text-white placeholder:text-gray-500 transition-all"
                  />
                  {searchKeyword && (
                    <button
                      onClick={() => setSearchKeyword("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-200 hover:bg-white/10 rounded-full transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* 状态筛选 */}
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-4 py-2.5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 bg-white/5 text-white transition-all text-sm"
                >
                  <option className="bg-gray-900 text-white" value="all">全部状态</option>
                  <option className="bg-gray-900 text-white" value="active">有效</option>
                  <option className="bg-gray-900 text-white" value="expired">已过期</option>
                  <option className="bg-gray-900 text-white" value="inactive">未开通</option>
                </select>

                {/* 等级筛选 */}
                <select
                  value={filterLevel}
                  onChange={(e) => setFilterLevel(e.target.value)}
                  className="px-4 py-2.5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 bg-white/5 text-white transition-all text-sm"
                >
                  <option className="bg-gray-900 text-white" value="all">全部等级</option>
                  {memberLevels.map((level) => (
                    <option className="bg-gray-900 text-white" key={level.id} value={level.code}>
                      {level.name}
                    </option>
                  ))}
                </select>

                {/* 刷新按钮 */}
                <button
                  onClick={loadMembers}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl hover:from-violet-700 hover:to-indigo-700 shadow-sm shadow-violet-500/20 transition-all text-sm font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  刷新
                </button>
              </div>

              {/* 统计信息 */}
              <div className="mt-5 flex flex-wrap gap-3">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-xl text-sm">
                  <span className="text-blue-400 font-medium">总会员数</span>
                  <span className="text-blue-300 font-bold">{members.length}</span>
                </div>
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-xl text-sm">
                  <span className="text-green-400 font-medium">有效</span>
                  <span className="text-green-300 font-bold">{members.filter((m) => m.memberStatus === "active").length}</span>
                </div>
                {memberLevels.map((level) => (
                  <div key={level.id} className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/8 rounded-xl text-sm">
                    <span className="text-gray-400 font-medium">{level.name}</span>
                    <span className="text-gray-200 font-bold">{members.filter((m) => m.memberLevelCode === level.code).length}</span>
                  </div>
                ))}
              </div>
              
              {/* 用户会员数据修复区域 */}
              <div className="mt-5 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                <h4 className="text-sm font-semibold text-red-400 mb-3">🔧 用户会员数据修复</h4>
                <p className="text-xs text-red-400 mb-3">如果用户激活邀请码后显示的到期日期异常（如 2100年），请使用此功能修复</p>
                <button
                  onClick={async () => {
                    if (!confirm("确定要检查并修复所有用户的会员数据吗？\n\n这会将异常的到期日期重新设置为从今天算起的合理时长。")) {
                      return;
                    }
                    try {
                      const token = getToken();
                      const response = await fetch("/api/admin/fix-user-membership", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        },
                      });
                      const data = await response.json();
                      if (data.success) {
                        alert("修复成功！\n\n" + data.message + "\n\n修复详情请查看浏览器控制台。");
                        await loadMembers();
                      } else {
                        alert("修复失败: " + (data.error || "未知错误"));
                      }
                    } catch (error) {
                      console.error("修复用户会员数据失败:", error);
                      alert("修复失败，请查看控制台");
                    }
                  }}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm font-medium"
                >
                  修复异常的会员到期日期
                </button>
              </div>
            </div>

            {/* 会员列表 */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-white/5">
                <thead className="bg-white/5">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">用户信息</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">会员等级</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">会员状态</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">章节使用</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">注册时间</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="animate-spin w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full" />
                          <span className="text-sm text-gray-400">加载中...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span className="text-sm text-gray-400">暂无会员数据</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredMembers.map((member) => (
                      <tr key={member.id} className="hover:bg-white/5 transition-colors duration-150">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-full flex items-center justify-center text-white font-bold">
                              {member.avatar ? (
                                <img className="w-10 h-10 rounded-full object-cover" src={member.avatar} alt="" />
                              ) : (
                                <span>{member.nickname?.[0] || member.username[0].toUpperCase()}</span>
                              )}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-white">{member.nickname || member.username}</div>
                              <div className="text-sm text-gray-400">{member.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-3 py-1.5 text-xs font-bold rounded-lg ${getLevelStyle(member.memberLevelCode)}`}>
                            {member.memberLevelName}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg ${getStatusColor(member.memberStatus)}`}>
                            {getStatusText(member.memberStatus)}
                          </span>
                          {member.memberExpireAt && (
                            <div className="text-xs text-gray-400 mt-1.5">
                              到期: {formatDate(member.memberExpireAt)}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-[100px]">
                              {member._originalChapterLimit === 0 ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-white">{member.totalChaptersUsed ?? 0}</span>
                                  <span className="text-xs text-green-400 font-medium bg-green-500/15 px-2 py-0.5 rounded-full">无限制</span>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-medium text-white">{member.totalChaptersUsed ?? 0}</span>
                                    <span className="text-xs text-gray-400">/ {member.chapterLimit ?? 11} 章</span>
                                  </div>
                                  <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-300 ${
                                        (member.remainingChapters !== undefined && member.remainingChapters < 5)
                                          ? "bg-red-400"
                                          : "bg-blue-500"
                                      }`}
                                      style={{ width: `${Math.min(100, ((member.totalChaptersUsed ?? 0) / (member.chapterLimit ?? 11)) * 100)}%` }}
                                    />
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                          {(member.remainingChapters !== undefined && member.remainingChapters < 5 && member._originalChapterLimit !== 0) && (
                            <div className="text-xs text-red-500 mt-1 font-medium">剩余 {member.remainingChapters} 章</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(member.createdAt)}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleViewMember(member.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 hover:text-blue-700 transition-all"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              详情
                            </button>
                            <button
                              onClick={() => handleUpdateMember(member.id, { isActive: !member.isActive })}
                              className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                                member.isActive
                                  ? "bg-red-50 text-red-600 hover:bg-red-100"
                                  : "bg-green-50 text-green-600 hover:bg-green-100"
                              }`}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={member.isActive ? "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" : "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"} />
                              </svg>
                              {member.isActive ? "禁用" : "启用"}
                            </button>
                            {member.id !== currentUser?.id && (
                              <button
                                onClick={() => handleDeleteMember(member.id)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-all"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                删除
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 订单管理Tab */}
        {activeTab === "orders" && (
          <div className="backdrop-blur-xl rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="p-6 border-b border-white/8">
              <div className="flex flex-col sm:flex-row gap-4">
                {/* 搜索框 */}
                <div className="flex-1 relative">
                  <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="搜索订单号、用户名、邮箱..."
                    value={orderSearchKeyword}
                    onChange={(e) => setOrderSearchKeyword(e.target.value)}
                    className="w-full pl-10 pr-10 py-2.5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 bg-white/5 text-white placeholder:text-gray-500 transition-all"
                  />
                  {orderSearchKeyword && (
                    <button
                      onClick={() => setOrderSearchKeyword("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-200 hover:bg-white/10 rounded-full transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* 状态筛选 */}
                <select
                  value={orderFilterStatus}
                  onChange={(e) => setOrderFilterStatus(e.target.value)}
                  className="px-4 py-2.5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 bg-white/5 text-white transition-all text-sm"
                >
                  <option className="bg-gray-900 text-white" value="all">全部状态</option>
                  <option className="bg-gray-900 text-white" value="pending">待支付</option>
                  <option className="bg-gray-900 text-white" value="completed">已完成</option>
                  <option className="bg-gray-900 text-white" value="failed">已失败</option>
                </select>

                {/* 刷新按钮 */}
                <button
                  onClick={loadOrders}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl hover:from-violet-700 hover:to-indigo-700 shadow-sm shadow-violet-500/20 transition-all text-sm font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  刷新
                </button>
              </div>

              {/* 统计信息 */}
              <div className="mt-5 flex flex-wrap gap-3">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-xl text-sm">
                  <span className="text-blue-500 font-medium">总订单数</span>
                  <span className="text-blue-700 font-bold">{orders.length}</span>
                </div>
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-50 rounded-xl text-sm">
                  <span className="text-yellow-500 font-medium">待支付</span>
                  <span className="text-yellow-700 font-bold">{orders.filter((o) => o.paymentStatus === "pending").length}</span>
                </div>
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 rounded-xl text-sm">
                  <span className="text-green-500 font-medium">已完成</span>
                  <span className="text-green-700 font-bold">{orders.filter((o) => o.paymentStatus === "completed").length}</span>
                </div>
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-sm">
                  <span className="text-red-400 font-medium">已失败</span>
                  <span className="text-red-400 font-bold">{orders.filter((o) => o.paymentStatus === "failed").length}</span>
                </div>
              </div>
            </div>

            {/* 订单列表 */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-white/5">
                <thead className="bg-white/5">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">订单号</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">用户信息</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">会员等级</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">金额</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">支付方式</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">状态</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">创建时间</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                        加载中...
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                        暂无订单数据
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-white/5">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-300">
                          {order.orderNo}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-white">
                            {order.username || "未知用户"}
                          </div>
                          <div className="text-sm text-gray-500">{order.email || "-"}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${getLevelStyle(order.levelCode)}`}>
                            {order.levelName}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                          ¥{formatYuan(order.amount)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.paymentMethod || "-"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(order.paymentStatus)}`}>
                            {getStatusText(order.paymentStatus)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDate(order.createdAt)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => handleViewOrder(order.id)}
                            className="text-blue-600 hover:text-blue-800 mr-3"
                          >
                            详情
                          </button>
                          {order.paymentStatus === "pending" && (
                            <>
                              <button
                                onClick={() => {
                                  if (confirm("确定标记该订单为已支付？")) {
                                    handleUpdateOrder(order.id, { paymentStatus: "paid" });
                                  }
                                }}
                                className="text-green-600 hover:text-green-800 mr-3"
                              >
                                标记已付
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm("确定取消该订单？")) {
                                    handleUpdateOrder(order.id, { paymentStatus: "cancelled" });
                                  }
                                }}
                                className="text-red-600 hover:text-red-800"
                              >
                                取消
                              </button>
                            </>
                          )}
                          {order.paymentStatus === "completed" && (
                            <button
                              onClick={() => {
                                if (confirm("确定退款该订单？")) {
                                  handleUpdateOrder(order.id, { paymentStatus: "refunded" });
                                }
                              }}
                              className="text-orange-600 hover:text-orange-800"
                            >
                              退款
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 会员等级Tab */}
        {activeTab === "levels" && (
          <div className="backdrop-blur-xl rounded-2xl border border-white/8 p-6" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <h2 className="text-xl font-semibold">会员等级管理</h2>
              <button
                onClick={() => {
                  setEditingLevel(null);
                  setShowLevelModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl hover:from-violet-500 hover:to-indigo-500 text-sm font-semibold shadow-lg shadow-violet-500/20 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                新增会员等级
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {memberLevels.map((level, levelIndex) => (
                <div key={level.id} className="border border-white/10 rounded-xl p-6 hover:border-white/20 hover:shadow-lg transition-shadow bg-white/3">
                  <div className="flex items-center justify-between mb-4">
                    <span className={`px-3 py-1 text-sm font-medium rounded-full ${getLevelStyle(level.code)}`}>
                      {level.code.toUpperCase()}
                    </span>
                    <span className="text-2xl font-bold text-white">
                      ¥{formatYuan(level.price)}
                    </span>
                  </div>
                  
                  <h3 className="text-lg font-bold text-white mb-2">{level.name}</h3>
                  
                  {level.description && (
                    <p className="text-sm text-gray-500 mb-4">{level.description}</p>
                  )}
                  
                  <div className="text-sm text-gray-600 mb-4">
                    <span className="font-medium">时长:</span> {level.duration === 365 ? '1年' : level.duration === 30 ? '1个月' : `${level.duration}天`}
                  </div>
                  
                  {level.features && level.features.length > 0 && (
                    <div className="border-t pt-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">功能特权:</h4>
                      <ul className="space-y-2">
                        {level.features.map((feature, index) => (
                          <li key={index} className="flex items-center text-sm text-gray-600">
                            <svg className="w-4 h-4 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                            </svg>
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  <div className="mt-4 pt-4 border-t space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-blue-600">章节上限</span>
                      <span className="text-lg font-bold text-blue-600">{level.chapterLimit || 10} 章</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>排序: {level.sortOrder}</span>
                      <span>状态: {level.isActive ? "启用" : "禁用"}</span>
                    </div>
                  </div>
                  
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => handleMoveLevel(levelIndex, -1)}
                      disabled={levelIndex === 0}
                      title="上移"
                      className="px-2.5 py-2 bg-white/8 text-gray-200 rounded-lg hover:bg-white/15 transition-colors text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleMoveLevel(levelIndex, 1)}
                      disabled={levelIndex === memberLevels.length - 1}
                      title="下移"
                      className="px-2.5 py-2 bg-white/8 text-gray-200 rounded-lg hover:bg-white/15 transition-colors text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => {
                        setEditingLevel(level);
                        setShowLevelModal(true);
                      }}
                      className="flex-1 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
                    >
                      ✏️ 编辑
                    </button>
                    {level.code !== 'free' && (
                      <button
                        onClick={() => handleDeleteLevel(level.id)}
                        className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium"
                      >
                        🗑️ 删除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            {/* 等级说明 */}
            <div className="mt-8 p-6 bg-white/5 border border-white/10 rounded-lg">
              <h3 className="text-lg font-semibold mb-4 text-white">等级说明</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                  <div className="flex items-center mb-2">
                    <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center mr-3">
                      <span className="text-sm font-bold text-white">F</span>
                    </div>
                    <span className="font-medium text-gray-200">免费用户</span>
                  </div>
                  <p className="text-sm text-gray-400">基础功能体验，可生成有限章节</p>
                </div>
                <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                  <div className="flex items-center mb-2">
                    <div className="w-8 h-8 bg-yellow-500/20 rounded-full flex items-center justify-center mr-3">
                      <span className="text-sm font-bold text-yellow-400">V</span>
                    </div>
                    <span className="font-medium text-gray-200">VIP会员</span>
                  </div>
                  <p className="text-sm text-gray-400">高级模板、优先生成、无限存储</p>
                </div>
                <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                  <div className="flex items-center mb-2">
                    <div className="w-8 h-8 bg-purple-500/20 rounded-full flex items-center justify-center mr-3">
                      <span className="text-sm font-bold text-purple-400">S</span>
                    </div>
                    <span className="font-medium text-gray-200">SVIP会员</span>
                  </div>
                  <p className="text-sm text-gray-400">全部功能、专属客服、无限生成</p>
                </div>
              </div>
            </div>

            {/* 调试修复区域 */}
            <div className="mt-8 p-6 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <h3 className="text-lg font-semibold mb-4 text-amber-400">🔧 会员等级数据调试与修复</h3>
              <p className="text-sm text-amber-400/80 mb-4">
                <strong>会员等级配置：</strong><br/>
                • 免费用户：永久（0天）<br/>
                • 创世纪VIP会员：月卡（30天）<br/>
                • 创世纪SVIP会员：年卡（365天）
              </p>
              
              <div className="space-y-4">
                <div className="flex gap-3">
                  <button
                    onClick={async () => {
                      try {
                        const token = getToken();
                        const response = await fetch("/api/admin/debug-levels", {
                          headers: token ? { Authorization: `Bearer ${token}` } : {},
                        });
                        const data = await response.json();
                        if (data.success) {
                          alert("当前会员等级数据:\n" + JSON.stringify(data.data, null, 2));
                        } else {
                          alert("获取数据失败: " + (data.error || "未知错误"));
                        }
                      } catch (error) {
                        console.error("获取会员等级数据失败:", error);
                        alert("获取数据失败，请查看控制台");
                      }
                    }}
                    className="px-4 py-2 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors text-sm font-medium"
                  >
                    查看当前等级数据
                  </button>
                  
                  <button
                    onClick={async () => {
                      if (!confirm("确定要修复所有会员等级的数据吗？\n\n这会更新：\n• 会员等级名称（添加'创世纪'前缀）\n• 免费用户：0天\n• VIP会员：30天\n• SVIP会员：365天")) {
                        return;
                      }
                      try {
                        const token = getToken();
                        const response = await fetch("/api/admin/fix-all-levels", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            ...(token ? { Authorization: `Bearer ${token}` } : {}),
                          },
                        });
                        const data = await response.json();
                        if (data.success) {
                          alert("修复成功！\n\n" + data.message + "\n\n请刷新页面查看效果。");
                          await loadMemberLevels();
                        } else {
                          alert("修复失败: " + (data.error || "未知错误"));
                        }
                      } catch (error) {
                        console.error("修复会员等级数据失败:", error);
                        alert("修复失败，请查看控制台");
                      }
                    }}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                  >
                    修复会员等级配置
                  </button>
                </div>
                
                <div className="text-xs text-amber-500">
                  <strong>说明:</strong> 如果会员等级的 duration 字段值不正确，会导致邀请码激活后的到期日期计算错误。
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 支付统计Tab */}
        {activeTab === "payments" && (
          <div>
            {/* 概览卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="backdrop-blur-xl rounded-xl p-6 border border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-500">总订单数</span>
                  <div className="w-10 h-10 bg-blue-500/15 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                </div>
                <div className="text-3xl font-bold text-white">{paymentStats?.totalOrders || 0}</div>
                <div className="text-xs text-gray-500 mt-1">全部订单</div>
              </div>
              <div className="backdrop-blur-xl rounded-xl p-6 border border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-500">已完成</span>
                  <div className="w-10 h-10 bg-green-500/15 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
                <div className="text-3xl font-bold text-green-600">{paymentStats?.completedOrders || 0}</div>
                <div className="text-xs text-gray-500 mt-1">支付成功</div>
              </div>
              <div className="backdrop-blur-xl rounded-xl p-6 border border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-500">总收入</span>
                  <div className="w-10 h-10 bg-purple-500/15 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
                <div className="text-3xl font-bold text-purple-600">
                  {paymentStats ? `¥${formatYuan(paymentStats.totalRevenue)}` : "¥0"}
                </div>
                <div className="text-xs text-gray-500 mt-1">累计收入</div>
              </div>
              <div className="backdrop-blur-xl rounded-xl p-6 border border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-500">待处理</span>
                  <div className="w-10 h-10 bg-yellow-500/15 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
                <div className="text-3xl font-bold text-yellow-600">{paymentStats?.pendingOrders || 0}</div>
                <div className="text-xs text-gray-500 mt-1">待支付订单</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* 支付方式统计 */}
              <div className="backdrop-blur-xl rounded-xl p-6 border border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <h3 className="text-lg font-semibold text-white mb-4">支付方式统计</h3>
                {paymentStats?.paymentMethodStats && paymentStats.paymentMethodStats.length > 0 ? (
                  <div className="space-y-4">
                    {paymentStats.paymentMethodStats.map((stat: any) => (
                      <div key={stat.method} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                        <div className="flex items-center gap-3">
                          <span className={`px-3 py-1 text-sm font-medium rounded-full ${getPaymentMethodColor(stat.method)}`}>
                            {getPaymentMethodText(stat.method)}
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-white">{stat.count}笔</div>
                          <div className="text-sm text-gray-500">{formatAmount(stat.total)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400">暂无支付数据</div>
                )}
              </div>

              {/* 订单状态分布 */}
              <div className="backdrop-blur-xl rounded-xl p-6 border border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <h3 className="text-lg font-semibold text-white mb-4">订单状态分布</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                    <span className="text-sm font-medium text-gray-400">待支付</span>
                    <span className="text-lg font-bold text-yellow-600">{paymentStats?.pendingOrders || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                    <span className="text-sm font-medium text-gray-400">已完成</span>
                    <span className="text-lg font-bold text-green-600">{paymentStats?.completedOrders || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                    <span className="text-sm font-medium text-gray-400">已失败/取消</span>
                    <span className="text-lg font-bold text-red-600">{paymentStats?.failedOrders || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-purple-500/10">
                    <span className="text-sm font-medium text-purple-400">总订单</span>
                    <span className="text-lg font-bold text-purple-600">{paymentStats?.totalOrders || 0}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 每日收入趋势 */}
            <div className="backdrop-blur-xl rounded-xl p-6 border border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <h3 className="text-lg font-semibold text-white mb-4">最近30天收入趋势</h3>
              {paymentStats?.dailyRevenue && paymentStats.dailyRevenue.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 text-sm font-medium text-gray-500">日期</th>
                        <th className="text-right py-2 text-sm font-medium text-gray-500">订单数</th>
                        <th className="text-right py-2 text-sm font-medium text-gray-500">收入</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentStats.dailyRevenue.map((day: any) => (
                        <tr key={day.date} className="border-b border-white/5 hover:bg-white/5">
                          <td className="py-2 text-sm text-gray-300">{day.date}</td>
                          <td className="py-2 text-sm text-right text-gray-400">{day.count}笔</td>
                          <td className="py-2 text-sm text-right font-medium text-green-600">{formatAmount(day.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">暂无收入数据</div>
              )}
            </div>

            {/* 刷新按钮 */}
            <div className="mt-6 text-center">
              <button
                onClick={loadPaymentStats}
                disabled={statsLoading}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {statsLoading ? "加载中..." : "刷新数据"}
              </button>
            </div>
          </div>
        )}

        {/* 邀请码管理Tab */}
        {activeTab === "invite-codes" && (
          <div className="space-y-6">
            {/* 操作栏 */}
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">邀请码管理</h2>
              <div className="flex gap-2">
                <button
                  onClick={loadInviteCodes}
                  disabled={inviteCodeLoading}
                  className="px-4 py-2 text-sm text-gray-300 border border-white/10 rounded-lg hover:bg-white/8 transition-colors"
                >
                  {inviteCodeLoading ? "加载中..." : "刷新"}
                </button>
                <button
                  onClick={() => exportInviteCodes(inviteCodes, "邀请码_全部_" + new Date().toISOString().slice(0, 10) + ".csv")}
                  disabled={inviteCodes.length === 0}
                  className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  导出全部 ({inviteCodes.length})
                </button>
              </div>
            </div>

                        {/* 快捷生成区：按会员等级动态生成 */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {memberLevels.filter((l: any) => l.code !== "free").length === 0 ? (
                <div className="col-span-full text-center py-8 text-gray-400 text-sm">
                  暂无会员等级，请先到「会员等级」新增
                </div>
              ) : (
                memberLevels.filter((l: any) => l.code !== "free").map((level: any) => {
                  const list = inviteCodes.filter((c: any) => c.levelType === level.code);
                  const activeCount = list.filter((c: any) => c.status === "active").length;
                  return (
                    <div key={level.id} className="backdrop-blur-xl rounded-xl border border-white/10 p-5" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div className="flex items-center justify-between gap-2 mb-4">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={"inline-flex items-center px-3 py-1 rounded-full text-xs font-bold shrink-0 " + getLevelStyle(level.code)}>
                            {level.code.toUpperCase()}
                          </span>
                          <span className="text-gray-400 text-sm truncate">{level.name}邀请码</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={inviteCounts[level.code] ?? 1}
                            onChange={(e) => {
                              const n = Math.max(1, Math.min(100, parseInt(e.target.value) || 1));
                              setInviteCounts({ ...inviteCounts, [level.code]: n });
                            }}
                            title="生成数量（1-100）"
                            className="w-14 px-2 py-1.5 text-xs text-center rounded-lg border border-white/15 bg-white/5 text-gray-200 focus:outline-none focus:border-violet-500"
                          />
                          <button
                            onClick={() => handleQuickCreateInvite(level.code, inviteCounts[level.code] ?? 1)}
                            className="px-3 py-2 text-xs text-white bg-violet-600 rounded-lg hover:bg-violet-500 transition-colors shadow-sm"
                          >
                            + 生成邀请码
                          </button>
                        </div>
                      </div>
                      <div className="text-sm text-gray-500 mb-3">
                        已有 {list.length} 个，可用 {activeCount} 个
                      </div>
                      <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {list.length === 0 ? (
                          <div className="text-center py-6 text-gray-400 text-sm">暂无邀请码</div>
                        ) : (
                          list.map((code: any) => (
                            <div
                              key={code.id}
                              className={"flex items-center justify-between px-3 py-2 rounded-lg border " + (code.status === "used_up" ? "bg-white/5 border-white/10" : code.status === "active" ? "bg-violet-500/10 border-violet-500/20" : "bg-white/5 border-white/10")}
                            >
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-sm font-bold text-gray-200">{code.code}</span>
                                {code.status === "used_up" && (
                                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-red-100 text-red-600">已用完</span>
                                )}
                                {code.status === "active" && (
                                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-500/15 text-green-400">可用</span>
                                )}
                                {code.status === "disabled" && (
                                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-white/10 text-gray-400">已禁用</span>
                                )}
                                {code.status === "expired" && (
                                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-orange-500/15 text-orange-400">已过期</span>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-gray-400">{code.isUsedUp ? "已使用" : "未使用"}</span>
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => handleCopyCode(code.code)}
                                    className="text-xs px-2 py-1 rounded bg-blue-500/15 text-blue-400 hover:bg-blue-500/25"
                                  >
                                    复制
                                  </button>
                                  <button
                                    onClick={() => exportInviteCodes([code], "邀请码_" + code.code + ".csv")}
                                    className="text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                                  >
                                    导出
                                  </button>
                                  <button
                                    onClick={() => handleToggleInviteCode(code.id, !code.isActive)}
                                    className={"text-xs px-2 py-1 rounded " + (code.isActive ? "bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25" : "bg-green-500/15 text-green-400 hover:bg-green-500/25")}
                                  >
                                    {code.isActive ? "禁用" : "启用"}
                                  </button>
                                  <button
                                    onClick={() => handleDeleteInviteCode(code.id)}
                                    className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                                  >
                                    删除
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* 全部邀请码表格 */}
            <div className="backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="px-5 py-4 border-b border-white/10 bg-white/5 flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">全部邀请码记录</h3>
                <button
                  onClick={() => {
                    setEditInviteCode(null);
                    setNewInviteCode({ code: "", description: "", memberLevelId: "", expiresAt: "" });
                    setShowInviteCodeModal(true);
                  }}
                  className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
                >
                  + 自定义新建
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/10">
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">邀请码</th>
                      <th className="text-center px-4 py-3 text-sm font-medium text-gray-400">等级类型</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">说明</th>
                      <th className="text-center px-4 py-3 text-sm font-medium text-gray-400">使用状态</th>
                      <th className="text-center px-4 py-3 text-sm font-medium text-gray-400">状态</th>
                      <th className="text-center px-4 py-3 text-sm font-medium text-gray-400">过期时间</th>
                      <th className="text-center px-4 py-3 text-sm font-medium text-gray-400">创建时间</th>
                      <th className="text-center px-4 py-3 text-sm font-medium text-gray-400">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inviteCodes.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-gray-400">暂无邀请码</td>
                      </tr>
                    ) : (
                      inviteCodes.map((code: any) => (
                        <tr key={code.id} className={`border-b border-white/5 hover:bg-white/5 ${
                          code.isUsedUp ? "bg-red-500/5" : ""
                        }`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-medium text-gray-200">{code.code}</span>
                              <button
                                onClick={() => handleCopyCode(code.code)}
                                className="text-xs px-2 py-1 rounded bg-blue-500/15 text-blue-400 hover:bg-blue-500/25"
                              >
                                复制
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-1 text-xs font-bold rounded-full ${
                              code.levelType === "vip" ? "bg-purple-500/15 text-purple-400" :
                              code.levelType === "svip" ? "bg-pink-500/15 text-pink-400" :
                              "bg-white/8 text-gray-400"
                            }`}>
                              {memberLevels.find((l: any) => l.code === code.levelType)?.name || (code.levelType ? code.levelType.toUpperCase() : "-")}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate">
                            {code.description || "-"}
                          </td>
                          <td className="px-4 py-3 text-center text-sm">
                            <span className={code.isUsedUp ? "text-red-500 font-medium" : "text-green-600"}>
                              {code.isUsedUp ? "已使用" : "未使用"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {code.isUsedUp ? (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-600">
                                已用完
                              </span>
                            ) : code.status === "expired" ? (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-600">
                                已过期
                              </span>
                            ) : code.isActive ? (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
                                可用
                              </span>
                            ) : (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-white/10 text-gray-400">
                                已禁用
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-gray-600">
                            {code.expiresAt ? formatDate(code.expiresAt) : "永久"}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-gray-600">
                            {formatDate(code.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleToggleInviteCode(code.id, !code.isActive)}
                                className={`text-xs px-2 py-1 rounded ${
                                  code.isActive
                                    ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                                    : "bg-green-100 text-green-700 hover:bg-green-200"
                                }`}
                              >
                                {code.isActive ? "禁用" : "启用"}
                              </button>
                              <button
                                onClick={() => exportInviteCodes([code], "邀请码_" + code.code + ".csv")}
                                className="text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                              >
                                导出
                              </button>
                              <button
                                onClick={() => handleDeleteInviteCode(code.id)}
                                className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                              >
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 bg-white/5 border-t border-white/10 text-sm text-gray-400 flex items-center gap-4">
                <span>共 {inviteCodeTotal} 个邀请码</span>
                {memberLevels
                  .filter((l: any) => l.code !== "free")
                  .map((l: any) => (
                    <span key={l.id}>• {l.name}: {inviteCodes.filter((c: any) => c.levelType === l.code).length} 个</span>
                  ))}
                <span>• 已用完: {inviteCodes.filter((c: any) => c.isUsedUp).length} 个</span>
              </div>
            </div>
          </div>
        )}

      {/* 订单详情弹窗 */}
      {showOrderModal && selectedOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="backdrop-blur-xl rounded-lg max-w-lg w-full border border-white/10" style={{ background: 'rgba(15,12,41,0.95)' }}>
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">订单详情</h2>
                <button
                  onClick={() => setShowOrderModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-white/5 rounded-lg p-4">
                <div className="text-sm text-gray-500 mb-1">订单号</div>
                <div className="text-sm font-mono font-medium text-gray-200 break-all">{selectedOrder.orderNo}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-sm text-gray-500 mb-1">金额</div>
                  <div className="text-lg font-bold text-white">{formatAmount(selectedOrder.amount)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-sm text-gray-500 mb-1">状态</div>
                  <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(selectedOrder.paymentStatus)}`}>
                    {getStatusText(selectedOrder.paymentStatus)}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-sm text-gray-500 mb-1">支付方式</div>
                  <div className="text-sm font-medium text-gray-200">
                    {getPaymentMethodText(selectedOrder.paymentMethod)}
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-sm text-gray-500 mb-1">支付时间</div>
                  <div className="text-sm text-gray-200">{formatDateTime(selectedOrder.paymentTime)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-sm text-gray-500 mb-1">创建时间</div>
                  <div className="text-sm text-gray-200">{formatDateTime(selectedOrder.createdAt)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-sm text-gray-500 mb-1">更新时间</div>
                  <div className="text-sm text-gray-200">{formatDateTime(selectedOrder.updatedAt)}</div>
                </div>
              </div>
              {selectedOrder.startTime && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/5 rounded-lg p-4">
                    <div className="text-sm text-gray-500 mb-1">会员开始</div>
                    <div className="text-sm text-gray-200">{formatDateTime(selectedOrder.startTime)}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-4">
                    <div className="text-sm text-gray-500 mb-1">会员到期</div>
                    <div className="text-sm text-gray-200">{formatDateTime(selectedOrder.endTime)}</div>
                  </div>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-white/8 bg-white/3 flex justify-end gap-3 rounded-b-lg">
              {selectedOrder.paymentStatus === "pending" && (
                <>
                  <button
                    onClick={() => {
                      if (confirm("确定标记该订单为已支付？")) {
                        handleUpdateOrder(selectedOrder.id, { paymentStatus: "paid" });
                      }
                    }}
                    className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                  >
                    标记已支付
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("确定取消该订单？")) {
                        handleUpdateOrder(selectedOrder.id, { paymentStatus: "cancelled" });
                      }
                    }}
                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                  >
                    取消订单
                  </button>
                </>
              )}
              <button
                onClick={() => setShowOrderModal(false)}
                className="px-4 py-2 border border-white/10 text-gray-300 rounded-lg hover:bg-white/8"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 会员详情弹窗 */}
      {showMemberModal && selectedMember && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="backdrop-blur-xl rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-white/10" style={{ background: 'rgba(15,12,41,0.95)' }}>
            {/* 弹窗头部 - 渐变背景 */}
            <div className="bg-gradient-to-r from-gray-900 to-gray-700 px-6 py-5 sticky top-0 z-10">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  会员详情
                </h2>
                <button
                  onClick={() => setShowMemberModal(false)}
                  className="text-white/70 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* 基本信息 */}
              <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  基本信息
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">用户名</label>
                    <input
                      type="text"
                      defaultValue={selectedMember.username}
                      className="block w-full px-3 py-2.5 border border-white/15 rounded-lg bg-white/5 text-gray-300 text-sm"
                      disabled
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">邮箱</label>
                    <input
                      type="email"
                      defaultValue={selectedMember.email}
                      className="block w-full px-3 py-2.5 border border-white/15 rounded-lg bg-white/5 text-gray-300 text-sm"
                      disabled
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">昵称</label>
                    <input
                      type="text"
                      id="nickname"
                      defaultValue={selectedMember.nickname || ""}
                      className="block w-full px-3 py-2.5 border border-white/15 rounded-lg bg-white/5 text-gray-200 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">账户状态</label>
                    <select
                      id="isActive"
                      defaultValue={selectedMember.isActive ? "true" : "false"}
                      className="block w-full px-3 py-2.5 border border-white/15 rounded-lg bg-white/5 text-gray-200 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                    >
                      <option className="bg-gray-900 text-white" value="true">✅ 启用</option>
                      <option className="bg-gray-900 text-white" value="false">⛔ 禁用</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* 会员信息 */}
              <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  会员信息
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">会员等级</label>
                    <select
                      id="memberLevelId"
                      defaultValue={selectedMember.memberLevelId || ""}
                      className="block w-full px-3 py-2.5 border border-white/15 rounded-lg bg-white/5 text-gray-200 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                    >
                      <option className="bg-gray-900 text-white" value="">免费用户</option>
                      {memberLevels.map((level) => (
                        <option className="bg-gray-900 text-white" key={level.id} value={level.id}>
                          {level.name} - ¥{formatYuan(level.price)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">会员状态</label>
                    <select
                      id="memberStatus"
                      defaultValue={selectedMember.memberStatus || "inactive"}
                      className="block w-full px-3 py-2.5 border border-white/15 rounded-lg bg-white/5 text-gray-200 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                    >
                      <option className="bg-gray-900 text-white" value="active">✅ 有效</option>
                      <option className="bg-gray-900 text-white" value="expired">⏰ 已过期</option>
                      <option className="bg-gray-900 text-white" value="inactive">⚪ 未开通</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">到期时间</label>
                    <input
                      type="text"
                      defaultValue={formatDate(selectedMember.memberExpireAt)}
                      className="block w-full px-3 py-2.5 border border-white/15 rounded-lg bg-white/5 text-gray-400 text-sm"
                      disabled
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">注册时间</label>
                    <input
                      type="text"
                      defaultValue={formatDate(selectedMember.createdAt)}
                      className="block w-full px-3 py-2.5 border border-white/15 rounded-lg bg-white/5 text-gray-400 text-sm"
                      disabled
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">章节生成上限</label>
                    <input
                      type="number"
                      id="chapterLimit"
                      defaultValue={
                        selectedMember._originalChapterLimit === 0
                          ? 0
                          : selectedMember.chapterLimit ?? 11
                      }
                      min="0"
                      max="99999"
                      className="block w-full px-3 py-2.5 border border-gray-200 rounded-lg text-gray-800 text-sm font-medium focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                    />
                    <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      填 0 表示无限制，留空则使用会员等级默认上限
                    </p>
                  </div>
                </div>
              </div>

              {/* 章节使用情况 */}
              <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  章节使用情况
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-blue-500/10 rounded-xl border border-blue-500/20">
                    <div className="text-sm font-semibold text-blue-400">📝 已用章节</div>
                    <div className="text-2xl font-bold text-blue-300 mt-1">
                      {selectedMember.totalChaptersUsed ?? 0} 章
                    </div>
                  </div>
                  <div className="p-4 bg-green-500/10 rounded-xl border border-green-500/20">
                    <div className="text-sm font-semibold text-green-400">✅ 剩余章节</div>
                    <div className="text-2xl font-bold text-green-300 mt-1">
                      {selectedMember._originalChapterLimit === 0 ? (
                        <span className="text-green-600">无限制</span>
                      ) : (
                        <>{selectedMember.remainingChapters ?? 0} 章</>
                      )}
                    </div>
                  </div>
                  <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                    <div className="text-sm font-semibold text-gray-400">📊 章节上限</div>
                    <div className="text-2xl font-bold text-white mt-1">
                      {selectedMember._originalChapterLimit === 0 ? (
                        <span className="text-green-600">无限制</span>
                      ) : (
                        <>{selectedMember.chapterLimit ?? 11} 章</>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 权限说明 */}
              <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  权限说明
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                    <div className="text-sm font-semibold text-gray-300">🆓 免费用户</div>
                    <div className="text-xl font-bold text-white mt-1">11 章节</div>
                    <div className="text-xs text-gray-500 mt-1">基础创作体验</div>
                  </div>
                  <div className="p-4 bg-amber-500/10 rounded-xl border border-amber-500/20">
                    <div className="text-sm font-semibold text-amber-400">⭐ VIP会员</div>
                    <div className="text-xl font-bold text-amber-300 mt-1">999 章节</div>
                    <div className="text-xs text-amber-500 mt-1">高级模板、优先生成</div>
                  </div>
                  <div className="p-4 bg-purple-500/10 rounded-xl border border-purple-500/20">
                    <div className="text-sm font-semibold text-purple-400">👑 SVIP会员</div>
                    <div className="text-xl font-bold text-purple-300 mt-1">9999 章节</div>
                    <div className="text-xs text-purple-600 mt-1">全部功能、专属客服</div>
                  </div>
                </div>
                <p className="text-sm text-gray-500 mt-3 flex items-center gap-1.5 bg-blue-500/10 p-2.5 rounded-lg">
                  <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  管理员可为单个会员自定义章节上限，覆盖等级默认设置（填 0 表示无限制）
                </p>
              </div>

              {/* 订单历史 */}
              {selectedMember.orders && selectedMember.orders.length > 0 && (
                <div>
                  <h3 className="text-lg font-medium mb-4">订单历史</h3>
                  <div className="space-y-3">
                    {selectedMember.orders.map((order: any) => (
                      <div key={order.id} className="border rounded-lg p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium">订单号: {order.orderNo}</div>
                            <div className="text-sm text-gray-500">
                              金额: ¥{formatYuan(order.amount)} | 支付方式: {order.paymentMethod || "-"}
                            </div>
                          </div>
                          <span className={`px-2 py-1 text-xs rounded ${getStatusColor(order.paymentStatus)}`}>
                            {getStatusText(order.paymentStatus)}
                          </span>
                        </div>
                        <div className="text-sm text-gray-500 mt-2">
                          创建: {formatDate(order.createdAt)}
                          {order.paymentTime && ` | 支付: ${formatDate(order.paymentTime)}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-white/10 bg-white/5 flex justify-between">
              <button
                onClick={() => {
                  if (confirm("确定要删除该会员吗？此操作不可恢复！")) {
                    handleDeleteMember(selectedMember.id);
                  }
                }}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                删除会员
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowMemberModal(false)}
                  className="px-4 py-2 border border-white/10 text-gray-300 rounded-lg hover:bg-white/8"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    const nicknameInput = document.getElementById("nickname") as HTMLInputElement;
                    const isActiveSelect = document.getElementById("isActive") as HTMLSelectElement;
                    const memberLevelSelect = document.getElementById("memberLevelId") as HTMLSelectElement;
                    const memberStatusSelect = document.getElementById("memberStatus") as HTMLSelectElement;
                    const chapterLimitInput = document.getElementById("chapterLimit") as HTMLInputElement;

                    const chapterLimit = parseInt(chapterLimitInput.value) || 0;

                    handleUpdateMember(selectedMember.id, {
                      nickname: nicknameInput.value,
                      isActive: isActiveSelect.value === "true",
                      memberLevelId: memberLevelSelect.value || null,
                      memberStatus: memberStatusSelect.value,
                      chapterLimit: chapterLimit,
                    });
                    setShowMemberModal(false);
                  }}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  保存修改
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 等级编辑弹窗 */}
      {showLevelModal && (
        <div key={editingLevel ? editingLevel.id : "new"} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto border border-white/10" style={{ background: 'rgba(15,12,41,0.95)' }}>
            <div className="px-6 py-4 border-b border-white/8 rounded-t-2xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">{editingLevel ? "编辑等级 — " + editingLevel.name : "新增会员等级"}</h3>
                <button
                  onClick={() => { setShowLevelModal(false); setEditingLevel(null); }}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-all"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-6 space-y-5">
              {!editingLevel && (
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1.5">等级代码</label>
                  <input
                    id="levelCode"
                    type="text"
                    placeholder="如 vip_plus（字母/数字/下划线，唯一）"
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl text-sm text-gray-200 bg-white/5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                  />
                  <p className="text-xs text-gray-500 mt-1.5">系统内部标识，创建后不可修改</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">等级名称</label>
                <input
                  id="levelName"
                  type="text"
                  defaultValue={editingLevel?.name || ''}
                  className="w-full px-4 py-2.5 border border-white/15 rounded-xl text-sm text-gray-200 bg-white/5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">描述</label>
                <textarea
                  id="levelDescription"
                  defaultValue={editingLevel?.description || ''}
                  rows={2}
                  className="w-full px-4 py-2.5 border border-white/15 rounded-xl text-sm text-gray-200 bg-white/5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1.5">价格（元）</label>
                  <input
                    id="levelPrice"
                    type="number"
                    defaultValue={editingLevel ? editingLevel.price / 100 : 0}
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl text-sm text-gray-200 bg-white/5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1.5">时长（天）</label>
                  <input
                    id="levelDuration"
                    type="number"
                    defaultValue={editingLevel?.duration ?? 30}
                    min="1"
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl text-sm text-gray-200 bg-white/5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">章节上限</label>
                <input
                  id="levelChapterLimit"
                  type="number"
                  defaultValue={editingLevel?.chapterLimit || 10}
                  min="1"
                  className="w-full px-4 py-2.5 border border-white/15 rounded-xl text-sm text-gray-200 bg-white/5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                />
                <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  设置该等级会员可生成的最大章节数
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">存储上限（部小说）</label>
                <input
                  id="levelStorageLimit"
                  type="number"
                  defaultValue={editingLevel?.storageLimit ?? (editingLevel?.chapterLimit === 9999 ? -1 : 10)}
                  min="-1"
                  className="w-full px-4 py-2.5 border border-white/15 rounded-xl text-sm text-gray-200 bg-white/5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                />
                <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  -1 表示无限制
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">排序（数字越小越靠前）</label>
                <input
                  id="levelSortOrder"
                  type="number"
                  defaultValue={editingLevel?.sortOrder ?? Math.max(0, ...memberLevels.map((l) => l.sortOrder || 0)) + 1}
                  min="0"
                  className="w-full px-4 py-2.5 border border-white/15 rounded-xl text-sm text-gray-200 bg-white/5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">状态</label>
                <select
                  id="levelIsActive"
                  defaultValue={editingLevel ? (editingLevel.isActive ? "true" : "false") : "true"}
                  className="w-full px-4 py-2.5 border border-white/15 rounded-xl text-sm text-gray-200 bg-white/5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                >
                  <option className="bg-gray-900 text-white" value="true">启用</option>
                  <option className="bg-gray-900 text-white" value="false">禁用</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">功能特权（每行一个）</label>
                <textarea
                  id="levelFeatures"
                  defaultValue={(editingLevel?.features || []).join('\n')}
                  rows={4}
                  className="w-full px-4 py-2.5 border border-white/15 rounded-xl text-sm text-gray-200 bg-white/5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t bg-white/3 border-t border-white/8 flex justify-end gap-3 rounded-b-2xl">
              <button
                onClick={() => { setShowLevelModal(false); setEditingLevel(null); }}
                className="px-5 py-2.5 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/10 border border-white/10 rounded-xl transition-all"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const nameInput = document.getElementById("levelName") as HTMLInputElement;
                  const descInput = document.getElementById("levelDescription") as HTMLTextAreaElement;
                  const priceInput = document.getElementById("levelPrice") as HTMLInputElement;
                  const durationInput = document.getElementById("levelDuration") as HTMLInputElement;
                  const chapterLimitInput = document.getElementById("levelChapterLimit") as HTMLInputElement;
                  const storageLimitInput = document.getElementById("levelStorageLimit") as HTMLInputElement;
                  const activeSelect = document.getElementById("levelIsActive") as HTMLSelectElement;
                  const featuresInput = document.getElementById("levelFeatures") as HTMLTextAreaElement;
                  const sortInput = document.getElementById("levelSortOrder") as HTMLInputElement;
                  const codeInput = document.getElementById("levelCode") as HTMLInputElement | null;

                  const name = nameInput.value.trim();
                  if (!name) {
                    alert("请填写等级名称");
                    return;
                  }

                  const storageRaw = parseInt(storageLimitInput.value);
                  const payload = {
                    name,
                    description: descInput.value,
                    price: Math.round((parseFloat(priceInput.value) || 0) * 100),
                    duration: parseInt(durationInput.value) || 30,
                    chapterLimit: parseInt(chapterLimitInput.value) || 10,
                    storageLimit: Number.isNaN(storageRaw) ? 10 : storageRaw,
                    isActive: activeSelect.value === "true",
                    features: featuresInput.value.split('\n').map((f) => f.trim()).filter(Boolean),
                    sortOrder: parseInt(sortInput.value) || 0,
                  };

                  if (editingLevel) {
                    handleUpdateLevel(editingLevel.id, payload);
                  } else {
                    const code = (codeInput?.value || "").trim();
                    if (!code) {
                      alert("请填写等级代码");
                      return;
                    }
                    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(code)) {
                      alert("等级代码只能包含字母、数字、下划线，且以字母开头");
                      return;
                    }
                    if (memberLevels.some((l) => l.code.toLowerCase() === code.toLowerCase())) {
                      alert("等级代码已存在，请更换");
                      return;
                    }
                    handleCreateLevel({ ...payload, code });
                  }
                }}
                className="px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl hover:from-blue-600 hover:to-indigo-600 shadow-sm transition-all"
              >
                {editingLevel ? "保存修改" : "创建等级"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新建邀请码弹窗 */}
      {showInviteCodeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="backdrop-blur-xl rounded-2xl shadow-xl w-full max-w-lg mx-4 border border-white/10" style={{ background: 'rgba(15,12,41,0.95)' }}>
            <div className="p-6 border-b border-white/8">
              <h3 className="text-lg font-bold text-white">新建邀请码</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">邀请码（可选）</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newInviteCode.code}
                    onChange={(e) => setNewInviteCode({ ...newInviteCode, code: e.target.value })}
                    placeholder="留空自动生成"
                    className="flex-1 px-3 py-2 border border-white/10 bg-white/5 text-white rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const code = `INV${Date.now().toString(36)}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
                      setNewInviteCode({ ...newInviteCode, code });
                    }}
                    className="px-3 py-2 bg-white/8 text-gray-300 rounded-lg hover:bg-white/15 text-sm"
                  >
                    随机
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">说明</label>
                <input
                  type="text"
                  value={newInviteCode.description}
                  onChange={(e) => setNewInviteCode({ ...newInviteCode, description: e.target.value })}
                  placeholder="邀请码用途说明"
                  className="w-full px-3 py-2 border border-white/10 bg-white/5 text-white rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                />
              </div>
              <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">关联会员等级</label>
                  <select
                    value={newInviteCode.memberLevelId}
                    onChange={(e) => setNewInviteCode({ ...newInviteCode, memberLevelId: e.target.value })}
                    className="w-full px-3 py-2 border border-white/10 bg-white/5 text-white rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                  >
                    <option className="bg-gray-900 text-white" value="">请选择等级</option>
                    {memberLevels.map((level: MemberLevel) => (
                      <option className="bg-gray-900 text-white" key={level.id} value={level.id}>
                        {level.name}
                      </option>
                    ))}
                  </select>
                </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">过期时间（可选）</label>
                <input
                  type="datetime-local"
                  value={newInviteCode.expiresAt}
                  onChange={(e) => setNewInviteCode({ ...newInviteCode, expiresAt: e.target.value })}
                  className="w-full px-3 py-2 border border-white/10 bg-white/5 text-white rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                />
              </div>
            </div>
            <div className="p-6 border-t bg-white/3 border-t border-white/8 flex justify-end gap-3 rounded-b-2xl">
              <button
                onClick={() => setShowInviteCodeModal(false)}
                className="px-4 py-2 border border-white/10 text-gray-300 rounded-lg hover:bg-white/8"
              >
                取消
              </button>
              <button
                onClick={handleCreateInviteCode}
                disabled={!newInviteCode.memberLevelId}
                className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50"
              >
                {newInviteCode.code ? "创建" : "自动生成邀请码"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
