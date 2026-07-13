/** Cloudflare Worker entry point used by the Sites production runtime. */
import handler from "vinext/server/app-router-entry";

interface WorkerEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  fetch(
    request: Request,
    env: WorkerEnv,
    context: WorkerExecutionContext,
  ): Promise<Response> {
    return handler.fetch(request, env, context);
  },
};

export default worker;
