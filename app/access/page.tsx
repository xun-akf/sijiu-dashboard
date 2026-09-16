import { LockKeyhole, Zap } from "lucide-react";

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="min-h-screen bg-[#061c16] text-[#edf8f3] flex items-center justify-center p-5">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_70%_15%,rgba(48,211,161,0.12),transparent_36%)]" />
      <section className="relative w-full max-w-[420px] rounded-2xl border border-[#1a493b] bg-[#0b2a21] px-7 py-8 shadow-2xl shadow-black/25">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl bg-[#32d6a2] text-[#052018]">
            <Zap className="size-7 fill-current" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-wide">四九周报</h1>
            <p className="mt-0.5 text-sm text-[#8fb6a8]">新能源运营中心</p>
          </div>
        </div>

        <div className="mb-6 border-t border-[#174437] pt-6">
          <div className="mb-2 flex items-center gap-2 text-lg font-medium">
            <LockKeyhole className="size-5 text-[#35d7a5]" />
            访问验证
          </div>
          <p className="text-sm leading-6 text-[#8fb6a8]">
            数据分级访问，权限自动识别。验证通过后进入对应工作台。
          </p>
        </div>

        <form action="/api/access" method="post" className="space-y-4">
          <div>
            <label htmlFor="password" className="mb-2 block text-sm text-[#b6d0c6]">
              请输入密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              placeholder="请输入访问密码"
              className="h-12 w-full rounded-xl border border-[#245344] bg-[#071f19] px-4 text-base text-white outline-none transition placeholder:text-[#587c70] focus:border-[#35d7a5] focus:ring-2 focus:ring-[#35d7a5]/15"
            />
            {error ? (
              <p className="mt-2 text-sm text-[#ff9b73]">密码不正确，请重新输入。</p>
            ) : null}
          </div>
          <button
            type="submit"
            className="h-12 w-full rounded-xl bg-[#35d7a5] font-semibold text-[#052019] transition hover:bg-[#49e5b3] active:translate-y-px"
          >
            进入四九周报
          </button>
        </form>
        <p className="mt-5 text-center text-xs text-[#658c7e]">验证后12小时内无需重复输入</p>
      </section>
    </main>
  );
}
