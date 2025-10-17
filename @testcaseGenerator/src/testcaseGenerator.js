import { HTMLParser } from "./parsers/htmlParser.js";
import { CSSParser } from "./parsers/cssParser.js";
import { JSParser } from "./parsers/jsParser.js";
import fs from "fs";
import path from "path";

export class TestcaseGenerator {
  constructor() {
    this.htmlParser = new HTMLParser();
    this.cssParser = new CSSParser();
    this.jsParser = new JSParser();
    this.results = {};
  }

  /**
   * @param {Object} files
   * @param {Object} options
   * @returns {Object}
   */
  async generateFromFiles(files, options = {}) {
    this.results = {
      Code_Validation: {}
    };

    const {
      includeStructure = true,
      includeStyles = true,
      includeEvents = true,
      includeFunctions = true,
      includeConditions = true,
      includeObjects = true,
      autoDetect = true
    } = options;

    for (const [filename, content] of Object.entries(files)) {
      const fileExtension = path.extname(filename).toLowerCase();
      
      switch (fileExtension) {
        case '.html':
          await this.processHTML(filename, content, { includeStructure });
          break;
        case '.css':
          await this.processCSS(filename, content, { includeStyles });
          break;
        case '.js':
          await this.processJS(filename, content, {
            includeEvents,
            includeFunctions,
            includeConditions,
            includeObjects,
            autoDetect
          });
          break;
        default:
          console.warn(`Unsupported file type: ${fileExtension}`);
      }
    }

    return this.results;
  }

  /**
   * @param {string} code
   * @param {string} language
   * @param {Object} options
   * @returns {Object}
   */
  async generateFromCode(code, language, options = {}) {
    const filename = `code.${language}`;
    const files = { [filename]: code };
    return await this.generateFromFiles(files, options);
  }

  /**
   * @param {string} filename
   * @param {string} content
   * @param {Object} options
   */
  async processHTML(filename, content, options = {}) {
    const { includeStructure } = options;
    
    if (!includeStructure) return;

    const htmlResult = this.htmlParser.parse(content);
    
    this.results.Code_Validation[filename] = {
      Ans: content,
      structure: htmlResult.structure
    };

    // Add interactive elements suggestions
    const interactiveElements = htmlResult.interactiveElements || [];
    if (interactiveElements.length > 0) {
      this.results.Code_Validation[filename].suggestions = {
        interactiveElements: interactiveElements.map(el => ({
          selector: this.htmlParser.getElementSelector(el),
          tag: el.tag,
          id: el.id,
          classes: el.classes,
          suggestedTests: this.generateInteractiveElementTests(el)
        }))
      };
    }
  }

  /**
   * @param {string} filename
   * @param {string} content
   * @param {Object} options
   */
  async processCSS(filename, content, options = {}) {
    const { includeStyles } = options;
    
    if (!includeStyles) return;

    const cssResult = await this.cssParser.parse(content);
    
    if (!this.results.Code_Validation[filename]) {
      this.results.Code_Validation[filename] = {
        Ans: content,
        structure: []
      };
    }

    this.results.Code_Validation[filename].structure.push(...cssResult.styleTests);

    this.results.Code_Validation[filename].analysis = {
      selectors: cssResult.selectors,
      properties: cssResult.properties,
      colors: cssResult.colors || [],
      layoutProperties: cssResult.layoutProperties || [],
      mediaQueries: cssResult.mediaQueries || []
    };
  }

  /**
   * @param {string} filename
   * @param {string} content
   * @param {Object} options
   */
  async processJS(filename, content, options = {}) {
    const {
      includeEvents,
      includeFunctions,
      includeConditions,
      includeObjects,
      autoDetect
    } = options;

    const jsResult = this.jsParser.parse(content);
    
    this.results.Code_Validation[filename] = {
      Ans: content,
      structure: []
    };

    // Add tests based on options
    if (includeEvents && jsResult.events.length > 0) {
      const eventTests = jsResult.tests.filter(test => test.type === "event");
      this.results.Code_Validation[filename].structure.push(...eventTests);
    }

    if (includeFunctions && jsResult.functions.length > 0) {
      const functionTests = jsResult.tests.filter(test => test.type === "function");
      this.results.Code_Validation[filename].structure.push(...functionTests);
    }

    if (includeConditions && jsResult.conditions.length > 0) {
      const conditionTests = jsResult.tests.filter(test => test.type === "condition");
      this.results.Code_Validation[filename].structure.push(...conditionTests);
    }

    if (includeObjects && jsResult.objects.length > 0) {
      const objectTests = jsResult.tests.filter(test => test.type === "object");
      this.results.Code_Validation[filename].structure.push(...objectTests);
    }

    // Add JavaScript analysis
    this.results.Code_Validation[filename].analysis = {
      events: jsResult.events,
      functions: jsResult.functions,
      variables: jsResult.variables,
      conditions: jsResult.conditions,
      objects: jsResult.objects,
      domManipulations: jsResult.domManipulations
    };

    // Auto-detect suggestions
    if (autoDetect) {
      this.results.Code_Validation[filename].suggestions = this.generateSuggestions(jsResult);
    }
  }

