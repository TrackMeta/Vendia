import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <Link href="/" className="mb-8 text-2xl font-semibold tracking-tight">
        Vendia
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
