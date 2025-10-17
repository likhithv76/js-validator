import * as parser from "@babel/parser";
import traverse from "@babel/traverse";

export class JSParser {
  constructor() {
    this.events = [];
    this.functions = [];
    this.variables = [];
    this.conditions = [];
    this.objects = [];
    this.domManipulations = [];
  }

  /**
   * @param {string} code
   * @returns {Object}
   */
  parse(code) {
    this.events = [];
    this.functions = [];
    this.variables = [];
    this.conditions = [];
    this.objects = [];
    this.domManipulations = [];

    try {
      const ast = parser.parse(code, {
        sourceType: "module",
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        plugins: ["jsx", "typescript", "decorators-legacy"]
      });

      traverse(ast, {
        CallExpression: this.handleCallExpression.bind(this),
        FunctionDeclaration: this.handleFunctionDeclaration.bind(this),
        FunctionExpression: this.handleFunctionExpression.bind(this),
        ArrowFunctionExpression: this.handleArrowFunctionExpression.bind(this),
        VariableDeclarator: this.handleVariableDeclarator.bind(this),
        IfStatement: this.handleIfStatement.bind(this),
        ConditionalExpression: this.handleConditionalExpression.bind(this),
        ObjectExpression: this.handleObjectExpression.bind(this),
        AssignmentExpression: this.handleAssignmentExpression.bind(this)
      });

      return {
        events: this.events,
        functions: this.functions,
        variables: this.variables,
        conditions: this.conditions,
        objects: this.objects,
        domManipulations: this.domManipulations,
        tests: this.generateTests()
      };
    } catch (error) {
      console.error("JavaScript parsing error:", error);
      return {
        events: [],
        functions: [],
        variables: [],
        conditions: [],
        objects: [],
        domManipulations: [],
        tests: [],
        error: error.message
      };
    }
  }

  /**
   * @param {Object} path
   */
  handleCallExpression(path) {
    const { node } = path;
    const callee = node.callee;

    // Event listeners
    if (callee.property && callee.property.name === "addEventListener") {
      this.handleEventListener(path);
    }
    // DOM manipulation methods
    else if (callee.property && this.isDOMMethod(callee.property.name)) {
      this.handleDOMManipulation(path);
    }
    // Function calls
    else if (callee.type === "Identifier") {
      this.handleFunctionCall(path);
    }
  }

  /**
   * @param {Object} path
   */
  handleEventListener(path) {
    const { node } = path;
    const element = node.callee.object;
    const eventType = node.arguments[0]?.value;
    const handler = node.arguments[1];

    if (eventType && handler) {
      const eventInfo = {
        element: this.getElementIdentifier(element),
        event: eventType,
        handler: this.extractHandlerInfo(handler),
        line: node.loc?.start.line
      };

      this.events.push(eventInfo);
    }
  }

  /**
   * @param {Object} path
   */
  handleDOMManipulation(path) {
    const { node } = path;
    const method = node.callee.property.name;
    const element = node.callee.object;

    const domInfo = {
      method: method,
      element: this.getElementIdentifier(element),
      arguments: node.arguments.map(arg => this.extractValue(arg)),
      line: node.loc?.start.line
    };

    this.domManipulations.push(domInfo);
  }

  /**
   * @param {Object} path
   */
  handleFunctionCall(path) {
    const { node } = path;
    const functionName = node.callee.name;

    // Skip built-in functions
    if (this.isBuiltInFunction(functionName)) {
      return;
    }

    const callInfo = {
      name: functionName,
      arguments: node.arguments.map(arg => this.extractValue(arg)),
      line: node.loc?.start.line
    };

    const existingFunction = this.functions.find(f => f.name === functionName);
    if (existingFunction) {
      existingFunction.calls = existingFunction.calls || [];
      existingFunction.calls.push(callInfo);
    }
  }

  /**
   * @param {Object} path
   */
  handleFunctionDeclaration(path) {
    const { node } = path;
    const functionInfo = {
      name: node.id?.name,
      type: "function",
      parameters: node.params.map(param => this.extractParameter(param)),
      body: this.extractFunctionBody(node.body),
      line: node.loc?.start.line
    };

    this.functions.push(functionInfo);
  }

