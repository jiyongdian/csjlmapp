import { http } from "./client";

// ========== 类型定义 ==========

export interface MemberLevel {
  id: string;
  code: string;
  name: string;
  description: string;
  price: number;
  duration: number;
  features: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  // 兼容旧代码的属性
  chapterLimit?: number;
}

export interface MemberStatus {
  memberLevelId: string | null;
  memberLevelName: string;
  memberLevelCode: string;
  expireAt: string | null;
  isActive: boolean;
  // 兼容旧代码的属性
  isMember?: boolean;
  level?: {
    id?: string;
    expiresAt?: string;
    name?: string;
    code?: string;
  };
  user?: {
    id?: string;
    username?: string;
    nickname?: string;
    email?: string;
  };
  usage?: {
    novelCount?: number;
  };
  features?: {
    storageLimit?: number;
  };
}

export interface MemberOrder {
  id: string;
  orderNo: string;
  memberLevelId: string;
  memberLevelName: string;
  amount: number;
  paymentMethod: string;
  paymentStatus: string;
  paymentTime: string | null;
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
}

export interface AdminMember {
  id: string;
  username: string;
  email: string;
  nickname: string;
  role: string;
  memberLevelId: string | null;
  memberLevelName: string;
  memberExpireAt: string | null;
  memberStatus: string;
  isActive: boolean;
  createdAt: string;
  novelsCount: number;
}

// ========== API ==========

export const memberApi = {
  /** 获取会员等级列表 */
  getLevels: () => http.get<never, MemberLevel[]>("/api/member/levels"),

  /** 获取当前会员状态 */
  getStatus: () => http.get<never, MemberStatus>("/api/member/status"),

  /** 创建会员订单 */
  createOrder: (memberLevelId: string, paymentMethod?: string) => 
    http.post<never, { orderNo: string; amount: number }>("/api/member/orders", { memberLevelId, paymentMethod }),

  /** 查询支付状态 */
  queryPaymentStatus: (orderNo: string) => 
    http.get<never, any>(`/api/member/orders/${orderNo}`),

  /** 完成支付 */
  completePayment: (orderNo: string, paymentMethod: string) => 
    http.put<never, any>(`/api/member/orders/${orderNo}/complete`, { paymentMethod }),

  /** 获取会员订单列表 */
  getOrders: () => http.get<never, MemberOrder[]>("/api/member/orders"),
};

export const authApi = {
  /** 获取当前用户信息 */
  getUserInfo: () => http.get<never, any>("/api/auth/me"),

  /** 获取当前用户信息（兼容旧代码） */
  me: () => http.get<never, any>("/api/auth/me"),

  /** 更新用户信息 */
  updateUser: (data: any) => http.put<never, any>("/api/auth/me", data),

  /** 更新个人资料（用户名 / 昵称 / 邮箱） */
  updateProfile: (data: { username?: string; nickname?: string; email?: string; phone?: string }) =>
    http.put<never, any>("/api/auth/profile", data),

  /** 修改密码 */
  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    http.put<never, any>("/api/auth/change-password", data),

  /** 用户登录 */
  login: (data: { email: string; password: string }) => 
    http.post<never, any>("/api/auth/login", data),

  /** 用户注册 */
  register: (data: { username: string; email: string; password: string; nickname?: string }) => 
    http.post<never, any>("/api/auth/register", data),

  /** 用户登出 */
  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    localStorage.removeItem("auth-storage");
  },
};

export const adminMemberApi = {
  /** 获取会员列表 */
  getMembers: (params: { page?: number; limit?: number; search?: string }) =>
    http.get<never, { members: AdminMember[]; total: number }>("/api/admin/members", { params }),

  /** 获取会员详情 */
  getMember: (id: string) => http.get<never, AdminMember>(`/api/admin/members/${id}`),

  /** 更新会员信息 */
  updateMember: (id: string, data: any) => 
    http.put<never, any>(`/api/admin/members/${id}`, data),

  /** 删除会员 */
  deleteMember: (id: string) => http.delete<never, boolean>(`/api/admin/members/${id}`),
};
