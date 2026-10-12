// Which build is live. Used by the deploy check and by people asking "is it updated yet?".
export const dynamic = "force-static";

export function GET() {
  return Response.json({ commit: process.env.NEXT_PUBLIC_BUILD ?? "local" });
}
