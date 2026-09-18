import type { Metadata } from "next";

import SyntheticNature from "@/components/synthetic-nature";

export const metadata: Metadata = {
  title: "Synthetic Nature",
  description:
    "An odyssey through delicate living forms, revealed by lens and curiosity.",
};

export default function SyntheticNaturePage() {
  return <SyntheticNature />;
}
