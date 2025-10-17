import { TestcaseGenerator } from "./testcaseGenerator.js";

export class TestcaseEditor {
  constructor() {
    this.generator = new TestcaseGenerator();
    this.currentCode = {};
    this.currentTestcases = {};
    this.listeners = new Map();
  }

  async loadCode(files, options = {}) {
    this.currentCode = files;
    
    const result = await this.generator.generateFromFiles(files, options);
    this.currentTestcases = result.Code_Validation;
    
    this.addEditingCapabilities();
    
    return this.currentTestcases;
  }

  addEditingCapabilities() {
    for (const [filename, fileData] of Object.entries(this.currentTestcases)) {
      if (fileData.structure) {
        fileData.structure = fileData.structure.map((test, index) => ({
          ...test,
          _id: `${filename}_${index}`,
          _editable: true,
          _original: { ...test },
          _modified: false
        }));
      }
    }
  }

  getTestcases(filename) {
    return this.currentTestcases[filename]?.structure || [];
  }

  getAllTestcases() {
    return this.currentTestcases;
  }

  addTestcase(filename, testcase) {
    if (!this.currentTestcases[filename]) {
      this.currentTestcases[filename] = {
        Ans: this.currentCode[filename] || "",
        structure: []
      };
    }

    const newTestcase = {
      ...testcase,
      _id: `${filename}_${Date.now()}`,
      _editable: true,
      _original: { ...testcase },
      _modified: true
    };

    this.currentTestcases[filename].structure.push(newTestcase);
    this.notifyListeners('testcaseAdded', { filename, testcase: newTestcase });
    
    return newTestcase._id;
  }

  updateTestcase(testcaseId, updates) {
    const [filename, index] = this.findTestcaseById(testcaseId);
    if (!filename || index === -1) return false;

    const testcase = this.currentTestcases[filename].structure[index];
    const updatedTestcase = {
      ...testcase,
      ...updates,
      _modified: true
    };

    this.currentTestcases[filename].structure[index] = updatedTestcase;
    this.notifyListeners('testcaseUpdated', { filename, index, testcase: updatedTestcase });
    
    return true;
  }

  deleteTestcase(testcaseId) {
    const [filename, index] = this.findTestcaseById(testcaseId);
    if (!filename || index === -1) return false;

    const deletedTestcase = this.currentTestcases[filename].structure.splice(index, 1)[0];
    this.notifyListeners('testcaseDeleted', { filename, index, testcase: deletedTestcase });
    
    return true;
  }

  duplicateTestcase(testcaseId) {
    const [filename, index] = this.findTestcaseById(testcaseId);
    if (!filename || index === -1) return null;

    const originalTestcase = this.currentTestcases[filename].structure[index];
    const duplicatedTestcase = {
      ...originalTestcase,
      _id: `${filename}_${Date.now()}`,
      _modified: true,
      description: `${originalTestcase.description} (Copy)`
    };

    this.currentTestcases[filename].structure.push(duplicatedTestcase);
    this.notifyListeners('testcaseDuplicated', { filename, testcase: duplicatedTestcase });
    
    return duplicatedTestcase._id;
  }

  reorderTestcases(filename, fromIndex, toIndex) {
    if (!this.currentTestcases[filename]) return false;

    const testcases = this.currentTestcases[filename].structure;
    if (fromIndex < 0 || fromIndex >= testcases.length || toIndex < 0 || toIndex >= testcases.length) {
      return false;
    }

    const [movedTestcase] = testcases.splice(fromIndex, 1);
    testcases.splice(toIndex, 0, movedTestcase);
    
    this.notifyListeners('testcasesReordered', { filename, fromIndex, toIndex });
    return true;
  }

  async generateNewTestcases(filename, options = {}) {
    if (!this.currentCode[filename]) return [];

    const fileData = { [filename]: this.currentCode[filename] };
    const result = await this.generator.generateFromFiles(fileData, options);
    const newTestcases = result.Code_Validation[filename]?.structure || [];

    // Add editing capabilities
    return newTestcases.map((test, index) => ({
      ...test,
      _id: `${filename}_new_${Date.now()}_${index}`,
      _editable: true,
      _original: { ...test },
      _modified: false
    }));
  }

  async suggestTestcases(filename) {
    if (!this.currentCode[filename]) return [];

    const suggestions = [];
    const code = this.currentCode[filename];
    const ext = filename.split('.').pop().toLowerCase();

    if (ext === 'html') {
      suggestions.push(...this.suggestHTMLTestcases(code));
    } else if (ext === 'css') {
      suggestions.push(...this.suggestCSSTestcases(code));
    } else if (ext === 'js') {
      suggestions.push(...this.suggestJSTestcases(code));
    }

    return suggestions;
  }

