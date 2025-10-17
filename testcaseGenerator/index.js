import fs from "fs";
import path from "path";
import { JSParser } from "./jsParser.js";

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: node index.js <script.js>");
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

console.log(JSON.stringify(output, null, 2));
