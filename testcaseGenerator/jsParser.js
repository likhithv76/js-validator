import * as parser from "@babel/parser";
import traverse from "@babel/traverse";

export class JSParser {
  constructor() {
    this.variables = [];
    this.conditions = [];
    this.objects = [];
    this.events = [];
    this.outputs = [];
  }

  parse(code) {
    const ast = parser.parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });

    traverse.default(ast, {
      VariableDeclarator: (path) => {
        const name = path.node.id.name;
        const valueNode = path.node.init;
        if (!valueNode) return;
        if (valueNode.type === "NumericLiteral" || valueNode.type === "StringLiteral") {
          this.variables.push({ name, value: valueNode.value });
        }
        if (valueNode.type === "ObjectExpression") {
          const props = valueNode.properties.map((p) => p.key.name);
          this.objects.push({ name, props });
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
          const arg = path.node.arguments[0];
          this.outputs.push(this.resolveExpression(arg));
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
      structure: this.generateTests(code)
    };
  }

  resolveExpression(expr) {
    if (!expr) return null;
    if (expr.type === "Identifier") return expr.name;
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

    if (tests.length === 0) {
      tests.push({
        type: "generic",
        description: "No clear logic detected; manual validation needed."
      });
    }

    return tests;
  }
}