  /**
   * Generate suggestions for JavaScript code
   * @param {Object} jsResult - JavaScript parsing result
   * @returns {Object} Suggestions object
   */
  generateSuggestions(jsResult) {
    const suggestions = {
      missingTests: [],
      potentialIssues: [],
      improvements: []
    };

    // Check for missing event tests
    const eventElements = jsResult.events.map(e => e.element);
    const uniqueElements = [...new Set(eventElements)];
    
    for (const element of uniqueElements) {
      const elementEvents = jsResult.events.filter(e => e.element === element);
      if (elementEvents.length > 0) {
        suggestions.missingTests.push({
          type: "event",
          description: `Add comprehensive tests for ${element} element`,
          element: element,
          events: elementEvents.map(e => e.event)
        });
      }
    }

    // Check for functions without tests
    for (const func of jsResult.functions) {
      if (func.name && !func.name.includes("anonymous")) {
        suggestions.missingTests.push({
          type: "function",
          description: `Add test cases for function ${func.name}`,
          functionName: func.name,
          parameters: func.parameters
        });
      }
    }

    // Check for potential issues
    if (jsResult.domManipulations.length === 0 && jsResult.events.length > 0) {
      suggestions.potentialIssues.push({
        type: "warning",
        message: "Events detected but no DOM manipulation found. Check if event handlers are working correctly."
      });
    }

    // Check for missing error handling
    const hasTryCatch = jsResult.functions.some(f => 
      f.body && f.body.includes("try") && f.body.includes("catch")
    );
    
    if (!hasTryCatch && jsResult.functions.length > 0) {
      suggestions.improvements.push({
        type: "error_handling",
        message: "Consider adding error handling (try-catch) to functions"
      });
    }

    return suggestions;
  }

  /**
   * Generate tests for interactive elements
   * @param {Object} element - Element information
   * @returns {Array} Array of suggested tests
   */
  generateInteractiveElementTests(element) {
    const tests = [];

    // Basic interaction test
    tests.push({
      type: "event",
      description: `${element.tag} should be interactive`,
      selector: this.htmlParser.getElementSelector(element),
      event: "click",
      expected: { triggered: true }
    });

    // Hover test for buttons
    if (element.tag === "button") {
      tests.push({
        type: "event",
        description: `${element.tag} should respond to hover`,
        selector: this.htmlParser.getElementSelector(element),
        event: "mouseover",
        expected: { triggered: true }
      });
    }

    // Form validation for forms
    if (element.tag === "form") {
      tests.push({
        type: "event",
        description: `${element.tag} should handle submit`,
        selector: this.htmlParser.getElementSelector(element),
        event: "submit",
        expected: { triggered: true }
      });
    }

    return tests;
  }

  /**
   * Save generated testcases to file
   * @param {string} filepath - Output file path
   * @param {Object} options - Save options
   */
  async saveToFile(filepath, options = {}) {
    const { pretty = true } = options;
    
    const jsonString = pretty 
      ? JSON.stringify(this.results, null, 2)
      : JSON.stringify(this.results);

    await fs.promises.writeFile(filepath, jsonString, 'utf-8');
    console.log(`Testcases saved to: ${filepath}`);
  }

  /**
   * Load files from directory
   * @param {string} directory - Directory path
   * @param {Array} extensions - File extensions to include
   * @returns {Object} Files object
   */
  async loadFilesFromDirectory(directory, extensions = ['.html', '.css', '.js']) {
    const files = {};
    
    try {
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            const filepath = path.join(directory, entry.name);
            const content = await fs.promises.readFile(filepath, 'utf-8');
            files[entry.name] = content;
          }
        }
      }
    } catch (error) {
      console.error(`Error loading files from directory: ${error.message}`);
    }

    return files;
  }

  /**
   * Get statistics about generated testcases
   * @returns {Object} Statistics object
   */
  getStatistics() {
    const stats = {
      totalFiles: Object.keys(this.results.Code_Validation).length,
      totalTests: 0,
      testTypes: {},
      suggestions: 0
    };

    for (const [filename, fileData] of Object.entries(this.results.Code_Validation)) {
      const tests = fileData.structure || [];
      stats.totalTests += tests.length;

      for (const test of tests) {
        stats.testTypes[test.type] = (stats.testTypes[test.type] || 0) + 1;
      }

      if (fileData.suggestions) {
        stats.suggestions += Object.values(fileData.suggestions).flat().length;
      }
    }

    return stats;
  }
}
