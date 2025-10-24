import * as parser from "@babel/parser";
import traverse from "@babel/traverse";

export class JSParser {
  constructor() {
    this.variables = [];
    this.conditions = [];
    this.objects = [];
    this.events = [];
    this.outputs = [];
    this.commentedCode = [];
    this.variableValues = new Map(); // Store variable values for resolution
    this.variableAssignments = []; // Track all variable assignments in order
    this.declaredVariables = new Set(); // Track declared variables for hoisting
  }

  parse(code) {
    // Parse comments first to detect commented-out code
    this.parseComments(code);
    
    const ast = parser.parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });

    // Process the AST with code context for hoisting detection
    traverse.default(ast, {
      VariableDeclarator: (path) => {
        const name = path.node.id.name;
        const valueNode = path.node.init;
        // Track all variable assignments in order
        const currentLine = path.node.loc?.start.line || 0;
        const assignment = {
          type: 'declaration',
          name: name,
          value: valueNode ? this.resolveExpression(valueNode, currentLine, code) : undefined,
          line: currentLine
        };
        this.variableAssignments.push(assignment);
        
        if (!valueNode) {
          // Variable without initialization (undefined)
          this.variables.push({ name, value: undefined });
          this.variableValues.set(name, undefined); // Store undefined value
          return;
        }
        
        if (valueNode.type === "NumericLiteral" || valueNode.type === "StringLiteral" || valueNode.type === "BooleanLiteral") {
          this.variables.push({ name, value: valueNode.value });
          this.variableValues.set(name, valueNode.value); // Store for later resolution
        }
        if (valueNode.type === "NullLiteral") {
          this.variables.push({ name, value: null });
          this.variableValues.set(name, null); // Store null value
        }
        if (valueNode.type === "ArrayExpression") {
          // Handle array literals
          const elements = valueNode.elements.map(el => {
            if (el.type === "StringLiteral") return el.value;
            if (el.type === "NumericLiteral") return el.value;
            return el; // For complex elements, keep the AST node
          });
          this.variableValues.set(name, elements); // Store array for later resolution
        }
        if (valueNode.type === "ObjectExpression") {
          // Handle object literals with actual values
          const obj = {};
          valueNode.properties.forEach(prop => {
            const key = prop.key.name;
            const value = this.resolveExpression(prop.value, currentLine, code);
            obj[key] = value;
          });
          this.objects.push({ name, props: Object.keys(obj) });
          this.variableValues.set(name, obj); // Store actual object with values
        }
        
        // Handle complex expressions (like string concatenation, binary expressions, etc.)
        if (!["NumericLiteral", "StringLiteral", "ArrayExpression", "ObjectExpression"].includes(valueNode.type)) {
          const resolvedValue = this.resolveExpression(valueNode, currentLine, code);
          if (resolvedValue !== null) {
            this.variableValues.set(name, resolvedValue); // Store resolved value
          }
        }
      },

      AssignmentExpression: (path) => {
        const currentLine = path.node.loc?.start.line || 0;
        
        if (path.node.left.type === "Identifier") {
          const name = path.node.left.name;
          
          // Handle compound assignment operators (+=, -=, *=, etc.)
          if (path.node.operator !== "=") {
            const currentValue = this.variableValues.get(name) || 0;
            const rightValue = this.resolveExpression(path.node.right, currentLine, code);
            const operator = path.node.operator;
            
            let newValue;
            switch (operator) {
              case "+=":
                newValue = currentValue + rightValue;
                break;
              case "-=":
                newValue = currentValue - rightValue;
                break;
              case "*=":
                newValue = currentValue * rightValue;
                break;
              case "/=":
                newValue = currentValue / rightValue;
                break;
              default:
                newValue = rightValue;
            }
            
            // Track compound assignments
            const assignment = {
              type: 'compound_assignment',
              name: name,
              value: newValue,
              operator: operator,
              line: currentLine
            };
            this.variableAssignments.push(assignment);
            
            // Update the variable value
            this.variableValues.set(name, newValue);
          } else {
            // Regular assignment
            const value = this.resolveExpression(path.node.right, currentLine, code);
            
            const assignment = {
              type: 'reassignment',
              name: name,
              value: value,
              line: currentLine
            };
            this.variableAssignments.push(assignment);
            
            this.variableValues.set(name, value);
          }
        } else if (path.node.left.type === "MemberExpression") {
          // Handle object property assignments (e.g., config.theme = "light")
          const objectName = path.node.left.object.name;
          const propertyName = path.node.left.property.name;
          const newValue = this.resolveExpression(path.node.right, currentLine, code);
          
          // Get the current object and update the property
          const currentObject = this.variableValues.get(objectName);
          if (currentObject && typeof currentObject === 'object') {
            const updatedObject = { ...currentObject, [propertyName]: newValue };
            this.variableValues.set(objectName, updatedObject);
            
            // Track this as a property assignment
            const assignment = {
              type: 'property_assignment',
              name: objectName,
              property: propertyName,
              value: newValue,
              line: currentLine
            };
            this.variableAssignments.push(assignment);
          }
        }
      },

      ConditionalExpression: (path) => {
        const { left, operator, right } = path.node.test;
        const currentLine = path.node.loc?.start.line || 0;
        if (left && right) {
          this.conditions.push({
            variable: this.resolveExpression(left, currentLine, code),
            operator,
            value: this.resolveExpression(right, currentLine, code)
          });
        }
      },

      IfStatement: (path) => {
        const test = path.node.test;
        const currentLine = path.node.loc?.start.line || 0;
        if (test.left && test.right) {
          this.conditions.push({
            variable: this.resolveExpression(test.left, currentLine, code),
            operator: test.operator || this.extractOperator(test),
            value: this.resolveExpression(test.right, currentLine, code)
          });
        }
      },

      CallExpression: (path) => {
        const callee = path.node.callee;
        const currentLine = path.node.loc?.start.line || 0;
        
        if (callee.object?.name === "console" && callee.property?.name === "log") {
          // Handle console.log with multiple arguments
          const args = path.node.arguments.map(arg => {
            const resolved = this.resolveExpression(arg, currentLine, code);
            // Format arrays and objects properly for console output
            if (Array.isArray(resolved)) {
              return resolved.join(",");
            }
            if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
              // JavaScript console.log converts objects to [object Object] by default
              return '[object Object]';
            }
            if (resolved === null) {
              // In JSDOM environment, null is converted to empty string in console output
              return "";
            }
            if (resolved === undefined) {
              // In JSDOM environment, undefined is converted to empty string in console output
              return "";
            }
            return resolved;
          });
          // Join arguments with spaces to simulate actual console output
          const output = args.join(" ");
          this.outputs.push(output);
        }

        // Handle array method calls (like push, pop, etc.)
        if (callee.type === "MemberExpression" && callee.object?.type === "Identifier") {
          const arrayName = callee.object.name;
          const methodName = callee.property?.name;
          const currentArray = this.variableValues.get(arrayName);
          
          if (Array.isArray(currentArray) && methodName === "push") {
            // Handle array.push() calls
            const newElements = path.node.arguments.map(arg => this.resolveExpression(arg, currentLine, code));
            const updatedArray = [...currentArray, ...newElements];
            this.variableValues.set(arrayName, updatedArray);
            
            // Track this as an assignment
            const assignment = {
              type: 'array_method',
              name: arrayName,
              value: updatedArray,
              method: methodName,
              line: currentLine
            };
            this.variableAssignments.push(assignment);
          }
        }

        // DOM Event
        if (callee.property?.name === "addEventListener") {
          const element = callee.object?.name || "element";
          const eventName = path.node.arguments[0]?.value;
          this.events.push({ element, event: eventName });
        }
      }
    });

    return {
      variables: this.variables,
      conditions: this.conditions,
      objects: this.objects,
      events: this.events,
      outputs: this.outputs,
      commentedCode: this.commentedCode,
      variableAssignments: this.variableAssignments,
      structure: this.generateTests(code)
    };
  }

  parseComments(code) {
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check for single-line comments that contain code
      if (line.startsWith('//')) {
        const commentContent = line.substring(2).trim();
        
        // Check if comment contains variable declarations
        if (commentContent.includes('const ') || commentContent.includes('let ') || commentContent.includes('var ')) {
          this.commentedCode.push({
            type: 'variable',
            line: i + 1,
            content: commentContent,
            description: `Commented variable declaration: ${commentContent}`
          });
        }
        
        // Check if comment contains console.log statements
        if (commentContent.includes('console.log')) {
          this.commentedCode.push({
            type: 'output',
            line: i + 1,
            content: commentContent,
            description: `Commented console output: ${commentContent}`
          });
        }
        
        // Check if comment contains explanatory text about expected output
        if (commentContent.includes('Final Bill') || commentContent.includes('discount')) {
          this.commentedCode.push({
            type: 'explanation',
            line: i + 1,
            content: commentContent,
            description: `Explanatory comment: ${commentContent}`
          });
        }
      }
    }
  }

  resolveExpression(expr, currentLine = 0, code = "") {
    if (!expr) return null;
    if (expr.type === "Identifier") {
      const varName = expr.name;
      
      // Check if this variable is declared with var (hoisted) using code analysis
      const isHoisted = this.isVariableHoistedInCode(varName, currentLine, code);
      
      if (isHoisted) {
        // For hoisted variables used before assignment, return empty string
        // because console.log("text:", undefined) outputs "text: " (no "undefined")
        return "";
      }
      
      // Try to resolve variable value, fallback to variable name
      const value = this.variableValues.get(varName);
      if (value !== undefined) {
        return value; // Return the actual value, even if it's null
      }
      return varName; // Fallback to variable name only if not found
    }
    if (expr.type === "NumericLiteral") return expr.value;
    if (expr.type === "StringLiteral") return expr.value;
    if (expr.type === "BooleanLiteral") return expr.value;
    if (expr.type === "NullLiteral") return null;
    if (expr.type === "ArrayExpression") {
      // Handle array literals
      const elements = expr.elements.map(el => {
        if (el.type === "StringLiteral") return el.value;
        if (el.type === "NumericLiteral") return el.value;
        return this.resolveExpression(el, currentLine, code); // Recursively resolve complex elements
      });
      return elements;
    }
    if (expr.type === "ObjectExpression") {
      // Handle object literals
      const obj = {};
      expr.properties.forEach(prop => {
        const key = prop.key.name;
        const value = this.resolveExpression(prop.value, currentLine, code);
        obj[key] = value;
      });
      return obj;
    }
    if (expr.type === "UnaryExpression" && expr.operator === "typeof") {
      // Handle typeof expressions
      const argument = this.resolveExpression(expr.argument, currentLine, code);
      if (typeof argument === "number") return "number";
      if (typeof argument === "string") return "string";
      if (typeof argument === "boolean") return "boolean";
      if (argument === null) return "object";
      if (argument === undefined) return "undefined";
      return "object"; // default for objects, functions, etc.
    }
    if (expr.type === "BinaryExpression") {
      // Handle binary expressions (like string concatenation)
      const left = this.resolveExpression(expr.left, currentLine, code);
      const right = this.resolveExpression(expr.right, currentLine, code);
      
      switch (expr.operator) {
        case "+":
          // String concatenation or addition
          if (typeof left === "string" || typeof right === "string") {
            return String(left) + String(right);
          }
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "%":
          return left % right;
        case ">=":
          return left >= right;
        case "<=":
          return left <= right;
        case ">":
          return left > right;
        case "<":
          return left < right;
        case "==":
          return left == right;
        case "!=":
          return left != right;
        case "===":
          return left === right;
        case "!==":
          return left !== right;
        default:
          return null;
      }
    }
    if (expr.type === "MemberExpression") {
      const object = this.resolveExpression(expr.object, currentLine, code);
      const property = this.resolveExpression(expr.property, currentLine, code);
      
      // Handle common property access patterns
      if (typeof object === "string" && property === "length") {
        return object.length;
      }
      if (Array.isArray(object) && property === "length") {
        return object.length;
      }
      if (object && typeof object === "object" && !Array.isArray(object)) {
        return object[property];
      }
      
      // Fallback to string representation
      return `${object}.${property}`;
    }
    return null;
  }

  isVariableHoisted(varName, currentLine) {
    // Check if variable is declared with var later in the code
    for (const assignment of this.variableAssignments) {
      if (assignment.name === varName && assignment.type === 'declaration' && assignment.line > currentLine) {
        return true; // Variable is declared later, so it's hoisted
      }
    }
    return false;
  }

  // Alternative method: check raw code for var declarations
  isVariableHoistedInCode(varName, currentLine, code) {
    const lines = code.split('\n');
    for (let i = currentLine; i < lines.length; i++) {
      const line = lines[i];
      // Look for var declarations
      const varMatch = line.match(new RegExp(`\\bvar\\s+${varName}\\b`));
      if (varMatch) {
        return true; // Variable is declared later in the code
      }
    }
    return false;
  }

  extractOperator(test) {
    return test.operator || (test.type === "BinaryExpression" ? test.operator : null);
  }

  generateTests(code) {
    const tests = [];

    // For variables with multiple assignments, only test the final value
    // Use variableValues which contains the actual final values (including objects)
    this.variableValues.forEach((value, name) => {
      tests.push({
        type: "variable",
        description: `Variable '${name}' should have final value ${JSON.stringify(value)}`,
        variable: name,
        expectedValue: value
      });
    });

    this.conditions.forEach(c => {
      tests.push({
        type: "condition",
        description: `Check if ${c.variable} ${c.operator} ${c.value} condition is used`,
        variable: c.variable,
        expectedOperator: c.operator,
        expectedValue: c.value
      });
    });

    this.objects.forEach(o => {
      tests.push({
        type: "object",
        description: `Check if '${o.name}' object contains ${o.props.join(", ")} properties`,
        objectName: o.name,
        expectedProperties: o.props
      });
    });

    this.outputs.forEach(o => {
      tests.push({
        type: "output",
        description: `Should print '${o}' using console.log`,
        expectedOutput: o
      });
    });

    this.events.forEach(e => {
      tests.push({
        type: "event",
        description: `Check ${e.element} handles '${e.event}' event`,
        selector: `#${e.element}`,
        event: e.event,
        expected: { consoleOutput: `${e.event} event triggered` }
      });
    });

    // Add tests for commented code
    this.commentedCode.forEach(comment => {
      if (comment.type === 'variable') {
        // Extract variable name and value from commented code
        const varMatch = comment.content.match(/(?:const|let|var)\s+(\w+)\s*=\s*([^;]+);?/);
        if (varMatch) {
          const varName = varMatch[1];
          const varValue = varMatch[2].trim();
          tests.push({
            type: "commented_variable",
            description: `Commented variable '${varName}' should be uncommented with value ${varValue}`,
            variable: varName,
            expectedValue: varValue,
            comment: comment.content
          });
        }
      } else if (comment.type === 'output') {
        // Extract expected output from commented console.log
        const outputMatch = comment.content.match(/console\.log\((.+)\);?/);
        if (outputMatch) {
          const expectedOutput = outputMatch[1].replace(/['"]/g, '').trim();
          tests.push({
            type: "commented_output",
            description: `Commented console output should be uncommented: ${expectedOutput}`,
            expectedOutput: expectedOutput,
            comment: comment.content
          });
        }
      } else if (comment.type === 'explanation') {
        // Add explanation test for educational purposes
        tests.push({
          type: "explanation",
          description: `Comment explains: ${comment.content}`,
          comment: comment.content
        });
      }
    });

    if (tests.length === 0) {
      tests.push({
        type: "generic",
        description: "No clear logic detected; manual validation needed."
      });
    }

    return tests;
  }
}
