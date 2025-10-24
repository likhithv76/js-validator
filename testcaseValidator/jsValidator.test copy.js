import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";
import assert from "assert";
import vm from "vm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIGS_DIR = path.join(__dirname, "configs");

if (!fs.existsSync(CONFIGS_DIR)) {
  console.error(`Config directory not found: ${CONFIGS_DIR}`);
  process.exit(1);
}

const testcasePath = path.join(CONFIGS_DIR, "testcase2.json");
const problems = fs.existsSync(testcasePath) ? ["testcase"] : [];

describe("JS Validation Engine", function () {
  for (const problemId of problems) {
    const configPath = path.join(CONFIGS_DIR, "testcase.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const validation = config.Code_Validation["script.js"];
    const studentCode = validation.Ans;

    describe(`Problem: ${problemId}`, function () {
      const tests = validation.structure;

      for (const test of tests) {
        it(test.description || test.type, async function () {
          const originalLog = console.log;
          console.log = () => { };

          try {
            // Collect all required DOM elements from tests and student code
            const requiredElements = new Set();

            // Collect selectors from test definitions
            for (const t of tests) {
              if (t.selector && t.selector.startsWith("#")) {
                requiredElements.add(t.selector.slice(1));
              }
            }

            // Scan student code for document.querySelector usage
            const selectorMatches = studentCode.match(/document\.querySelector\(["']#(.*?)["']\)/g) || [];
            for (const match of selectorMatches) {
              const id = match.match(/#(.*?)["']/)[1];
              requiredElements.add(id);
            }

            // Build comprehensive HTML with all required elements
            const html = `
<!DOCTYPE html>
<html>
<body>
  ${[...requiredElements].map(id => `<div id="${id}"></div>`).join("\n")}
</body>
</html>
`;

            // Create JSDOM with pre-existing elements
            const dom = new JSDOM(html, {
              runScripts: "dangerously",
              resources: "usable",
              pretendToBeVisual: true
            });


            const { window } = dom;
            const { document } = window;
            global.window = window;
            global.document = document;
            global.HTMLElement = window.HTMLElement;
            global.Event = window.Event;

            window.addEventListener("error", e => {
              console.warn("⚠️ Runtime error in student code:", e.message);
            });

            // Wrap student code in try/catch to prevent runtime errors from crashing tests
            const safeCode = `
try {
  ${studentCode}
} catch (e) {
  console.warn("⚠️ Runtime error in student code:", e.message);
}
`;
            const script = document.createElement("script");
            script.textContent = safeCode;
            document.body.appendChild(script);

            await new Promise(r => setTimeout(r, 10));

            // Execute based on test type
            switch (test.type) {
              case "condition":
                return runConditionTest(test, studentCode);

              case "function":
                return runFunctionTest(test, window);

              case "object":
                return runObjectTest(test, window);

              case "event":
                return await runEventTest(test, dom, studentCode);

              case "output":
                return runConsoleOutputTest(test, studentCode, dom);

              case "variable":
                return runVariableTest(test, window);

              case "loop":
                return runLoopTest(test, studentCode);

              case "dom_structure":
                return runDOMStructureTest(test, document);

              default:
                this.skip();
            }
          } finally {
            console.log = originalLog;
          }
        });
      }
    });
  }
});

//  Test Handlers
function runConditionTest(test, code) {
  const pattern = new RegExp(`${test.variable}\\s*${escapeRegex(test.expectedOperator)}\\s*${test.expectedValue}`);
  const found = pattern.test(code);
  assert.ok(found, `Condition ${test.variable} ${test.expectedOperator} ${test.expectedValue} not found`);
}

function runFunctionTest(test, window) {
  const fn = window[test.functionName];
  assert.ok(typeof fn === "function", `Function ${test.functionName} not defined`);

  for (const tc of test.testCases || []) {
    const args = Array.isArray(tc.input) ? tc.input : [tc.input];
    const result = fn(...args);
    assert.strictEqual(result, tc.expected, `Function ${test.functionName}(${args}) returned ${result}, expected ${tc.expected}`);
  }
}

async function runObjectTest(test, window) {
  await new Promise(r => setTimeout(r, 50)); // wait for const initialization

  let obj;
  try {
    obj = window[test.objectName] || window.eval(test.objectName);
  } catch {
    obj = undefined;
  }

  assert.ok(obj, `Object ${test.objectName} not found`);

  if (test.expectedProperties) {
    for (const key of test.expectedProperties) {
      assert.ok(key in obj, `Property ${key} missing in object ${test.objectName}`);
    }
  } else if (test.properties) {
    for (const [key, type] of Object.entries(test.properties)) {
      assert.strictEqual(typeof obj[key], type, `Property ${key} should be of type ${type}`);
    }
  }
}


async function runVariableTest(test, window) {
  await new Promise(r => setTimeout(r, 50)); // ensure student script executes fully

  let val;
  try {
    val = window[test.variable];
    if (val === undefined) val = window.eval(test.variable);
  } catch {
    val = undefined;
  }

  assert.ok(val !== undefined, `Variable ${test.variable} not defined`);
  if (test.expectedValue !== undefined)
    assert.strictEqual(val, test.expectedValue, `Expected ${test.variable}=${test.expectedValue}, got ${val}`);
}


async function runEventTest(test, dom) {
  const { window } = dom;
  const { document } = window;

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));

  await new Promise(r => setTimeout(r, 10));

  const el = document.querySelector(test.selector);
  assert.ok(el, `Element ${test.selector} not found after code execution`);

  const event = new window.Event(test.event, { bubbles: true });
  el.dispatchEvent(event);

  console.log = originalLog;

  if (test.expected.consoleOutput) {
    const match = logs.some(l => l.includes(test.expected.consoleOutput));
    assert.ok(match, `Expected ${test.expected.consoleOutput}, got ${logs.join(", ")}`);
  } else {
    const key = Object.keys(test.expected)[0];
    const expectedVal = test.expected[key];
    const actualVal = key.includes(".")
      ? key.split(".").reduce((obj, k) => obj[k], el)
      : el[key];

    assert.strictEqual(actualVal, expectedVal, `Expected ${expectedVal}, got ${actualVal}`);
  }
}


function runConsoleOutputTest(test, code, dom) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));

  try {
    const { window } = dom || {};
    const { document } = window || {};
    eval(code);

    // If this output is from a click event, simulate click
    if (test.expectedOutput?.toLowerCase().includes("clicked") && document) {
      const btn = document.querySelector("#btn");
      if (btn) btn.dispatchEvent(new window.Event("click"));
    }
  } catch (e) {}

  console.log = originalLog;

  const expected = test.expectedOutput || test.expected;
  const match = logs.some(l => l.includes(expected));
  assert.ok(match, `Expected console output containing "${expected}"`);
}

function runLoopTest(test, code) {
  const match = code.match(/for|while|forEach/g);
  const count = match ? match.length : 0;
  assert.ok(count >= (test.expectedLoops || 1), `Expected at least ${test.expectedLoops} loop(s), found ${count}`);
}

function runDOMStructureTest(test, document) {
  const el = document.querySelector(test.selector);
  assert.ok(el, `Element ${test.selector} not found`);
  for (const [key, val] of Object.entries(test.expected || {})) {
    assert.strictEqual(el[key], val, `${test.selector} ${key} expected "${val}", got "${el[key]}"`);
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
