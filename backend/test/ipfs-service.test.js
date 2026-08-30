import test from "node:test";
import assert from "node:assert/strict";

process.env.RELAYER_TEST_MODE = "true";

const ipfs = await import("../src/services/ipfs.js");

const cidV0 = `Qm${"1".repeat(44)}`;
const cidV1 =
  "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";

test("IPFS operations reject use before client initialization", async () => {
  await assert.rejects(
    ipfs.pinJSON({ version: 1, body: "test" }),
    /Pinata client not initialized/,
  );

  await assert.rejects(
    ipfs.pinFile(
      Buffer.from("image"),
      "test.png",
      "image/png",
    ),
    /Pinata client not initialized/,
  );

  assert.equal(await ipfs.isHealthy(), false);
});

test("sanitizeString removes executable HTML content", () => {
  const unsafe = [
    '<script>alert("x")</script>',
    '<img src="x" onclick="run()" onerror=fail()>',
    '<a href="javascript:alert(1)">link</a>',
    '<iframe src="data:text/html;base64,abc"></iframe>',
    "data:text/html in plain text",
  ].join("");

  const sanitized = ipfs.sanitizeString(unsafe);

  assert.doesNotMatch(sanitized, /<script/i);
  assert.doesNotMatch(sanitized, /onclick/i);
  assert.doesNotMatch(sanitized, /onerror/i);
  assert.doesNotMatch(sanitized, /javascript:/i);
  assert.doesNotMatch(sanitized, /data:\s*text\/html/i);
  // Active-markup containers (iframe & friends) are removed whole,
  // attributes included; scriptable data: URLs left in text are blocked.
  assert.doesNotMatch(sanitized, /<iframe/i);
  assert.match(sanitized, /data:blocked/i);
});

test("sanitizeMetadata recursively sanitizes keys and values", () => {
  const result = ipfs.sanitizeMetadata({
    '<script>bad</script>title': '<script>x</script>Hello',
    nested: [
      {
        body: '<img onclick="run()" src="javascript:test">',
      },
      "data:text/html payload",
    ],
    count: 2,
    enabled: true,
  });

  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /<script/i);
  assert.doesNotMatch(serialized, /onclick/i);
  assert.doesNotMatch(serialized, /javascript:/i);
  assert.match(serialized, /data:blocked/i);
  assert.equal(result.count, 2);
  assert.equal(result.enabled, true);
});

test("proposal metadata schema covers all validation outcomes", () => {
  let result = ipfs.validateMetadataSchema(
    null,
    ipfs.PROPOSAL_METADATA_SCHEMA,
  );

  assert.deepEqual(result, {
    valid: false,
    error: "Metadata must be an object",
  });

  result = ipfs.validateMetadataSchema(
    { version: 1 },
    ipfs.PROPOSAL_METADATA_SCHEMA,
  );
  assert.equal(result.valid, false);
  assert.match(result.error, /Missing required field: body/);

  result = ipfs.validateMetadataSchema(
    { version: 2, body: "text" },
    ipfs.PROPOSAL_METADATA_SCHEMA,
  );
  assert.equal(result.valid, false);
  assert.match(result.error, /Invalid version/);

  result = ipfs.validateMetadataSchema(
    { version: 1, body: 123 },
    ipfs.PROPOSAL_METADATA_SCHEMA,
  );
  assert.equal(result.valid, false);
  assert.match(result.error, /Body must be a string/);

  result = ipfs.validateMetadataSchema(
    {
      version: 1,
      body: "x".repeat(
        ipfs.PROPOSAL_METADATA_SCHEMA.maxBodyLength + 1,
      ),
    },
    ipfs.PROPOSAL_METADATA_SCHEMA,
  );
  assert.equal(result.valid, false);
  assert.match(result.error, /maximum length/);

  result = ipfs.validateMetadataSchema(
    {
      version: 1,
      body: "valid",
      createdAt: "not-a-date",
    },
    ipfs.PROPOSAL_METADATA_SCHEMA,
  );
  assert.equal(result.valid, false);
  assert.match(result.error, /Invalid createdAt/);

  result = ipfs.validateMetadataSchema(
    {
      version: 1,
      body: "valid",
      createdAt: new Date().toISOString(),
    },
    ipfs.PROPOSAL_METADATA_SCHEMA,
  );
  assert.deepEqual(result, { valid: true });
});

test("comment metadata schema requires its additional fields", () => {
  let result = ipfs.validateMetadataSchema(
    {
      version: 1,
      body: "comment",
    },
    ipfs.COMMENT_METADATA_SCHEMA,
  );

  assert.equal(result.valid, false);
  assert.match(result.error, /createdAt/);

  result = ipfs.validateMetadataSchema(
    {
      version: 1,
      body: "comment",
      createdAt: new Date().toISOString(),
    },
    ipfs.COMMENT_METADATA_SCHEMA,
  );

  assert.deepEqual(result, { valid: true });
});

test("CID validation accepts supported formats and rejects invalid lengths", () => {
  assert.equal(ipfs.isValidCid(cidV0), true);
  assert.equal(ipfs.isValidCid(cidV1), true);

  assert.equal(ipfs.isValidCid(""), false);
  assert.equal(ipfs.isValidCid("not-a-cid"), false);
  assert.equal(ipfs.isValidCid("Qm123"), false);
  assert.equal(ipfs.isValidCid("bafy123"), false);
});

test("fetch operations reject use before client initialization", async () => {
  await assert.rejects(
    ipfs.fetchContent("invalid-cid"),
    /Pinata client not initialized/,
  );

  await assert.rejects(
    ipfs.fetchRawContent("invalid-cid"),
    /Pinata client not initialized/,
  );
});

test("public URLs include the requested CID", () => {
  const urls = ipfs.getPublicUrls(cidV1);

  assert.equal(typeof urls.primary, "string");
  assert.match(urls.primary, new RegExp(cidV1));
  assert.ok(Array.isArray(urls.fallbacks));
  assert.ok(urls.fallbacks.length > 0);

  for (const url of urls.fallbacks) {
    assert.match(url, new RegExp(cidV1));
  }
});

test("initialization requires a JWT", () => {
  assert.throws(
    () => ipfs.initPinata(""),
    /PINATA_JWT is required/,
  );
});

// Issue #379: primary Pinata gateway failure should fail over to the public
// gateway chain instead of surfacing an error immediately. These two tests
// initialize Pinata (with a fake JWT — init only sets local state, no
// network call) and mock global fetch, so they run last: nothing after them
// depends on the module's pre-initialization "not initialized" behavior.

test("fetchContent falls back to a public gateway when the primary fails", async () => {
  ipfs.initPinata("fake-jwt-for-test");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("gateway.pinata.cloud")) {
      throw new Error("primary gateway unreachable");
    }
    if (href.startsWith("https://ipfs.io/ipfs/")) {
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ hello: "world" }),
      };
    }
    throw new Error(`unexpected fetch to ${href}`);
  };

  try {
    const result = await ipfs.fetchContent(cidV1);
    assert.deepEqual(result.data, { hello: "world" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchRawContent throws the original error when every gateway fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("gateway unreachable");
  };

  try {
    await assert.rejects(
      ipfs.fetchRawContent(cidV1),
      /gateway unreachable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
