import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { ConvexProvider, ConvexReactClient } from "convex/react";

import "@fontsource-variable/space-grotesk/index.css";
import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import "./styles/app.css";

import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {convex ? (
      <ConvexProvider client={convex}>
        <RouterProvider router={router} />
      </ConvexProvider>
    ) : (
      <RouterProvider router={router} />
    )}
  </StrictMode>,
);