  suggestHTMLTestcases(html) {
    const suggestions = [];
    const parser = this.generator.htmlParser;
    const result = parser.parse(html);

    // Suggest tests for interactive elements
    const interactiveElements = result.interactiveElements || [];
    for (const element of interactiveElements) {
      if (element.tag === 'button') {
        suggestions.push({
          type: 'event',
          description: `Button "${element.id || element.classes[0] || element.tag}" should be clickable`,
          selector: parser.getElementSelector(element),
          event: 'click',
          expected: { triggered: true }
        });
      } else if (element.tag === 'form') {
        suggestions.push({
          type: 'event',
          description: `Form "${element.id || element.classes[0] || element.tag}" should handle submit`,
          selector: parser.getElementSelector(element),
          event: 'submit',
          expected: { triggered: true }
        });
      }
    }

    return suggestions;
  }

  async suggestCSSTestcases(css) {
    const suggestions = [];
    const parser = this.generator.cssParser;
    const result = await parser.parse(css);

    // Suggest tests for important selectors
    for (const rule of result.rules) {
      if (rule.selector.includes('button') || rule.selector.includes('btn')) {
        suggestions.push({
          type: 'style',
          description: `Button styles should be applied correctly`,
          selector: rule.selector,
          expected: rule.properties
        });
      }
    }

    return suggestions;
  }

  suggestJSTestcases(js) {
    const suggestions = [];
    const parser = this.generator.jsParser;
    const result = parser.parse(js);

    // Suggest tests for functions
    for (const func of result.functions) {
      if (func.name && !func.name.includes('anonymous')) {
        suggestions.push({
          type: 'function',
          description: `Function "${func.name}" should be defined and callable`,
          functionName: func.name,
          testCases: [
            {
              description: `Function "${func.name}" should execute without errors`,
              input: 'test',
              expected: 'test'
            }
          ]
        });
      }
    }

    // Suggest tests for events
    for (const event of result.events) {
      suggestions.push({
        type: 'event',
        description: `Element should handle ${event.event} event`,
        selector: `#${event.element}`,
        event: event.event,
        expected: { triggered: true }
      });
    }

    return suggestions;
  }

  validateTestcase(testcase) {
    const errors = [];
    const warnings = [];

    // Required fields validation
    if (!testcase.type) {
      errors.push('Test case type is required');
    }
    if (!testcase.description) {
      errors.push('Description is required');
    }

    // Type-specific validation
    if (testcase.type === 'event') {
      if (!testcase.selector) {
        errors.push('Selector is required for event tests');
      }
      if (!testcase.event) {
        errors.push('Event type is required for event tests');
      }
      if (!testcase.expected) {
        warnings.push('Expected result is recommended for event tests');
      }
    } else if (testcase.type === 'function') {
      if (!testcase.functionName) {
        errors.push('Function name is required for function tests');
      }
      if (!testcase.testCases || testcase.testCases.length === 0) {
        warnings.push('Test cases are recommended for function tests');
      }
    } else if (testcase.type === 'style') {
      if (!testcase.selector) {
        errors.push('Selector is required for style tests');
      }
      if (!testcase.expected) {
        errors.push('Expected styles are required for style tests');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  exportTestcases(options = {}) {
    const { includeMetadata = false } = options;
    
    const exported = {
      Code_Validation: {}
    };

    for (const [filename, fileData] of Object.entries(this.currentTestcases)) {
      const structure = fileData.structure.map(test => {
        const exportedTest = { ...test };
        
        if (!includeMetadata) {
          // Remove editing metadata
          delete exportedTest._id;
          delete exportedTest._editable;
          delete exportedTest._original;
          delete exportedTest._modified;
        }
        
        return exportedTest;
      });

      exported.Code_Validation[filename] = {
        Ans: fileData.Ans,
        structure
      };
    }

    return exported;
  }

  findTestcaseById(testcaseId) {
    for (const [filename, fileData] of Object.entries(this.currentTestcases)) {
      const index = fileData.structure.findIndex(test => test._id === testcaseId);
      if (index !== -1) {
        return [filename, index];
      }
    }
    return [null, -1];
  }

  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  removeEventListener(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  notifyListeners(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  getStatistics() {
    const stats = {
      totalFiles: Object.keys(this.currentTestcases).length,
      totalTests: 0,
      modifiedTests: 0,
      testTypes: {},
      files: {}
    };

    for (const [filename, fileData] of Object.entries(this.currentTestcases)) {
      const fileStats = {
        totalTests: fileData.structure.length,
        modifiedTests: fileData.structure.filter(test => test._modified).length,
        testTypes: {}
      };

      for (const test of fileData.structure) {
        fileStats.testTypes[test.type] = (fileStats.testTypes[test.type] || 0) + 1;
        stats.testTypes[test.type] = (stats.testTypes[test.type] || 0) + 1;
        
        if (test._modified) {
          stats.modifiedTests++;
        }
      }

      stats.totalTests += fileStats.totalTests;
      stats.files[filename] = fileStats;
    }

    return stats;
  }
}
