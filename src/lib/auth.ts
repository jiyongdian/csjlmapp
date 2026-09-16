import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET || "novel-generator-secret-key-change-in-production";
const JWT_EXPIRES_IN = "7d";
const REFRESH_TOKEN_EXPIRES_IN = "30d";

export interface JWTPayload {
	userId: string;
	email: string;
	username: string;
	role: string;
}

export interface TokenPair {
	accessToken: string;
	refreshToken: string;
}

/**
 * 生成JWT Access Token
 */
export function generateAccessToken(payload: JWTPayload): string {
	return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * 生成Refresh Token
 */
export function generateRefreshToken(payload: JWTPayload): string {
	return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN });
}

/**
 * 生成Token对
 */
export function generateTokenPair(payload: JWTPayload): TokenPair {
	return {
		accessToken: generateAccessToken(payload),
		refreshToken: generateRefreshToken(payload),
	};
}

/**
 * 验证Token
 */
export function verifyToken(token: string): JWTPayload | null {
	try {
		return jwt.verify(token, JWT_SECRET) as JWTPayload;
	} catch {
		return null;
	}
}

/**
 * 刷新Access Token
 */
export function refreshAccessToken(refreshToken: string): TokenPair | null {
	const payload = verifyToken(refreshToken);
	if (!payload) {
		return null;
	}
	return generateTokenPair(payload);
}

/**
 * 密码哈希
 */
export async function hashPassword(password: string): Promise<string> {
	const salt = await bcrypt.genSalt(10);
	return bcrypt.hash(password, salt);
}

/**
 * 验证密码
 */
export async function comparePassword(
	password: string,
	hash: string
): Promise<boolean> {
	return bcrypt.compare(password, hash);
}

/**
 * 从请求头获取Token
 */
export function extractTokenFromHeader(authHeader: string | null): string | null {
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return null;
	}
	return authHeader.slice(7);
}

/**
 * 验证并获取用户信息
 */
export function getUserFromToken(authHeader: string | null): JWTPayload | null {
	const token = extractTokenFromHeader(authHeader);
	if (!token) {
		return null;
	}
	return verifyToken(token);
}

/**
 * API路由认证中间件
 * 返回认证结果和用户信息
 */
export function verifyAuth(authHeader: string | null): { 
	success: boolean; 
	user?: JWTPayload; 
	error?: string;
} {
	if (!authHeader) {
		return { success: false, error: "未提供认证信息" };
	}
	const user = getUserFromToken(authHeader);
	if (!user) {
		return { success: false, error: "Token无效或已过期" };
	}
	return { success: true, user };
}
