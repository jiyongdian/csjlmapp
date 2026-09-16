import { eq, desc, and, sql, type SQL } from "drizzle-orm";
import { getDb } from "./sqlite";
import {
	memberOrders,
	insertMemberOrderSchema,
	type MemberOrder,
	type InsertMemberOrder,
} from "./shared/schema";
import { memberLevels } from "./shared/schema";

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export class MemberOrderManager {
	/**
	 * 生成唯一订单号
	 */
	generateOrderNo(): string {
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(2, 10);
		return `ORD${timestamp}${random}`.toUpperCase();
	}

	/**
	 * 创建会员订单
	 */
	async create(data: InsertMemberOrder): Promise<MemberOrder> {
		const db = await getDb();
		const validated = insertMemberOrderSchema.parse(data);
		const [order] = await db.insert(memberOrders).values({
			...validated,
			id: generateUUID()
		}).returning();
		return order;
	}

	/**
	 * 根据ID获取订单
	 */
	async getById(id: string): Promise<MemberOrder | null> {
		const db = await getDb();
		const result = await db.select().from(memberOrders).where(eq(memberOrders.id, id)).limit(1);
		return result[0] || null;
	}

	/**
	 * 根据订单号获取订单
	 */
	async getByOrderNo(orderNo: string): Promise<MemberOrder | null> {
		const db = await getDb();
		const result = await db.select().from(memberOrders).where(eq(memberOrders.orderNo, orderNo)).limit(1);
		return result[0] || null;
	}

	/**
	 * 获取所有订单（管理员用）
	 */
	async getOrders(params: {
		page?: number;
		limit?: number;
		status?: string;
		userId?: string;
	}): Promise<{ orders: MemberOrder[]; total: number }> {
		const db = await getDb();
		const page = params.page || 1;
		const limit = params.limit || 10;
		const offset = (page - 1) * limit;
		
		let whereConditions: SQL<unknown>[] = [];
		
		if (params.userId) {
			whereConditions.push(eq(memberOrders.userId, params.userId));
		}
		
		if (params.status) {
			whereConditions.push(eq(memberOrders.paymentStatus, params.status));
		}
		
		const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;
		
		// 获取总数
		const countResult = await db
			.select({ count: sql<number>`count(*)` })
			.from(memberOrders)
			.where(whereClause);
		const total = Number(countResult[0]?.count) || 0;
		
		// 获取分页数据
		const orders = await db
			.select()
			.from(memberOrders)
			.where(whereClause)
			.orderBy(desc(memberOrders.createdAt))
			.limit(limit)
			.offset(offset);
		
		return { orders, total };
	}

	/**
	 * 获取用户的订单列表
	 */
	async getUserOrders(userId: string): Promise<MemberOrder[]> {
		const db = await getDb();
		const orders = await db
			.select()
			.from(memberOrders)
			.where(eq(memberOrders.userId, userId))
			.orderBy(desc(memberOrders.createdAt));
		return orders;
	}

	/**
	 * 获取用户最新的有效会员订单
	 */
	async getUserActiveOrder(userId: string): Promise<MemberOrder | null> {
		const db = await getDb();
		const orders = await db
			.select()
			.from(memberOrders)
			.where(
				and(
					eq(memberOrders.userId, userId),
					eq(memberOrders.paymentStatus, "completed")
				)
			)
			.orderBy(desc(memberOrders.endTime))
			.limit(1);
		return orders[0] || null;
	}

	/**
	 * 完成支付
	 */
	async completePayment(
		orderNo: string,
		paymentMethod: string
	): Promise<MemberOrder | null> {
		const db = await getDb();
		const order = await this.getByOrderNo(orderNo);
		if (!order) {
			return null;
		}

		// 获取会员等级信息以确定时长
		const levelResult = await db
			.select()
			.from(memberLevels)
			.where(eq(memberLevels.id, order.memberLevelId))
			.limit(1);
		const level = levelResult[0];

		// 计算过期时间
		const now = new Date();
		const durationDays = level?.duration || 30;
		const expireAt = new Date(now);
		expireAt.setDate(expireAt.getDate() + durationDays);

		const [updated] = await db
			.update(memberOrders)
			.set({
				paymentStatus: "completed",
				paymentMethod,
				paymentTime: now.toISOString(),
				startTime: now.toISOString(),
				endTime: expireAt.toISOString(),
			})
			.where(eq(memberOrders.orderNo, orderNo))
			.returning();
		return updated || null;
	}

	/**
	 * 根据会员等级ID获取等级信息
	 */
	async getLevelById(levelId: string): Promise<{ id: string; duration: number; name: string; code: string } | null> {
		const db = await getDb();
		const result = await db
			.select({ id: memberLevels.id, duration: memberLevels.duration, name: memberLevels.name, code: memberLevels.code })
			.from(memberLevels)
			.where(eq(memberLevels.id, levelId))
			.limit(1);
		return result[0] || null;
	}

	/**
	 * 获取支付统计数据（管理员用）
	 */
	async getPaymentStats(): Promise<{
		totalOrders: number;
		totalRevenue: number;
		completedOrders: number;
		pendingOrders: number;
		failedOrders: number;
		paymentMethodStats: { method: string; count: number; total: number }[];
		dailyRevenue: { date: string; revenue: number; count: number }[];
	}> {
		const db = await getDb();
		const allOrders = await db.select().from(memberOrders);

		const totalOrders = allOrders.length;
		const completedOrders = allOrders.filter(o => o.paymentStatus === 'completed').length;
		const pendingOrders = allOrders.filter(o => o.paymentStatus === 'pending').length;
		const failedOrders = allOrders.filter(o => o.paymentStatus === 'failed' || o.paymentStatus === 'cancelled').length;
		const totalRevenue = allOrders
			.filter(o => o.paymentStatus === 'completed')
			.reduce((sum, o) => sum + o.amount, 0);

		// 按支付方式统计
		const methodMap = new Map<string, { count: number; total: number }>();
		allOrders.filter(o => o.paymentStatus === 'completed').forEach(o => {
			const method = o.paymentMethod || 'unknown';
			const current = methodMap.get(method) || { count: 0, total: 0 };
			current.count++;
			current.total += o.amount;
			methodMap.set(method, current);
		});
		const paymentMethodStats = Array.from(methodMap.entries()).map(([method, stats]) => ({
			method,
			...stats,
		}));

		// 按日期统计（最近30天）
		const dailyMap = new Map<string, { revenue: number; count: number }>();
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
		
		allOrders
			.filter(o => o.paymentStatus === 'completed' && o.paymentTime && new Date(o.paymentTime) >= thirtyDaysAgo)
			.forEach(o => {
				const date = new Date(o.paymentTime!).toISOString().split('T')[0];
				const current = dailyMap.get(date) || { revenue: 0, count: 0 };
				current.revenue += o.amount;
				current.count++;
				dailyMap.set(date, current);
			});
		
		const dailyRevenue = Array.from(dailyMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([date, stats]) => ({ date, ...stats }));

		return {
			totalOrders,
			totalRevenue,
			completedOrders,
			pendingOrders,
			failedOrders,
			paymentMethodStats,
			dailyRevenue,
		};
	}

	/**
	 * 取消订单
	 */
	async cancelOrder(orderNo: string): Promise<MemberOrder | null> {
		const db = await getDb();
		const [order] = await db
			.update(memberOrders)
			.set({
				paymentStatus: "cancelled",
			})
			.where(eq(memberOrders.orderNo, orderNo))
			.returning();
		return order || null;
	}
}

export const memberOrderManager = new MemberOrderManager();
