"use client";

import { use } from "react";
import { JoinFlow } from "@/components/JoinFlow";

export default function JoinWithCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return <JoinFlow initialCode={decodeURIComponent(code)} />;
}
