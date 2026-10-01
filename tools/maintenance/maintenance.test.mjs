import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claim,
  allowedProposalPath,
  docsOnly,
  enqueue,
  git,
  openEngine,
  providerCommand,
  runJob,
  safePath,
  snapshot,
  validateReview,
} from "./engine.mjs";

test("one-shot watcher exposes reconciliation failures to its OS supervisor", (t) => {
  const engine = fixture(t);
  writeFileSync(join(engine.repo, "README.md"), Buffer.alloc(2 * 1024 * 1024 + 1, "a"));
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./cli.mjs", import.meta.url)), "watch", "--once", "--repo", engine.repo],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /snapshot exceeds maintenance byte budget/);
});

const review = {
  schema: "review-evidence.v1",
  summary: "Reviewed",
  findings: [],
  tests: [{ behavior: "retains source", risk: "mutation", boundary: "Git", command: "fixture", outcome: "passed" }],
  docs: [{ path: "README.md", outcome: "updated", reason: "clarity", evidence: "diff" }],
  changes: ["readme"],
  limitations: [],
};

function fixture(t, extra = {}) {
  const repo = mkdtempSync(join(tmpdir(), "maintenance-test-"));
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "test@example.invalid");
  git(repo, "config", "user.name", "Maintenance Test");
  writeFileSync(join(repo, "README.md"), "first\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-m", "initial");
  const engine = openEngine(repo, {
    observe: false,
    maxAttempts: 2,
    leaseMs: 1000,
    timeoutMs: 10000,
    validation: [["node", "--version"]],
    provider: "codex",
    ...extra,
  });
  t.after(() => {
    engine.db.close();
    rmSync(repo, { recursive: true, force: true });
  });
  return engine;
}
test("duplicate commit events create one queue job", (t) => {
  const engine = fixture(t);
  assert.equal(enqueue(engine).id, enqueue(engine).id);
});
test("content changes with unchanged Git status change snapshot fingerprint", (t) => {
  const engine = fixture(t);
  writeFileSync(join(engine.repo, "README.md"), "second\n");
  const before = snapshot(engine);
  writeFileSync(join(engine.repo, "README.md"), "third\n");
  assert.notEqual(before.fingerprint, snapshot(engine).fingerprint);
});
test("snapshot does not alter partial staging", (t) => {
  const engine = fixture(t);
  writeFileSync(join(engine.repo, "README.md"), "staged\n");
  git(engine.repo, "add", "README.md");
  writeFileSync(join(engine.repo, "README.md"), "unstaged\n");
  snapshot(engine);
  assert.equal(git(engine.repo, "show", ":README.md"), "staged\n");
  assert.equal(readFileSync(join(engine.repo, "README.md"), "utf8"), "unstaged\n");
});
test("expired lease is reclaimed with a distinct fencing token and bounded attempts", (t) => {
  const engine = fixture(t);
  enqueue(engine);
  const first = claim(engine, 0);
  const second = claim(engine, 1001);
  assert.notEqual(first.token, second.token);
  assert.equal(claim(engine, 2002), undefined);
  assert.equal(engine.db.prepare("SELECT status FROM jobs").get().status, "failed");
});
test("pause prevents claims and resume permits them", (t) => {
  const engine = fixture(t);
  enqueue(engine);
  engine.db.prepare("INSERT INTO settings VALUES(?,?)").run("paused", "true");
  assert.equal(claim(engine), undefined);
  engine.db.prepare("UPDATE settings SET value=?").run("false");
  assert.ok(claim(engine));
});
test("maintenance branches cannot recursively enqueue their changes", (t) => {
  const engine = fixture(t);
  git(engine.repo, "checkout", "-b", "maintenance/test");
  assert.equal(enqueue(engine).skipped, "maintenance branch");
});
test("invalid provider is rejected before claiming a job", (t) => {
  const engine = fixture(t);
  enqueue(engine);
  assert.throws(() => runJob(engine, { provider: "shell-command" }), /Unsupported provider/);
  assert.equal(engine.db.prepare("SELECT status FROM jobs").get().status, "queued");
});
test("dry run never invokes an agent or creates a worktree", (t) => {
  const engine = fixture(t);
  enqueue(engine);
  const result = runJob(engine, { dryRun: true, invoke: () => assert.fail("agent invoked") });
  assert.equal(result.status, "dry-run");
  assert.equal(result.worktree, undefined);
});
test("fake agent writes only an isolated proposal and durable patch", (t) => {
  const engine = fixture(t);
  enqueue(engine);
  const result = runJob(engine, {
    invoke: (_command, _args, options) => {
      writeFileSync(join(options.cwd, "README.md"), "proposal\n");
      writeFileSync(join(options.cwd, "maintenance-review.json"), JSON.stringify(review));
      return "reviewed";
    },
  });
  assert.equal(result.status, "proposed");
  assert.equal(readFileSync(join(engine.repo, "README.md"), "utf8"), "first\n");
  assert.match(readFileSync(join(result.output, "proposal.patch"), "utf8"), /proposal/);
});
test("documentation-only classification rejects tests and executable metadata", () => {
  assert.equal(docsOnly(["knowledge/behavior.md", ".agent-docs/modules.json"]), true);
  assert.equal(docsOnly(["docs/example.test.mjs"]), false);
  assert.equal(docsOnly([".agent-docs/cli.mjs"]), false);
});

