import Link from "next/link";
import { BrandLogo } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-canvas px-4 py-12">
      <Link href="/" className="mb-8" aria-label="Vendia, ir al inicio">
        <BrandLogo className="scale-110" />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
