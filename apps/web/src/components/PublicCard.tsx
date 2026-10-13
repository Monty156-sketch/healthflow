import { ReactNode } from "react";
import { Card } from "@/components/ui";

/** The narrow centred frame used by the signed-out pages. */
export function PublicCard({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-10">
      <Card className={`w-full ${wide ? "max-w-lg" : "max-w-sm"}`}>
        <p className="mb-4 flex items-center gap-2 font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" width={22} height={22} />
          HealthFlow
        </p>
        <h1 className="mb-4 text-lg font-semibold">{title}</h1>
        {children}
      </Card>
    </main>
  );
}
