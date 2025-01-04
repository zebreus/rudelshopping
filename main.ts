import { serveDir } from "jsr:@std/http/file-server";

Deno.serve(
  {
    port: 3000,
    hostname: "[::1]",
  },
  async (request) => {
    const pathname = new URL(request.url).pathname;

    if (pathname == "/api/hello") {
      return new Response(JSON.stringify({ hello: "world" }), {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-cache",
        },
        status: 200,
      });
    }

    return await serveDir(request, {
      fsRoot: "./",
      urlRoot: "",
      showIndex: true,
    });
  }
);
