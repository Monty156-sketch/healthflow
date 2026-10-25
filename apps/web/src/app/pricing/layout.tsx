import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing | HealthFlow",
  description: "HealthFlow plans for CHPS compounds, clinics, health centres and hospitals in Ghana, priced in cedis by facility size, with a 30 day trial.",
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
