import assert from "node:assert/strict";
import test from "node:test";
import { consoleTargetFromTask } from "../lib/actions.js";

test("console connection reads a token stored as a string value object", () => {
  const url = consoleTargetFromTask({
    status: "SUCCEEDED",
    completionDetails: [
      { name: "websocketUri", value: { stringValue: "/vnc/vm/abc/proxy" } },
      { name: "vm_console_token", value: { stringValue: "jwt-1" } }
    ]
  }, "10.0.0.7");
  assert.equal(url, "wss://10.0.0.7:9440/vnc/vm/abc/proxy?VmConsoleToken=jwt-1");
});

test("console connection is read from task completion details", () => {
  const url = consoleTargetFromTask({
    status: "SUCCEEDED",
    completionDetails: [
      { name: "websocketUri", value: "/vnc/vm/abc/proxy" },
      { name: "vmConsoleToken", value: "jwt-1" }
    ]
  }, "10.0.0.7");
  assert.equal(url, "wss://10.0.0.7:9440/vnc/vm/abc/proxy?VmConsoleToken=jwt-1");
});
