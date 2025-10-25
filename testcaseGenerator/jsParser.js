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
    this.functions = [];
    this.domManipulations = [];
    this.loops = [];
    this.variableValues = new Map();
    this.variableAssignments = [];
    this.declaredVariables = new Set(); 
  }

  parse(code) {
    this.parseComments(code);
    
    const ast = parser.parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });

    traverse.default(ast, {
      VariableDeclarator: (path) => {
        const name = path.node.id.name;
        const valueNode = path.node.init;
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
            
            const assignment = {
              type: 'compound_assignment',
              name: name,
              value: newValue,
              operator: operator,
              line: currentLine
            };
            this.variableAssignments.push(assignment);
            
            this.variableValues.set(name, newValue);
          } else {
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
          const objectName = path.node.left.object.name;
          const propertyName = path.node.left.property.name;
          const newValue = this.resolveExpression(path.node.right, currentLine, code);
          
          const currentObject = this.variableValues.get(objectName);
          if (currentObject && typeof currentObject === 'object') {
            const updatedObject = { ...currentObject, [propertyName]: newValue };
            this.variableValues.set(objectName, updatedObject);
            
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
        const test = path.node.test;
        const currentLine = path.node.loc?.start.line || 0;
        if (test.left && test.right) {
          // Store original variable names instead of resolved values
          const leftVar = test.left.type === "Identifier" ? test.left.name : this.resolveExpression(test.left, currentLine, code);
          const rightVar = test.right.type === "Identifier" ? test.right.name : this.resolveExpression(test.right, currentLine, code);
          
          this.conditions.push({
            variable: leftVar,
            operator: test.operator || this.extractOperator(test),
            value: rightVar
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
          const args = path.node.arguments.map(arg => {
            const resolved = this.resolveExpression(arg, currentLine, code);
            if (Array.isArray(resolved)) {
              return resolved.join(",");
            }
            if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
              return '[object Object]';
            }
            if (resolved === null) {
              return "";
            }
            if (resolved === undefined) {
              return "";
            }
            return resolved;
          });
          const output = args.join(" ");
          this.outputs.push(output);
        }

        if (callee.type === "MemberExpression" && callee.object?.type === "Identifier") {
          const arrayName = callee.object.name;
          const methodName = callee.property?.name;
          const currentArray = this.variableValues.get(arrayName);
          
          if (Array.isArray(currentArray) && methodName === "push") {
            const newElements = path.node.arguments.map(arg => this.resolveExpression(arg, currentLine, code));
            const updatedArray = [...currentArray, ...newElements];
            this.variableValues.set(arrayName, updatedArray);
            
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

        // DOM Manipulation
        if (callee.property?.name === "getElementById" || callee.property?.name === "querySelector") {
          const selector = path.node.arguments[0]?.value;
          this.domManipulations.push({
            type: 'element_selection',
            method: callee.property.name,
            selector: selector,
            line: currentLine
          });
        }

        if (callee.property?.name === "innerHTML" && callee.object?.type === "MemberExpression") {
          const element = callee.object.object?.name || "element";
          this.domManipulations.push({
            type: 'innerHTML_access',
            element: element,
            line: currentLine
          });
        }

        // Object methods (Object.keys, Object.values, etc.)
        if (callee.object?.name === "Object" && callee.property?.name) {
          this.objects.push({
            name: 'Object',
            method: callee.property.name,
            line: currentLine,
            type: 'object_method'
          });
          
          if (path.node.arguments.length > 0) {
            const arg = path.node.arguments[0];
            const resolvedArg = this.resolveExpression(arg, currentLine, code);
            
            if (resolvedArg && typeof resolvedArg === 'object' && !Array.isArray(resolvedArg)) {
              let result;
              if (callee.property.name === 'keys') {
                result = Object.keys(resolvedArg);
              } else if (callee.property.name === 'values') {
                result = Object.values(resolvedArg);
              }
              
              if (result !== undefined) {
                // Store the result in variableValues for later resolution
                const resultVarName = `Object.${callee.property.name}(${arg.name || 'obj'})`;
                this.variableValues.set(resultVarName, result);
              }
            }
          }
        }
      },

      // Function Declaration
      FunctionDeclaration: (path) => {
        const name = path.node.id?.name;
        const params = path.node.params.map(param => param.name);
        const currentLine = path.node.loc?.start.line || 0;
        
        this.functions.push({
          name: name,
          type: 'function_declaration',
          parameters: params,
          line: currentLine,
          hasReturn: this.hasReturnStatement(path.node.body)
        });
      },

      // Arrow Function Expression
      ArrowFunctionExpression: (path) => {
        const currentLine = path.node.loc?.start.line || 0;
        const params = path.node.params.map(param => param.name);
        
        // Try to get the variable name if this arrow function is assigned to a variable
        let functionName = 'arrow_function';
        if (path.parent && path.parent.type === 'VariableDeclarator') {
          functionName = path.parent.id.name;
        }
        
        this.functions.push({
          name: functionName,
          type: 'arrow_function',
          parameters: params,
          line: currentLine,
          hasReturn: this.hasReturnStatement(path.node.body)
        });
      },

      // For Loop
      ForStatement: (path) => {
        const currentLine = path.node.loc?.start.line || 0;
        this.loops.push({
          type: 'for_loop',
          line: currentLine,
          hasBreak: this.hasBreakStatement(path.node.body),
          hasContinue: this.hasContinueStatement(path.node.body)
        });
      },

      // While Loop
      WhileStatement: (path) => {
        const currentLine = path.node.loc?.start.line || 0;
        this.loops.push({
          type: 'while_loop',
          line: currentLine,
          hasBreak: this.hasBreakStatement(path.node.body),
          hasContinue: this.hasContinueStatement(path.node.body)
        });
      },

      // For...of Loop
      ForOfStatement: (path) => {
        const currentLine = path.node.loc?.start.line || 0;
        this.loops.push({
          type: 'for_of_loop',
          line: currentLine,
          hasBreak: this.hasBreakStatement(path.node.body),
          hasContinue: this.hasContinueStatement(path.node.body)
        });
      },

      // For...in Loop
      ForInStatement: (path) => {
        const currentLine = path.node.loc?.start.line || 0;
        this.loops.push({
          type: 'for_in_loop',
          line: currentLine,
          hasBreak: this.hasBreakStatement(path.node.body),
          hasContinue: this.hasContinueStatement(path.node.body)
        });
      },

      // Do...While Loop
      DoWhileStatement: (path) => {
        const currentLine = path.node.loc?.start.line || 0;
        this.loops.push({
          type: 'do_while_loop',
          line: currentLine,
          hasBreak: this.hasBreakStatement(path.node.body),
          hasContinue: this.hasContinueStatement(path.node.body)
        });
      }
    });

    return {
      variables: this.variables,
      conditions: this.conditions,
      objects: this.objects,
      events: this.events,
      outputs: this.outputs,
      commentedCode: this.commentedCode,
      functions: this.functions,
      domManipulations: this.domManipulations,
      loops: this.loops,
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
    if (expr.type === "UnaryExpression") {
      const argument = this.resolveExpression(expr.argument, currentLine, code);
      
      if (expr.operator === "typeof") {
        // Handle typeof expressions
        if (typeof argument === "number") return "number";
        if (typeof argument === "string") return "string";
        if (typeof argument === "boolean") return "boolean";
        if (argument === null) return "object";
        if (argument === undefined) return "undefined";
        return "object"; // default for objects, functions, etc.
      } else if (expr.operator === "!") {
        return !argument;
      } else if (expr.operator === "-") {
        return -argument;
      } else if (expr.operator === "+") {
        return +argument;
      }
    }
    if (expr.type === "LogicalExpression") {
      // Handle logical expressions (&&, ||)
      const left = this.resolveExpression(expr.left, currentLine, code);
      const right = this.resolveExpression(expr.right, currentLine, code);
      
      if (expr.operator === "&&") {
        return left && right;
      } else if (expr.operator === "||") {
        return left || right;
      }
    }
    if (expr.type === "ParenthesizedExpression") {
      // Handle expressions in parentheses
      return this.resolveExpression(expr.expression, currentLine, code);
    }
    if (expr.type === "ConditionalExpression") {
      // Handle ternary operator (condition ? trueValue : falseValue)
      const test = this.resolveExpression(expr.test, currentLine, code);
      const consequent = this.resolveExpression(expr.consequent, currentLine, code);
      const alternate = this.resolveExpression(expr.alternate, currentLine, code);
      
      return test ? consequent : alternate;
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
        case "&&":
          return left && right;
        case "||":
          return left || right;
        case "!":
          return !right;
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
    if (expr.type === "CallExpression") {
      // Handle function calls
      const callee = expr.callee;
      const args = expr.arguments.map(arg => this.resolveExpression(arg, currentLine, code));
      
      // Handle Object method calls
      if (callee.object?.name === "Object" && callee.property?.name) {
        const obj = args[0];
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          if (callee.property.name === 'keys') {
            return Object.keys(obj);
          } else if (callee.property.name === 'values') {
            return Object.values(obj);
          }
        }
      }
      
      // Handle regular function calls
      if (callee.type === "Identifier") {
        const funcName = callee.name;
        
        // For simple arithmetic functions, try to calculate the result
        if (funcName === "add" && args.length === 2) {
          const [a, b] = args;
          if (typeof a === "number" && typeof b === "number") {
            return a + b;
          }
        } else if (funcName === "multiply" && args.length === 2) {
          const [a, b] = args;
          if (typeof a === "number" && typeof b === "number") {
            return a * b;
          }
        }
        
        // For other functions, return the function name for now
        return funcName;
      }
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

  // Helper method to check if a function body has a return statement
  hasReturnStatement(body) {
    if (!body) return false;
    
    if (body.type === "BlockStatement") {
      return body.body.some(stmt => stmt.type === "ReturnStatement");
    } else if (body.type === "ReturnStatement") {
      return true;
    }
    
    return false;
  }

  // Helper method to check if a loop body has a break statement
  hasBreakStatement(body) {
    if (!body) return false;
    
    if (body.type === "BlockStatement") {
      return body.body.some(stmt => stmt.type === "BreakStatement");
    } else if (body.type === "BreakStatement") {
      return true;
    }
    
    return false;
  }

  // Helper method to check if a loop body has a continue statement
  hasContinueStatement(body) {
    if (!body) return false;
    
    if (body.type === "BlockStatement") {
      return body.body.some(stmt => stmt.type === "ContinueStatement");
    } else if (body.type === "ContinueStatement") {
      return true;
    }
    
    return false;
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
      if (o.type === 'object_method') {
        tests.push({
          type: "object",
          description: `Should use Object.${o.method}() method`,
          objectName: o.name,
          method: o.method,
          expectedMethod: o.method
        });
      } else {
        tests.push({
          type: "object",
          description: `Check if '${o.name}' object contains ${o.props.join(", ")} properties`,
          objectName: o.name,
          expectedProperties: o.props
        });
      }
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

    // Generate function tests
    this.functions.forEach(f => {
      tests.push({
        type: "function",
        description: `Function '${f.name}' should be declared with ${f.parameters.length} parameter(s)`,
        functionName: f.name,
        expectedParameters: f.parameters,
        hasReturn: f.hasReturn,
        functionType: f.type
      });
    });

    // Generate DOM manipulation tests
    this.domManipulations.forEach(d => {
      if (d.type === 'element_selection') {
        tests.push({
          type: "dom_structure",
          description: `Should use ${d.method} to select element`,
          method: d.method,
          selector: d.selector,
          expected: { method: d.method, selector: d.selector }
        });
      } else if (d.type === 'innerHTML_access') {
        tests.push({
          type: "dom_structure",
          description: `Should access innerHTML property of ${d.element}`,
          element: d.element,
          property: 'innerHTML',
          expected: { element: d.element, property: 'innerHTML' }
        });
      }
    });

    // Generate loop tests
    this.loops.forEach(l => {
      tests.push({
        type: "loop",
        description: `Should use ${l.type.replace('_', ' ')} loop`,
        loopType: l.type,
        hasBreak: l.hasBreak,
        hasContinue: l.hasContinue,
        expectedLoops: 1
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