  /**
   * @param {Object} path
   */
  handleFunctionExpression(path) {
    const { node } = path;
    const functionInfo = {
      name: path.parent.id?.name || "anonymous",
      type: "function",
      parameters: node.params.map(param => this.extractParameter(param)),
      body: this.extractFunctionBody(node.body),
      line: node.loc?.start.line
    };

    this.functions.push(functionInfo);
  }

  /**
   * @param {Object} path
   */
  handleArrowFunctionExpression(path) {
    const { node } = path;
    const functionInfo = {
      name: path.parent.id?.name || "arrow",
      type: "arrow",
      parameters: node.params.map(param => this.extractParameter(param)),
      body: this.extractFunctionBody(node.body),
      line: node.loc?.start.line
    };

    this.functions.push(functionInfo);
  }

  /**
   * @param {Object} path
   */
  handleVariableDeclarator(path) {
    const { node } = path;
    const variableInfo = {
      name: node.id?.name,
      type: this.getVariableType(node.init),
      value: this.extractValue(node.init),
      line: node.loc?.start.line
    };

    this.variables.push(variableInfo);
  }

  /**
   * Handle if statements
   * @param {Object} path - Babel traverse path
   */
  handleIfStatement(path) {
    const { node } = path;
    const conditionInfo = {
      type: "if",
      condition: this.extractCondition(node.test),
      line: node.loc?.start.line
    };

    this.conditions.push(conditionInfo);
  }

  /**
   * Handle conditional expressions (ternary)
   * @param {Object} path - Babel traverse path
   */
  handleConditionalExpression(path) {
    const { node } = path;
    const conditionInfo = {
      type: "ternary",
      condition: this.extractCondition(node.test),
      consequent: this.extractValue(node.consequent),
      alternate: this.extractValue(node.alternate),
      line: node.loc?.start.line
    };

    this.conditions.push(conditionInfo);
  }

  /**
   * Handle object expressions
   * @param {Object} path - Babel traverse path
   */
  handleObjectExpression(path) {
    const { node } = path;
    const objectInfo = {
      name: path.parent.id?.name || "anonymous",
      properties: node.properties.map(prop => ({
        key: prop.key?.name || prop.key?.value,
        value: this.extractValue(prop.value),
        type: this.getVariableType(prop.value)
      })),
      line: node.loc?.start.line
    };

    this.objects.push(objectInfo);
  }

  /**
   * Handle assignment expressions
   * @param {Object} path - Babel traverse path
   */
  handleAssignmentExpression(path) {
    const { node } = path;
    const assignmentInfo = {
      left: this.extractValue(node.left),
      right: this.extractValue(node.right),
      operator: node.operator,
      line: node.loc?.start.line
    };

    // Check if this is a DOM property assignment
    if (this.isDOMPropertyAssignment(node.left)) {
      this.domManipulations.push({
        type: "property_assignment",
        element: this.getElementIdentifier(node.left.object),
        property: node.left.property?.name,
        value: this.extractValue(node.right),
        line: node.loc?.start.line
      });
    }
  }

  /**
   * Generate test cases from parsed information
   * @returns {Array} Array of test cases
   */
  generateTests() {
    const tests = [];

    // Event tests
    for (const event of this.events) {
      tests.push({
        type: "event",
        description: `Element should handle ${event.event} event`,
        selector: this.getSelectorFromElement(event.element),
        event: event.event,
        expected: this.generateEventExpectation(event)
      });
    }

    // Function tests
    for (const func of this.functions) {
      if (func.name && func.name !== "anonymous" && func.name !== "arrow") {
        tests.push({
          type: "function",
          description: `Function ${func.name} should be defined`,
          functionName: func.name,
          testCases: this.generateFunctionTestCases(func)
        });
      }
    }

    // Condition tests
    for (const condition of this.conditions) {
      tests.push({
        type: "condition",
        description: `Condition should use proper logic`,
        condition: condition.condition,
        line: condition.line
      });
    }

    // Object tests
    for (const obj of this.objects) {
      if (obj.name && obj.name !== "anonymous") {
        tests.push({
          type: "object",
          description: `Object ${obj.name} should have correct structure`,
          objectName: obj.name,
          properties: this.generateObjectProperties(obj)
        });
      }
    }

    return tests;
  }

