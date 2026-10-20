import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import { handleCheckoutApiRequest, type CheckoutApiDependencies } from "../api/CheckoutApi.js";
import { handleStepUpPageRequest } from "./StepUpPage.js";
import { handleReceiptPageRequest } from "./ReceiptPage.js";

export function createCheckoutHttpServer(dependencies: CheckoutApiDependencies): Server {
  return createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const method = incoming.method ?? "GET";
      const hasBody = method !== "GET" && method !== "HEAD";
      const request = new Request(new URL(incoming.url ?? "/", "http://localhost"), {
        method,
        headers,
        ...(hasBody ? {
          body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
          duplex: "half"
        } : {})
      });
      const response = handleStepUpPageRequest(request) ?? handleReceiptPageRequest(request) ?? await handleCheckoutApiRequest(request, dependencies);
      response.headers.forEach((value, name) => outgoing.setHeader(name, value));
      outgoing.writeHead(response.status);
      outgoing.end(method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ error: "INVALID_REQUEST" }));
    }
  });
}
