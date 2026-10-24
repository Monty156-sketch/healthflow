import { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";

/** The narrow centred frame used by the signed-out pages: a card on a band of ink. */
export function PublicCard({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <main id="main" className="flex flex-1 flex-col">
      <div className="on-ink grid-paper h-44 px-4 pt-8 sm:h-52">
        <Link href="/" className="mx-auto flex w-full max-w-lg items-center gap-2.5 text-lg font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-sm.png" alt="" width={40} height={40} />
          HealthFlow
        </Link>
      </div>
      <div className="-mt-24 flex flex-1 justify-center px-4 pb-12 sm:-mt-28">
        <Card className={`h-fit w-full ${wide ? "max-w-lg" : "max-w-sm"}`}>
          <h1 className="mb-4 text-xl font-semibold">{title}</h1>
          {children}
        </Card>
      </div>
    </main>
  );
}
