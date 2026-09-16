"use client";

import { useState } from "react";
import Link from "next/link";
import { authApi } from "@/lib/api/client";
import AIConfigModal from "@/components/AIConfigModal";
import { useSiteSettings } from "@/components/SiteSettingsProvider";

export default function LoginPage() {
	const [isLogin, setIsLogin] = useState(true);
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [nickname, setNickname] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [showAiConfigModal, setShowAiConfigModal] = useState(false);
	const site = useSiteSettings();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			if (isLogin) {
				const loginResult = await authApi.login({ email, password }) as any;
				localStorage.setItem("accessToken", loginResult.accessToken || "");
				localStorage.setItem("token", loginResult.accessToken || "");
				localStorage.setItem("refreshToken", loginResult.refreshToken || "");
				localStorage.setItem("auth-storage", JSON.stringify({
					state: {
						token: loginResult.accessToken || "",
						refreshToken: loginResult.refreshToken || "",
						user: loginResult.user || null,
					},
					version: 0,
				}));
				if (loginResult.user) {
					localStorage.setItem("user", JSON.stringify(loginResult.user));
				}
			} else {
				const registerResult = await authApi.register({ username, email, password, nickname: nickname || undefined }) as any;
				localStorage.setItem("accessToken", registerResult.accessToken || "");
				localStorage.setItem("token", registerResult.accessToken || "");
				localStorage.setItem("refreshToken", registerResult.refreshToken || "");
				localStorage.setItem("auth-storage", JSON.stringify({
					state: {
						token: registerResult.accessToken || "",
						refreshToken: registerResult.refreshToken || "",
						user: registerResult.user || null,
					},
					version: 0,
				}));
				if (registerResult.user) {
					localStorage.setItem("user", JSON.stringify(registerResult.user));
				}
			}
			window.location.href = '/novel-generator';
		} catch (err: any) {
			setError(err.message || "操作失败");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-black px-4">
			{/* 右上角API设置按钮 */}
			<button
				onClick={() => setShowAiConfigModal(true)}
				className="fixed top-4 right-4 z-20 flex items-center gap-2 px-4 py-2 bg-green-500/10 hover:bg-green-500/20 backdrop-blur-sm rounded-lg text-green-400 hover:text-green-300 transition-colors border border-green-500/30"
			>
				<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
				</svg>
				API设置
			</button>
			<div className="w-full max-w-md relative z-10">
				<div className="text-center mb-8">
					<h1 className="text-4xl font-bold text-green-400 mb-2" style={{ textShadow: '0 0 20px rgba(0,255,0,0.3), 0 0 40px rgba(0,255,0,0.1)' }}>{site.websiteTitle}</h1>
					<p className="text-green-300/70">创作永无止境</p>
				</div>

				<div className="bg-black/60 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-green-500/20">
					<div className="flex mb-6 bg-green-500/10 rounded-lg p-1">
						<button
							type="button"
							onClick={() => setIsLogin(true)}
							className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
								isLogin
									? "bg-green-500 text-black shadow-lg shadow-green-500/20"
									: "text-green-400 hover:bg-green-500/10"
							}`}
						>
							登录
						</button>
						<button
							type="button"
							onClick={() => setIsLogin(false)}
							className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
								!isLogin
									? "bg-green-500 text-black shadow-lg shadow-green-500/20"
									: "text-green-400 hover:bg-green-500/10"
							}`}
						>
							注册
						</button>
					</div>

					<form onSubmit={handleSubmit} className="space-y-4">
						{!isLogin && (
							<div>
								<label className="block text-green-300/80 text-sm font-medium mb-1">
									用户名
								</label>
								<input
									type="text"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									required
									className="w-full px-4 py-3 rounded-lg bg-white/5 border border-green-500/20 text-green-100 placeholder-green-500/40 focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 transition-all"
									placeholder="请输入用户名"
								/>
							</div>
						)}

						{!isLogin && (
							<div>
								<label className="block text-green-300/80 text-sm font-medium mb-1">
									昵称（选填）
								</label>
								<input
									type="text"
									value={nickname}
									onChange={(e) => setNickname(e.target.value)}
									className="w-full px-4 py-3 rounded-lg bg-white/5 border border-green-500/20 text-green-100 placeholder-green-500/40 focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 transition-all"
									placeholder="给自己起个昵称"
								/>
							</div>
						)}

						<div>
							<label className="block text-green-300/80 text-sm font-medium mb-1">
								邮箱
							</label>
							<input
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
								className="w-full px-4 py-3 rounded-lg bg-white/5 border border-green-500/20 text-green-100 placeholder-green-500/40 focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 transition-all"
								placeholder="请输入邮箱"
							/>
						</div>

						<div>
							<label className="block text-green-300/80 text-sm font-medium mb-1">
								密码
							</label>
							<input
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								minLength={6}
								className="w-full px-4 py-3 rounded-lg bg-white/5 border border-green-500/20 text-green-100 placeholder-green-500/40 focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 transition-all"
								placeholder="请输入密码（至少6位）"
							/>
						</div>

						{error && (
							<div className="bg-red-500/20 border border-red-500/50 rounded-lg px-4 py-3 text-red-200 text-sm">
								{error}
							</div>
						)}

						<button
							type="submit"
							disabled={loading}
							className="w-full py-3 px-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-black font-semibold rounded-lg shadow-lg shadow-green-500/20 hover:shadow-xl hover:shadow-green-500/30 transform hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
						>
							{loading ? "处理中..." : isLogin ? "登录" : "注册"}
						</button>
					</form>

					<div className="mt-6 text-center">
						<Link
							href="/novel-generator"
							className="text-green-500/60 hover:text-green-400 text-sm transition-colors"
						>
							游客访问（不保存数据）
						</Link>
					</div>
				</div>

				<p className="text-center text-green-500/40 text-sm mt-6">
					登录后享受更多功能：小说、剧本、短剧权益
				</p>
			</div>

			{/* AI配置弹窗 */}
			{showAiConfigModal && (
				<AIConfigModal isOpen={showAiConfigModal} onClose={() => setShowAiConfigModal(false)} />
			)}
		</div>
	);
}
