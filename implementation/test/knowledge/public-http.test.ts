import assert from "node:assert/strict";
import test from "node:test";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { isAllowedPublicHttpUrl } from "../../src/playwright/url-policy.js";
import { publicHttpGet } from "../../src/knowledge/public-source/public-http.js";

test("public fetch rejects internal literals, DNS answers and redirects before connecting", async (t) => {
  for (const host of ["[::1]", "[::]", "[fc00::1]", "[::ffff:127.0.0.1]", "[2001::1]", "0.0.0.0", "127.1", "localhost."]) {
    assert.equal(isAllowedPublicHttpUrl(`http://${host}/`), false, host);
  }
  let connections = 0;
  const request = () => { connections++; throw new Error("must not connect"); };
  t.mock.method(http, "request", request);
  t.mock.method(https, "request", request);
  t.mock.method(dns, "lookup", async () => [{ address: "10.0.0.1", family: 4 }]);
  await assert.rejects(publicHttpGet("https://public.example/"), /public/);
  assert.equal(connections, 0);
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  t.mock.method(https, "request", (_url: URL, options: any, callback: any) => {
    connections++;
    options.lookup("public.example", { all: true }, (_error: unknown, addresses: unknown) => {
      assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
    });
    const req = new EventEmitter() as any;
    req.end = () => {
      const response = Readable.from([]) as any;
      response.statusCode = 302;
      response.headers = { location: "http://[::ffff:127.0.0.1]/secret" };
      callback(response);
    };
    return req;
  });
  await assert.rejects(publicHttpGet("https://public.example/"), /public/);
  assert.equal(connections, 1);
});
