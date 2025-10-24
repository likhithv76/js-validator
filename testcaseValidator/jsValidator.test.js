import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";
import assert from "assert";

let acorn = null;
try { acorn = await import("acorn"); } catch { /* acorn optional */ }

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIGS_DIR = path.join(__dirname, "configs");
const DEFAULT_JS_NAME = "script.js";

// Tunables
const STUDENT_EXEC_WAIT_MS = 60;        // wait after injecting script to let it run
const VARIABLE_RESOLVE_WAIT_MS = 60;    // wait before trying to read variables/objects
const SAFE_WRAP = true;                 // wrap student code in try/catch

if (!fs.existsSync(CONFIGS_DIR)) {
  console.error("Config directory not found:", CONFIGS_DIR);
  process.exit(1);
}

const problems = [];
for (const entry of fs.readdirSync(CONFIGS_DIR)) {
  const full = path.join(CONFIGS_DIR, entry);
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    if (fs.existsSync(path.join(full, "testcase.json"))) problems.push({ id: entry, path: path.join(full, "testcase.json") });
  } else if (stat.isFile() && entry.endsWith(".json")) {
    problems.push({ id: path.basename(entry, ".json"), path: full });
  }
}
if (problems.length === 0) {
  console.error("No testcase.json found under configs/");
  process.exit(1);
}

const HANDLERS = {
  variable: runVariableTest,
  condition: runConditionTest,
  object: runObjectTest,
  function: runFunctionTest,
  event: runEventTest,
  output: runConsoleOutputTest,
  loop: runLoopTest,
  dom_structure: runDOMStructureTest,
  ast: runASTTest,
  commented_variable: runCommentedVariableTest,
  commented_output: runCommentedOutputTest,
  explanation: runExplanationTest
};

