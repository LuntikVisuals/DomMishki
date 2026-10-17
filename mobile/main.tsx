import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HouseGame } from "@/components/house-game";
import "../src/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing root");

createRoot(root).render(
  <StrictMode>
    <main className="h-dvh w-full">
      <HouseGame />
    </main>
  </StrictMode>,
);
