import { createFileRoute } from "@tanstack/react-router";
import { HouseGame } from "@/components/house-game";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="h-dvh w-full">
      <HouseGame />
    </main>
  );
}