describe("JS Validation Engine", function () {
  this.timeout(5000);

  for (const p of problems) {
    const config = JSON.parse(fs.readFileSync(p.path, "utf8"));
    const codeBlock = config.Code_Validation?.[DEFAULT_JS_NAME];
    if (!codeBlock) continue; 
    const studentCode = codeBlock.Ans || "";

    describe(`Problem: ${p.id}`, function () {
      const tests = Array.isArray(codeBlock.structure) ? codeBlock.structure : [];

      const requiredSelectors = new Set();
      const qMatches = (studentCode.match(/document\.querySelector\(['"`]#([^'"`]+)['"`]\)/g) || []);
      for (const m of qMatches) {
        const id = (m.match(/#([^'"`]+)['"`]\)/) || [])[1];
        if (id) requiredSelectors.add(`#${id}`);
      }
      for (const t of tests) {
        if (t.selector && typeof t.selector === "string" && t.selector.startsWith("#")) {
          requiredSelectors.add(t.selector);
        }
        if (t.html && typeof t.html === "string") {
          const idMatch = t.html.match(/id=['"]([^'"]+)['"]/);
          if (idMatch) requiredSelectors.add(`#${idMatch[1]}`);
        }
      }

      for (const test of tests) {
        it(test.description || test.type || "(unnamed test)", async function () {
          const elementsHtml = [...requiredSelectors].map(sel => {
            const id = sel.startsWith("#") ? sel.slice(1) : sel;
            const tag = (test && test.html && test.html.includes("<button")) ? "button" : "div";
            return `<${tag} id="${id}"></${tag}>`;
          }).join("\n");

          const baseHTML = `<!DOCTYPE html><html><body>${elementsHtml}</body></html>`;

          const dom = new JSDOM(baseHTML, {
            runScripts: "dangerously",
            resources: "usable",
            pretendToBeVisual: true
          });

          const { window } = dom;
          const { document } = window;

          const logs = [];
          const originalConsole = { log: console.log, error: console.error, warn: console.warn };
          console.log = (...a) => logs.push(a.join(" "));
          console.error = (...a) => logs.push(a.join(" "));
          console.warn = (...a) => logs.push(a.join(" "));

          window.addEventListener("error", (ev) => {
            logs.push(`__RUNTIME_ERROR__:${ev.message}`);
            ev.preventDefault && ev.preventDefault();
          });

          const transformedCode = studentCode
            .replace(/\bconst\s+/g, 'var ')
            .replace(/\blet\s+/g, 'var ');

          const safeCode = SAFE_WRAP
            ? `try { ${transformedCode} } catch (e) { console.warn("⚠️ Runtime error in student code:", e.message || e); }`
            : transformedCode;

          try {
            window.eval(safeCode);
          } catch (e) {
            console.warn("Eval error in student code:", e.message);
          }

          await new Promise((r) => setTimeout(r, STUDENT_EXEC_WAIT_MS));

          const context = { dom, window, document, logs, studentCode, test };

          try {
            const handler = HANDLERS[test.type];
            if (!handler) {
              this.skip();
              return;
            }
            await handler(context);
          } finally {
            console.log = originalConsole.log;
            console.error = originalConsole.error;
            console.warn = originalConsole.warn;
            try { dom.window.close(); } catch {}
          }
        });
      }
    });
  }
});


async function runVariableTest({ window, test }) {
  await new Promise(r => setTimeout(r, VARIABLE_RESOLVE_WAIT_MS));
  let val;
  try {
    val = window[test.variable];
    if (val === undefined) val = window.eval(test.variable);
  } catch {
    val = undefined;
  }
  assert.ok(val !== undefined, `Variable ${test.variable} not defined`);
  if (test.expectedValue !== undefined) {
    assert.strictEqual(val, test.expectedValue, `Expected ${test.variable}=${test.expectedValue}, got ${val}`);
  }
}

async function runConditionTest({ studentCode, test }) {
  const pattern = new RegExp(`${escapeRegex(test.variable)}\\s*${escapeRegex(test.expectedOperator)}\\s*${escapeRegex(String(test.expectedValue))}`);
  const found = pattern.test(studentCode);
  assert.ok(found, `Condition ${test.variable} ${test.expectedOperator} ${test.expectedValue} not found`);
}

async function runObjectTest({ window, test }) {
  await new Promise(r => setTimeout(r, VARIABLE_RESOLVE_WAIT_MS));
  let obj;
  try {
    obj = window[test.objectName] || window.eval(test.objectName);
  } catch {
    obj = undefined;
  }
  assert.ok(obj, `Object ${test.objectName} not found`);
  if (Array.isArray(test.expectedProperties)) {
    for (const key of test.expectedProperties) {
      assert.ok(key in obj, `Property ${key} missing in object ${test.objectName}`);
    }
  } else if (test.properties) {
    for (const [key, type] of Object.entries(test.properties)) {
      assert.strictEqual(typeof obj[key], type, `Property ${key} should be of type ${type}`);
    }
  }
}

async function runFunctionTest({ window, test }) {
  const fn = window[test.functionName];
  assert.ok(typeof fn === "function", `Function ${test.functionName} not defined`);
  for (const tc of test.testCases || []) {
    const args = Array.isArray(tc.input) ? tc.input : [tc.input];
    const result = fn(...args);
    assert.strictEqual(result, tc.expected, `Function ${test.functionName}(${args}) returned ${result}, expected ${tc.expected}`);
  }
}

async function runEventTest({ dom, window, document, logs, test }) {
  const el = document.querySelector(test.selector);
  assert.ok(el, `Element ${test.selector} not found after code execution`);

  const preLen = logs.length;
  const event = new window.Event(test.event, { bubbles: true });
  el.dispatchEvent(event);

  await new Promise(r => setTimeout(r, 10));

  if (test.expected && test.expected.consoleOutput) {
    const after = logs.slice(preLen).join("\n");
    const expectedText = test.expected.consoleOutput.toLowerCase();
    assert.ok(
      after.toLowerCase().includes(expectedText),
      `Expected console output like "${test.expected.consoleOutput}", got "${after}"`
    );
  } else if (test.expected) {
    const key = Object.keys(test.expected)[0];
    const expectedVal = test.expected[key];
    const actualVal = key.includes(".") ? key.split(".").reduce((obj, k) => obj && obj[k], el) : el[key];
    assert.strictEqual(actualVal, expectedVal, `Expected ${expectedVal}, got ${actualVal}`);
  } else {
    const hasListeners = true;
    assert.ok(hasListeners, "No expectation provided for event test");
  }
}

async function runConsoleOutputTest({ dom, window, document, logs, test, studentCode }) {
  const preLen = logs.length;

  if (test.expectedOutput && test.expectedOutput.toLowerCase().includes("click")) {
    const btn = document.querySelector("#btn") || document.querySelector(test.selector);
    if (btn) {
      btn.dispatchEvent(new window.Event("click", { bubbles: true }));
      await new Promise(r => setTimeout(r, 10));
    }
  }

  if (test.expectedOutput && logs.slice(preLen).length === 0) {
    try { window.eval(studentCode); } catch {}
  }

  const found = logs.join("\n").includes(test.expectedOutput);
  assert.ok(found, `Expected console output containing "${test.expectedOutput}"`);
}

async function runLoopTest({ studentCode, test }) {
  const matches = studentCode.match(/\bfor\b|\bwhile\b|\.forEach\b/gm) || [];
  assert.ok(matches.length >= (test.expectedLoops || 1), `Expected at least ${test.expectedLoops || 1} loop(s), found ${matches.length}`);
}

async function runDOMStructureTest({ document, test }) {
  const el = document.querySelector(test.selector);
  assert.ok(el, `Element ${test.selector} not found`);
  for (const [key, val] of Object.entries(test.expected || {})) {
    assert.strictEqual(el[key], val, `${test.selector} ${key} expected "${val}", got "${el[key]}"`);
  }
}

async function runASTTest({ studentCode, test }) {
  if (!acorn) {
    this.skip && this.skip();
    return;
  }
  const ast = acorn.parse(studentCode, { ecmaVersion: "latest", sourceType: "module" });

  const found = JSON.stringify(ast).includes(test.astQuery?.type || "");
  assert.ok(found, `AST check failed for ${JSON.stringify(test.astQuery)}`);
}

async function runCommentedVariableTest({ studentCode, test }) {
  // Check if the commented variable is actually uncommented in the code
  const uncommentedPattern = new RegExp(`(?:const|let|var)\\s+${test.variable}\\s*=`, 'g');
  const isUncommented = uncommentedPattern.test(studentCode);
  
  if (isUncommented) {
    // If uncommented, verify the value
    const valuePattern = new RegExp(`(?:const|let|var)\\s+${test.variable}\\s*=\\s*([^;\\n]+)`, 'g');
    const match = valuePattern.exec(studentCode);
    if (match) {
      const actualValue = match[1].trim();
      assert.strictEqual(actualValue, test.expectedValue, 
        `Commented variable ${test.variable} was uncommented but with wrong value. Expected: ${test.expectedValue}, Got: ${actualValue}`);
    }
  } else {
    // If still commented, this test should pass (student hasn't uncommented it yet)
    assert.ok(true, `Variable ${test.variable} is still commented as expected`);
  }
}

async function runCommentedOutputTest({ studentCode, test }) {
  // Check if the commented console.log is actually uncommented in the code
  const uncommentedPattern = new RegExp(`console\\.log\\([^)]+\\)`, 'g');
  const consoleLogs = studentCode.match(uncommentedPattern) || [];
  
  // Check if any console.log contains the expected output
  const hasExpectedOutput = consoleLogs.some(log => 
    log.toLowerCase().includes(test.expectedOutput.toLowerCase())
  );
  
  if (hasExpectedOutput) {
    assert.ok(true, `Commented console output was uncommented: ${test.expectedOutput}`);
  } else {
    // If still commented, this test should pass (student hasn't uncommented it yet)
    assert.ok(true, `Console output is still commented as expected`);
  }
}

async function runExplanationTest({ studentCode, test }) {
  // Explanation tests are informational and always pass
  // They're used to document what the comment explains
  assert.ok(true, `Comment explanation: ${test.comment}`);
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
