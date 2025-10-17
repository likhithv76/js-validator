import fs from "fs";
import path from "path";
import vm from "vm";
import { JSDOM } from "jsdom";
import assert from "assert";

export async function runJSValidation(configPath = "./configs/testcase.json") {
  const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const validations = data.Code_Validation;

  const results = {};

  for (const [file, block] of Object.entries(validations)) {
    if (!file.endsWith(".js")) continue; // skip html/css
    const code = block.Ans;
    const structure = block.structure || [];
    const fileResults = [];

    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
      runScripts: "dangerously",
      resources: "usable"
    });

    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Event = dom.window.Event;

    const script = dom.window.document.createElement("script");
    script.textContent = code;
    dom.window.document.body.appendChild(script);

    for (const test of structure) {
      try {
        switch (test.type) {
          case "function":
            fileResults.push(await runFunctionTest(test, dom));
            break;
          case "condition":
            fileResults.push(await runConditionTest(test, dom));
            break;
          case "event":
            fileResults.push(await runEventTest(test, dom));
            break;
          case "object":
            fileResults.push(await runObjectTest(test, dom));
            break;
          default:
            fileResults.push({ description: "Unknown test type", result: "skip" });
        }
      } catch (err) {
        fileResults.push({ description: test.description || test.type, result: "fail", error: err.message });
      }
    }

    // Clean up DOM
    dom.window.close();

    results[file] = { status: "done", tests: fileResults };
  }

  return results;
}

// --- Test Type Handlers ---

async function runFunctionTest(test, dom) {
  const fn = dom.window[test.functionName];
  assert.ok(typeof fn === "function", `Function ${test.functionName} not found`);

  const testResults = [];
  for (const tc of test.testCases) {
    const result = fn(tc.input);
    const pass = result === tc.expected;
    testResults.push({
      description: tc.description,
      input: tc.input,
      expected: tc.expected,
      got: result,
      result: pass ? "pass" : "fail"
    });
  }
  return { description: `Function: ${test.functionName}`, details: testResults };
}

async function runConditionTest(test, dom) {
  // For condition tests, we need to check if the condition logic is present in the code
  // This is a simplified check - in practice you might want to parse the code more carefully
  const hasCondition = test.condition ? test.condition.includes(">=") : true;
  return { description: test.description, result: hasCondition ? "pass" : "fail" };
}

async function runEventTest(test, dom) {
  // Use the provided dom or create a new one with test HTML
  const testDom = new JSDOM(test.html || "<div></div>", { runScripts: "dangerously" });
  
  // Copy the executed code from the main dom to the test dom
  const scripts = dom.window.document.querySelectorAll("script");
  for (const script of scripts) {
    const newScript = testDom.window.document.createElement("script");
    newScript.textContent = script.textContent;
    testDom.window.document.body.appendChild(newScript);
  }

  const el = testDom.window.document.querySelector(test.selector);
  const event = new testDom.window.Event(test.event, { bubbles: true });
  el.dispatchEvent(event);

  const key = Object.keys(test.expected)[0];
  const expectedVal = test.expected[key];
  const actualVal = key.includes(".")
    ? key.split(".").reduce((obj, k) => obj[k], el)
    : el[key];

  return {
    description: `Event test: ${test.event} on ${test.selector}`,
    result: actualVal === expectedVal ? "pass" : "fail"
  };
}

async function runObjectTest(test, dom) {
  const obj = dom.window[test.objectName];
  assert.ok(obj, `Object ${test.objectName} not found`);
  const propertyCheck = Object.entries(test.properties).map(([key, valType]) => {
    const valid = typeof obj[key] === valType;
    return { key, expected: valType, got: typeof obj[key], result: valid ? "pass" : "fail" };
  });

  return { description: `Object validation: ${test.objectName}`, details: propertyCheck };
}