  // Helper methods
  isDOMMethod(methodName) {
    const domMethods = [
      "createElement", "querySelector", "querySelectorAll", "getElementById",
      "getElementsByClassName", "getElementsByTagName", "appendChild",
      "removeChild", "insertBefore", "setAttribute", "getAttribute",
      "classList", "addEventListener", "removeEventListener"
    ];
    return domMethods.includes(methodName);
  }

  isBuiltInFunction(functionName) {
    const builtIns = ["console", "alert", "prompt", "confirm", "parseInt", "parseFloat"];
    return builtIns.includes(functionName);
  }

  isDOMPropertyAssignment(node) {
    return node.type === "MemberExpression" && 
           node.object && 
           (node.object.name === "document" || 
            node.object.type === "CallExpression" ||
            this.isElementVariable(node.object));
  }

  isElementVariable(node) {
    if (node.type === "Identifier") {
      const variable = this.variables.find(v => v.name === node.name);
      return variable && this.isDOMMethod(variable.value);
    }
    return false;
  }

  getElementIdentifier(element) {
    if (element.type === "Identifier") {
      return element.name;
    } else if (element.type === "CallExpression") {
      return this.extractValue(element);
    }
    return "unknown";
  }

  getSelectorFromElement(element) {
    // Try to find the element in variables
    const variable = this.variables.find(v => v.name === element);
    if (variable && variable.value) {
      // If it's a querySelector call, extract the selector
      if (typeof variable.value === "string" && variable.value.startsWith("document.querySelector")) {
        return variable.value.match(/querySelector\(['"`]([^'"`]+)['"`]\)/)?.[1] || element;
      }
    }
    return `#${element}`; // Default to ID selector
  }

  extractHandlerInfo(handler) {
    if (handler.type === "FunctionExpression" || handler.type === "ArrowFunctionExpression") {
      return {
        type: handler.type,
        parameters: handler.params.map(p => p.name),
        body: this.extractFunctionBody(handler.body)
      };
    }
    return { type: "reference", name: handler.name };
  }

  extractValue(node) {
    if (!node) return null;
    
    switch (node.type) {
      case "StringLiteral":
        return node.value;
      case "NumericLiteral":
        return node.value;
      case "BooleanLiteral":
        return node.value;
      case "Identifier":
        return node.name;
      case "CallExpression":
        return `${this.getElementIdentifier(node.callee)}.${node.callee.property?.name}(${node.arguments.map(arg => this.extractValue(arg)).join(", ")})`;
      case "MemberExpression":
        return `${this.getElementIdentifier(node.object)}.${node.property?.name}`;
      default:
        return node.type;
    }
  }

  extractCondition(node) {
    if (!node) return null;
    return this.extractValue(node);
  }

  extractParameter(param) {
    return param.name || param.type;
  }

  extractFunctionBody(body) {
    if (body.type === "BlockStatement") {
      return body.body.map(stmt => stmt.type);
    }
    return body.type;
  }

  getVariableType(node) {
    if (!node) return "undefined";
    
    switch (node.type) {
      case "StringLiteral":
        return "string";
      case "NumericLiteral":
        return "number";
      case "BooleanLiteral":
        return "boolean";
      case "ObjectExpression":
        return "object";
      case "ArrayExpression":
        return "array";
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return "function";
      default:
        return "unknown";
    }
  }

  generateEventExpectation(event) {
    if (event.handler && event.handler.body) {
      if (event.handler.body.includes("textContent")) {
        return { textContent: "Changed!" };
      }
      if (event.handler.body.includes("classList")) {
        return { className: "active" };
      }
    }
    return { triggered: true };
  }

  generateFunctionTestCases(func) {
    // Generate basic test cases for functions
    return [
      {
        description: `Function ${func.name} should be callable`,
        input: "test",
        expected: "test"
      }
    ];
  }

  generateObjectProperties(obj) {
    const properties = {};
    for (const prop of obj.properties) {
      properties[prop.key] = prop.type;
    }
    return properties;
  }
}
