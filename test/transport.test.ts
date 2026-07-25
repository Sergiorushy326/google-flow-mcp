import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildUrl } from "../src/services/transport.js";
import { procedureFromUrl, shapeOf } from "../src/services/discovery.js";
import { identify } from "../src/services/media.js";
import { findEncodedVideo } from "../src/services/scene.js";
import { describeMode } from "../src/services/generate.js";
import { TRPC_BASE } from "../src/constants.js";

describe("tRPC url construction", () => {
  it("wraps GET input in tRPC's json envelope", () => {
    const url = new URL(buildUrl({ procedure: "media.list", method: "GET", input: { limit: 10 } }));
    assert.equal(url.pathname, "/fx/api/trpc/media.list");
    assert.deepEqual(JSON.parse(url.searchParams.get("input")!), { json: { limit: 10 } });
  });

  it("uses raw query params verbatim when an endpoint does not take the envelope", () => {
    // media.getMediaUrlRedirect takes ?name=<id>, not ?input={"json":...}
    const url = new URL(buildUrl({ procedure: "media.getMediaUrlRedirect", rawQuery: { name: "abc123" } }));
    assert.equal(url.searchParams.get("name"), "abc123");
    assert.equal(url.searchParams.get("input"), null);
  });

  it("puts nothing in the query string for a POST", () => {
    const url = new URL(buildUrl({ procedure: "runVideoFxConcatenation", method: "POST", input: { sceneId: "s1" } }));
    assert.equal(url.search, "");
  });

  it("targets the documented tRPC base", () => {
    assert.ok(buildUrl({ procedure: "x" }).startsWith(TRPC_BASE));
  });
});

describe("endpoint discovery", () => {
  it("extracts a tRPC procedure name", () => {
    assert.equal(
      procedureFromUrl("https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=x"),
      "media.getMediaUrlRedirect",
    );
  });

  it("distinguishes rest and backend routes from tRPC procedures", () => {
    assert.equal(procedureFromUrl("https://labs.google/fx/api/auth/session"), "rest:auth/session");
    assert.match(procedureFromUrl("https://aisandbox-pa.googleapis.com/v1/video:gen") ?? "", /^backend:/);
  });

  it("ignores urls that are not Flow API calls", () => {
    assert.equal(procedureFromUrl("https://example.com/thing"), null);
  });
});

describe("discovery redaction", () => {
  // The whole point of storing shapes rather than bodies: an API map must never
  // become a place prompts or tokens accumulate.
  it("keeps key names and discards every value", () => {
    const keys = shapeOf({ prompt: "a woman walks through a market", token: "secret-abc" });
    assert.deepEqual(keys.sort(), ["prompt", "token"]);
    assert.ok(!JSON.stringify(keys).includes("secret-abc"));
    assert.ok(!JSON.stringify(keys).includes("market"));
  });

  it("flattens nested paths", () => {
    assert.ok(shapeOf({ media: { id: "x", meta: { kind: "video" } } }).includes("media.meta.kind"));
  });

  it("samples arrays rather than expanding them", () => {
    assert.deepEqual(shapeOf({ items: [{ id: 1 }, { id: 2 }] }).sort(), ["items", "items[].id"]);
  });

  it("stops recursing on deep structures", () => {
    const deep = { a: { b: { c: { d: { e: { f: "too deep" } } } } } };
    assert.ok(shapeOf(deep).length < 10);
  });

  it("returns nothing for primitives and null", () => {
    assert.deepEqual(shapeOf(null), []);
    assert.deepEqual(shapeOf("string"), []);
  });
});

describe("downloaded-file identification", () => {
  const pad = (head: number[]) => Buffer.concat([Buffer.from(head), Buffer.alloc(64)]);

  it("recognises real media", () => {
    assert.equal(identify(pad([0xff, 0xd8, 0xff, 0xe0])), "jpg");
    assert.equal(identify(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "png");
    assert.equal(
      identify(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(64)])),
      "mp4",
    );
  });

  it("rejects the expired-session error body that would otherwise be saved as media", () => {
    // This exact failure wrote a 27-byte "video" in a live run.
    assert.equal(identify(Buffer.from('{"error":"No session found"}')), null);
  });

  it("rejects HTML error pages and truncated buffers", () => {
    assert.equal(identify(Buffer.from("<!DOCTYPE html><html><body>error</body></html>")), null);
    assert.equal(identify(Buffer.from([0xff, 0xd8])), null);
  });
});

describe("scene export payload extraction", () => {
  const big = "A".repeat(2000);

  it("finds the video payload however deeply Flow nests it", () => {
    assert.equal(findEncodedVideo({ result: { data: { json: { encodedVideo: big } } } }), big);
    assert.equal(findEncodedVideo({ jobs: [{ status: "SUCCESSFUL", encoded_video: big }] }), big);
  });

  it("ignores a short value in the right key, which is a status stub not a video", () => {
    assert.equal(findEncodedVideo({ encodedVideo: "pending" }), null);
  });

  it("returns null when the job has not finished", () => {
    assert.equal(findEncodedVideo({ result: { data: { json: { status: "RUNNING" } } } }), null);
  });
});

describe("generation mode selection", () => {
  // Flow has no mode switch — the mode IS the attachment set.
  const base = { prompt: "x", expectedMaxCost: 20 };

  it("reports Text-to-Video when nothing is attached", () => {
    assert.match(describeMode(base), /Text-to-Video/);
  });

  it("reports Frames-to-Video for a start frame", () => {
    assert.match(describeMode({ ...base, startFrameMediaId: "a" }), /Frames-to-Video \(start frame\)/);
  });

  it("reports start+end when both frames are attached", () => {
    assert.match(describeMode({ ...base, startFrameMediaId: "a", endFrameMediaId: "b" }), /start \+ end/);
  });

  it("prefers Ingredients when references are supplied", () => {
    assert.match(describeMode({ ...base, referenceMediaIds: ["a", "b"] }), /Ingredients-to-Video \(2 reference/);
  });
});
