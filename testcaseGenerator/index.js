import fs from "fs";
import path from "path";
import { JSParser } from "./jsParser.js";

const inputFile = process.argv[2];
const outputFile = process.argv[3] || "../testcaseValidator/configs/testcase.json";

if (!inputFile) {
  console.error("Usage: node index.js <script.js> [output.json]");
  process.exit(1);
}

const code = fs.readFileSync(inputFile, "utf-8");
const parser = new JSParser();
const result = parser.parse(code);

const output = {
  Code_Validation: {
    [path.basename(inputFile)]: {
      Ans: code,
      structure: result.structure
    }
  }
};

// Write to output file
fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf-8');
console.log(`Testcase generated and saved to: ${outputFile}`);

// Also log to console for verification
console.log("\nGenerated testcase:");
console.log(JSON.stringify(output, null, 2));
