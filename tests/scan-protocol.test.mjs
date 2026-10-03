import assert from "node:assert/strict";
import test from "node:test";
import {
  SCAN_PROTOCOL_VERSION,
  ScanProtocolError,
  createEmptyCoverage,
  parseScanRequest,
  parseScanResult,
} from "../lib/scan/protocol.ts";

const H1 = "1".repeat(64);
const H2 = "a".repeat(64);

function request(overrides = {}) {
  return {
    protocolVersion: SCAN_PROTOCOL_VERSION,
    runId: "synthetic-run-001",
    buildVersion: "dev-synthetic",
    adapterVersion: "none",
    selectedSnapshot: {
      id: "synthetic-main",
      role: "main",
      sha256: H1,
    },
    sourceHashes: {
      "synthetic.job": H1,
      "synthetic.master": H2,
    },
    units: "unknown",
    coordinateFrame: "synthetic-board-frame",
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    ...request(),
    status: "success",
    blockedReasons: [],
    unsupportedReasons: [],
    findings: [],
    coverage: createEmptyCoverage(),
    ...overrides,
  };
}

test("valid request normalizes hashes without mutating input", () => {
  const input = request({
    sourceHashes: {
      "b.synthetic": H2.toUpperCase(),
      "a.synthetic": H1,
    },
  });
  const before = structuredClone(input);

  const parsed = parseScanRequest(input);

  assert.deepEqual(input, before);
  assert.deepEqual(Object.keys(parsed.sourceHashes), [
    "a.synthetic",
    "b.synthetic",
  ]);
  assert.equal(parsed.sourceHashes["b.synthetic"], H2);
});

test("unsupported protocol version rejects explicitly", () => {
  assert.throws(
    () => parseScanRequest(request({ protocolVersion: "99" })),
    (error) =>
      error instanceof ScanProtocolError &&
      error.code === "UNSUPPORTED_PROTOCOL_VERSION",
  );
});

test("missing selected snapshot rejects", () => {
  const input = request();
  delete input.selectedSnapshot;
  assert.throws(() => parseScanRequest(input), ScanProtocolError);
});

test("invalid source hash rejects", () => {
  assert.throws(
    () =>
      parseScanRequest(
        request({
          sourceHashes: { "synthetic.job": "not-a-hash" },
        }),
      ),
    (error) =>
      error instanceof ScanProtocolError &&
      error.code === "INVALID_SHA256",
  );
});

test("blocked and unsupported states are distinct", () => {
  const blocked = parseScanResult(
    result({
      status: "blocked",
      blockedReasons: ["synthetic hold"],
    }),
  );
  const unsupported = parseScanResult(
    result({
      status: "unsupported",
      unsupportedReasons: ["synthetic format"],
    }),
  );

  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.blockedReasons, ["synthetic hold"]);
  assert.equal(unsupported.status, "unsupported");
  assert.deepEqual(unsupported.unsupportedReasons, [
    "synthetic format",
  ]);
});

test("contradictory result state rejects", () => {
  assert.throws(
    () =>
      parseScanResult(
        result({
          status: "success",
          blockedReasons: ["synthetic hold"],
        }),
      ),
    (error) =>
      error instanceof ScanProtocolError &&
      error.code === "CONTRADICTORY_STATUS",
  );
});

test("coverage states remain distinct", () => {
  const parsed = parseScanResult(
    result({
      coverage: {
        represented: 8,
        enabled: 7,
        taught: 6,
        verified: 2,
        released: null,
      },
    }),
  );

  assert.deepEqual(parsed.coverage, {
    represented: 8,
    enabled: 7,
    taught: 6,
    verified: 2,
    released: null,
  });
});

test("unknown coverage remains unknown", () => {
  assert.deepEqual(createEmptyCoverage(), {
    represented: null,
    enabled: null,
    taught: null,
    verified: null,
    released: null,
  });
});

test("duplicate finding IDs reject", () => {
  const finding = {
    id: "synthetic-finding",
    code: "SYN-001",
    title: "Synthetic finding",
  };

  assert.throws(
    () =>
      parseScanResult(
        result({
          findings: [finding, finding],
        }),
      ),
    (error) =>
      error instanceof ScanProtocolError &&
      error.code === "DUPLICATE_FINDING_ID",
  );
});

test("identical input yields deterministic parsed metadata", () => {
  const input = result({
    findings: [
      {
        id: "synthetic-finding",
        code: "SYN-001",
        title: "Synthetic finding",
      },
    ],
  });

  assert.deepEqual(
    parseScanResult(input),
    parseScanResult(structuredClone(input)),
  );
});
