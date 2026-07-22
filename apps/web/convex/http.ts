import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import {
  facebookDataDeletion,
  facebookDeauthorize,
  instagramDataDeletion,
  instagramDeauthorize,
  threadsDataDeletion,
  threadsDeauthorize,
} from "./metaCallbacks";

const http = httpRouter();

// Better Auth endpoints (sign up, sign in, session) served by the deployment.
authComponent.registerRoutes(http, createAuth, { cors: true });

http.route({ path: "/meta/threads/deauthorize", method: "POST", handler: threadsDeauthorize });
http.route({ path: "/meta/threads/data-deletion", method: "POST", handler: threadsDataDeletion });
http.route({ path: "/meta/facebook/deauthorize", method: "POST", handler: facebookDeauthorize });
http.route({
  path: "/meta/facebook/data-deletion",
  method: "POST",
  handler: facebookDataDeletion,
});
http.route({
  path: "/meta/instagram/deauthorize",
  method: "POST",
  handler: instagramDeauthorize,
});
http.route({
  path: "/meta/instagram/data-deletion",
  method: "POST",
  handler: instagramDataDeletion,
});

export default http;
