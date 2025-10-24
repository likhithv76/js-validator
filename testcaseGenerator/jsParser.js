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
  }

  parse(code) {
    // Parse comments first to detect commented-out code
    this.parseComments(code);
    
    const ast = parser.parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });

    traverse.default(ast, {
      VariableDeclarator: (path) => {
        const name = path.node.id.name;
        const valueNode = path.node.init;
        if (!valueNode) return;
        if (valueNode.type === "NumericLiteral" || valueNode.type === "StringLiteral") {
          this.variables.push({ name, value: valueNode.value });
          this.variableValues.set(name, valueNode.value); // Store for later resolution
        }
        if (valueNode.type === "ObjectExpression") {
          const props = valueNode.properties.map((p) => p.key.name);
          this.objects.push({ name, props });
          this.variableValues.set(name, `{${props.join(", ")}}`); // Store object reference
        }
      },

      ConditionalExpression: (path) => {
        const { left, operator, right } = path.node.test;
        if (left && right) {
          this.conditions.push({
            variable: this.resolveExpression(left),
            operator,
            value: this.resolveExpression(right)
          });
        }
      },

      IfStatement: (path) => {
        const test = path.node.test;
        if (test.left && test.right) {
          this.conditions.push({
            variable: this.resolveExpression(test.left),
            operator: test.operator || this.extractOperator(test),
            value: this.resolveExpression(test.right)
          });
        }
      },

      CallExpression: (path) => {
        const callee = path.node.callee;
        if (callee.object?.name === "console" && callee.property?.name === "log") {
          // Handle console.log with multiple arguments
          const args = path.node.arguments.map(arg => this.resolveExpression(arg));
          // Join arguments with spaces to simulate actual console output
          const output = args.filter(arg => arg !== null).join(" ");
          this.outputs.push(output);
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

  resolveExpression(expr) {
    if (!expr) return null;
    if (expr.type === "Identifier") {
      // Try to resolve variable value, fallback to variable name
      return this.variableValues.get(expr.name) || expr.name;
    }
    if (expr.type === "NumericLiteral") return expr.value;
    if (expr.type === "StringLiteral") return expr.value;
    if (expr.type === "MemberExpression")
      return `${this.resolveExpression(expr.object)}.${this.resolveExpression(expr.property)}`;
    return null;
  }

  extractOperator(test) {
    return test.operator || (test.type === "BinaryExpression" ? test.operator : null);
  }

  generateTests(code) {
    const tests = [];

    this.variables.forEach(v => {
      tests.push({
        type: "variable",
        description: `Variable '${v.name}' should be declared with value ${v.value}`,
        variable: v.name,
        expectedValue: v.value
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
