import fs from "fs";
import path from "path";
import assert from "assert";
import { JSDOM } from "jsdom";

describe("DOM Validation Tests", function () {
  const config = JSON.parse(fs.readFileSync(path.resolve("./configs/testcase.json"), "utf-8"));
  const jsBlock = config.Code_Validation["domScript.js"];
  // Read the actual student submission instead of the expected answer
  const code = fs.readFileSync(path.resolve("./student_submissions/domScript.js"), "utf-8");
  const tests = jsBlock.structure;

  tests.forEach((t) => {
    it(t.description, function () {
      // Create empty DOM and let student code create the elements
      const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { 
        runScripts: "dangerously", 
        resources: "usable" 
      });

      // Inject student's code
      const scriptEl = dom.window.document.createElement("script");
      scriptEl.textContent = code;
      dom.window.document.body.appendChild(scriptEl);

      // Run the event
      const el = dom.window.document.querySelector(t.selector);
      const event = new dom.window.Event(t.event, { bubbles: true });
      el.dispatchEvent(event);

      // Extract nested key (like "dataset.submitted")
      const key = Object.keys(t.expected)[0];
      const expectedVal = t.expected[key];
      const actualVal = key.includes(".")
        ? key.split(".").reduce((obj, k) => obj[k], el)
        : el[key];

      assert.strictEqual(actualVal, expectedVal, `Expected ${expectedVal}, got ${actualVal}`);
    });
  });
});
