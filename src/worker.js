// Minimal Cloudflare Workers proxy that routes all traffic to the container.
// The container runs the aiohttp HTTP service on port 8080 (see Dockerfile).
import { Container } from "cloudflare:workers";

export class RuntimeContainer extends Container {
  defaultPort = 8080;
}

export default {
  async fetch(request, env) {
    // All instances share the same container ("default").
    // Swap idFromName for idFromString to fan out across instances.
    const id = env.CONTAINER.idFromName("default");
    return env.CONTAINER.get(id).fetch(request);
  },
};
