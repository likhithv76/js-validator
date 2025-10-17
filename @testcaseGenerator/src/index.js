import { TestcaseGenerator } from "./testcaseGenerator.js";
import fs from "fs";
import path from "path";

class TestcaseGeneratorCLI {
  constructor() {
    this.generator = new TestcaseGenerator();
  }

  /**
   * @param {Array} args
   */
  async run(args) {
    const command = args[2];
    
    switch (command) {
      case "generate":
        await this.generateCommand(args);
        break;
      case "analyze":
        await this.analyzeCommand(args);
        break;
      case "help":
        this.showHelp();
        break;
      default:
        console.log("Testcase Generator CLI");
        console.log("Use 'node src/index.js help' for usage information");
    }
  }

  /**
   * @param {Array} args - Command line arguments
   */
  async generateCommand(args) {
    const inputPath = args[3];
    const outputPath = args[4] || "./generated_testcases.json";
    
    if (!inputPath) {
      console.error("Error: Input path is required");
      console.log("Usage: node src/index.js generate <input_path> [output_path]");
      return;
    }

    try {
      let files = {};
      
      const stat = await fs.promises.stat(inputPath);
      
      if (stat.isDirectory()) {
        console.log(`Loading files from directory: ${inputPath}`);
        files = await this.generator.loadFilesFromDirectory(inputPath);
      } else if (stat.isFile()) {
        console.log(`Loading file: ${inputPath}`);
        const content = await fs.promises.readFile(inputPath, 'utf-8');
        const filename = path.basename(inputPath);
        files[filename] = content;
      }

      if (Object.keys(files).length === 0) {
        console.error("No supported files found in the input path");
        return;
      }

      console.log(`Found ${Object.keys(files).length} files:`, Object.keys(files));

      console.log("Generating testcases...");
      const result = await this.generator.generateFromFiles(files, {
        includeStructure: true,
        includeStyles: true,
        includeEvents: true,
        includeFunctions: true,
        includeConditions: true,
        includeObjects: true,
        autoDetect: true
      });

      await this.generator.saveToFile(outputPath);
      
      const stats = this.generator.getStatistics();
      console.log("\n📊 Generation Statistics:");
      console.log(`  Files processed: ${stats.totalFiles}`);
      console.log(`  Total tests generated: ${stats.totalTests}`);
      console.log(`  Test types:`, stats.testTypes);
      console.log(`  Suggestions: ${stats.suggestions}`);

    } catch (error) {
      console.error("Error generating testcases:", error.message);
    }
  }

  /**
   * @param {Array} args
   */
  async analyzeCommand(args) {
    const inputPath = args[3];
    
    if (!inputPath) {
      console.error("Error: Input path is required");
      console.log("Usage: node src/index.js analyze <input_path>");
      return;
    }

    try {
      const content = await fs.promises.readFile(inputPath, 'utf-8');
      const filename = path.basename(inputPath);
      const ext = path.extname(filename).toLowerCase();
      
      let analysis = {};
      
      switch (ext) {
        case '.html':
          const htmlResult = this.generator.htmlParser.parse(content);
          analysis = {
            elements: htmlResult.elements.length,
            selectors: htmlResult.selectors.length,
            interactiveElements: htmlResult.interactiveElements?.length || 0,
            structure: htmlResult.structure.length
          };
          break;
        case '.css':
          const cssResult = await this.generator.cssParser.parse(content);
          analysis = {
            rules: cssResult.rules.length,
            selectors: cssResult.selectors.length,
            properties: Object.keys(cssResult.properties).length,
            colors: cssResult.colors?.length || 0,
            mediaQueries: cssResult.mediaQueries?.length || 0
          };
          break;
        case '.js':
          const jsResult = this.generator.jsParser.parse(content);
          analysis = {
            events: jsResult.events.length,
            functions: jsResult.functions.length,
            variables: jsResult.variables.length,
            conditions: jsResult.conditions.length,
            objects: jsResult.objects.length,
            domManipulations: jsResult.domManipulations.length
          };
          break;
        default:
          console.error("Unsupported file type for analysis");
          return;
      }

      console.log(`\n📈 Analysis for ${filename}:`);
      for (const [key, value] of Object.entries(analysis)) {
        console.log(`  ${key}: ${value}`);
      }

    } catch (error) {
      console.error("Error analyzing file:", error.message);
    }
  }

  showHelp() {
    console.log(`
🧪 Testcase Generator CLI

USAGE:
  node src/index.js <command> [options]

COMMANDS:
  generate <input_path> [output_path]    Generate testcases from files/directory
  analyze <input_path>                   Analyze a single file
  help                                   Show this help message

EXAMPLES:
  # Generate testcases from a directory
  node src/index.js generate ./student-submissions ./testcases.json

  # Generate testcases from a single file
  node src/index.js generate ./index.html

  # Analyze a JavaScript file
  node src/index.js analyze ./script.js

SUPPORTED FILE TYPES:
  - HTML (.html) - Extracts DOM structure and interactive elements
  - CSS (.css)   - Extracts selectors, properties, and styles
  - JS (.js)     - Extracts events, functions, conditions, and objects

OUTPUT FORMAT:
  The generator creates JSON in the Code_Validation format:
  {
    "Code_Validation": {
      "filename": {
        "Ans": "original code",
        "structure": [test cases],
        "analysis": {parsed data},
        "suggestions": {recommendations}
      }
    }
  }
    `);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new TestcaseGeneratorCLI();
  cli.run(process.argv);
}

export { TestcaseGeneratorCLI };
