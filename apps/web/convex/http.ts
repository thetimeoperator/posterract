import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Better Auth endpoints (sign up, sign in, session) served by the deployment.
authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