test("merge introducing code uses full validation even for a documentation-only proposal", (t) => {
  const engine = fixture(t);
  git(engine.repo, "checkout", "-b", "feature/code");
  mkdirSync(join(engine.repo, "packages"));
  writeFileSync(join(engine.repo, "packages", "feature.mjs"), "export const enabled = true;\n");
  git(engine.repo, "add", "packages/feature.mjs");
  git(engine.repo, "commit", "-m", "add feature code");
  git(engine.repo, "checkout", "main");
  git(engine.repo, "merge", "--no-ff", "feature/code", "-m", "merge feature");
  enqueue(engine);
  const validationCommands = [];
  const result = runJob(engine, {
    invoke: (command, args, options) => {
      if (command === "codex") {
        writeFileSync(join(options.cwd, "README.md"), "Document merged feature.\n");
        writeFileSync(join(options.cwd, "maintenance-review.json"), JSON.stringify(review));
      } else validationCommands.push([command, ...args]);
      return "done";
    },
  });
  assert.equal(result.status, "proposed");
  assert.equal(result.validationProfile, "full");
  assert.deepEqual(validationCommands, engine.policy.validation);
});
test("review report requires meaningful documentation and test evidence", () => {
  assert.equal(validateReview(review).schema, "review-evidence.v1");
  assert.throws(() => validateReview({ ...review, docs: [] }), /assessment/);
  assert.throws(() => validateReview({ ...review, docs: [{ ...review.docs[0], reason: "" }] }), /documentation/);
});
test("old queued revision is superseded without running an agent", (t) => {
  const engine = fixture(t);
  enqueue(engine);
  writeFileSync(join(engine.repo, "README.md"), "new\n");
  git(engine.repo, "add", ".");
  git(engine.repo, "commit", "-m", "new");
  assert.equal(runJob(engine, { invoke: () => assert.fail("agent invoked") }).status, "superseded");
});
test("sensitive paths are excluded and provider commands are argument arrays", () => {
  assert.equal(safePath(".env.local"), false);
  assert.equal(safePath("artifacts/private.json"), false);
  assert.equal(safePath("packages/service.ts"), true);
  assert.equal(providerCommand("codex", "$(attack)")[1].at(-1), "$(attack)");
});
test("missing review fails and retries retain distinct attempt directories", (t) => {
  const engine = fixture(t);
  enqueue(engine);
  const first = runJob(engine, { invoke: () => "no report" });
  const second = runJob(engine, { invoke: () => "still no report" });
  assert.equal(first.status, "failed");
  assert.equal(second.status, "failed");
  assert.notEqual(first.output, second.output);
  assert.equal(engine.db.prepare("SELECT status FROM jobs").get().status, "failed");
});
test("workflow modifications fail proposal admission despite valid report", (t) => {
  const engine = fixture(t);
  enqueue(engine);
  const result = runJob(engine, {
    invoke: (_command, _args, options) => {
      mkdirSync(join(options.cwd, ".github"), { recursive: true });
      writeFileSync(join(options.cwd, ".github", "attack.yml"), "bad");
      writeFileSync(join(options.cwd, "maintenance-review.json"), JSON.stringify(review));
      return "done";
    },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error, /protected/);
});

test("validation cannot introduce a new protected untracked file after provider inspection", (t) => {
  const engine = fixture(t);
  enqueue(engine);
  const result = runJob(engine, {
    invoke: (command, _args, options) => {
      if (command === "codex") writeFileSync(join(options.cwd, "maintenance-review.json"), JSON.stringify(review));
      else {
        mkdirSync(join(options.cwd, ".github"), { recursive: true });
        writeFileSync(join(options.cwd, ".github", "late.yml"), "late mutation");
      }
      return "done";
    },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error, /protected/);
  assert.equal(result.validatedHead, undefined);
});

test("validation cannot certify changed content or a rewritten review report", (t) => {
  const engine = fixture(t);
  enqueue(engine);
  const result = runJob(engine, {
    invoke: (command, _args, options) => {
      if (command === "codex") writeFileSync(join(options.cwd, "maintenance-review.json"), JSON.stringify(review));
      else writeFileSync(join(options.cwd, "README.md"), "late edit not covered by checks");
      return "done";
    },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error, /Validation modified/);
});

test("lost fencing token cannot finalize or overwrite the new owner's queue row", (t) => {
  const engine = fixture(t);
  enqueue(engine);
  const result = runJob(engine, {
    invoke: (_command, _args, options) => {
      writeFileSync(join(options.cwd, "maintenance-review.json"), JSON.stringify(review));
      engine.db.prepare("UPDATE jobs SET token='new-owner',receipt='new-owner-receipt'").run();
      return "done";
    },
  });
  assert.equal(result.status, "fenced");
  assert.equal(result.validatedHead, undefined);
  assert.equal(engine.db.prepare("SELECT receipt FROM jobs").get().receipt, "new-owner-receipt");
  assert.equal(JSON.parse(readFileSync(join(result.output, "receipt.json"), "utf8")).status, "fenced");
});

test("source HEAD changing during checks produces a superseded receipt", (t) => {
  const engine = fixture(t);
  enqueue(engine);
  const result = runJob(engine, {
    invoke: (command, _args, options) => {
      if (command === "codex") writeFileSync(join(options.cwd, "maintenance-review.json"), JSON.stringify(review));
      else {
        writeFileSync(join(engine.repo, "README.md"), "new source commit");
        git(engine.repo, "add", "README.md");
        git(engine.repo, "commit", "-m", "new source");
      }
      return "done";
    },
  });
  assert.equal(result.status, "superseded");
  assert.equal(result.validatedHead, undefined);
});

test("canonical updater executables and encoded path escapes cannot be proposed", () => {
  for (const path of [
    ".agent-docs/cli.mjs",
    ".agent-docs/vendor/parser.js",
    "docs/a\\secret.md",
    "docs/a.md:secret",
    "docs/a./b.md",
    "docs/a.pfx",
  ])
    assert.equal(allowedProposalPath(path), false, path);
  assert.equal(allowedProposalPath(".agent-docs/modules.json"), true);
  assert.equal(allowedProposalPath(".agent-docs/provenance.json"), true);
});
