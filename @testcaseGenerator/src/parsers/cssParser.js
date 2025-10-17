import * as css from "css";
import postcss from "postcss";
import postcssNested from "postcss-nested";

export class CSSParser {
  constructor() {
    this.rules = [];
    this.selectors = new Set();
    this.properties = new Map();
  }

  /**
   * Parse CSS string and extract style information
   * @param {string} cssContent - CSS content to parse
   * @returns {Object} Parsed CSS structure
   */
  async parse(cssContent) {
    this.rules = [];
    this.selectors = new Set();
    this.properties = new Map();

    try {
      // Parse with postcss for better handling of modern CSS
      const result = await postcss([postcssNested()]).process(cssContent, {
        from: undefined
      });

      // Parse with css library for AST
      const ast = css.parse(cssContent);

      this.extractRules(ast);
      this.generateStyleTests();

      return {
        rules: this.rules,
        selectors: Array.from(this.selectors),
        properties: Object.fromEntries(this.properties),
        styleTests: this.generateStyleTests(),
        ast: ast
      };
    } catch (error) {
      console.error("CSS parsing error:", error);
      return {
        rules: [],
        selectors: [],
        properties: {},
        styleTests: [],
        error: error.message
      };
    }
  }

  /**
   * Extract rules from CSS AST
   * @param {Object} ast - CSS AST
   */
  extractRules(ast) {
    if (ast.stylesheet && ast.stylesheet.rules) {
      for (const rule of ast.stylesheet.rules) {
        if (rule.type === 'rule') {
          this.processRule(rule);
        } else if (rule.type === 'media') {
          this.processMediaRule(rule);
        }
      }
    }
  }

  /**
   * Process a CSS rule
   * @param {Object} rule - CSS rule
   */
  processRule(rule) {
    const selectors = rule.selectors || [];
    const declarations = rule.declarations || [];

    for (const selector of selectors) {
      this.selectors.add(selector);
      
      const ruleInfo = {
        selector: selector,
        properties: {},
        declarations: declarations.map(decl => ({
          property: decl.property,
          value: decl.value,
          important: decl.important || false
        }))
      };

      // Group properties by selector
      for (const decl of declarations) {
        if (decl.type === 'declaration') {
          ruleInfo.properties[decl.property] = decl.value;
          
          // Track all properties
          if (!this.properties.has(decl.property)) {
            this.properties.set(decl.property, new Set());
          }
          this.properties.get(decl.property).add(decl.value);
        }
      }

      this.rules.push(ruleInfo);
    }
  }

  /**
   * Process media query rules
   * @param {Object} mediaRule - Media rule
   */
  processMediaRule(mediaRule) {
    if (mediaRule.rules) {
      for (const rule of mediaRule.rules) {
        if (rule.type === 'rule') {
          this.processRule(rule);
        }
      }
    }
  }

  /**
   * Generate style test cases
   * @returns {Array} Array of style test cases
   */
  generateStyleTests() {
    const tests = [];

    for (const rule of this.rules) {
      const test = {
        type: "style",
        description: `Element ${rule.selector} should have correct styles`,
        selector: rule.selector,
        expected: rule.properties
      };

      tests.push(test);
    }

    return tests;
  }

  /**
   * Get all unique selectors
   * @returns {Array} Array of unique selectors
   */
  getSelectors() {
    return Array.from(this.selectors);
  }

  /**
   * Get all unique properties
   * @returns {Array} Array of unique properties
   */
  getProperties() {
    return Array.from(this.properties.keys());
  }

  /**
   * Get properties for a specific selector
   * @param {string} selector - CSS selector
   * @returns {Object} Properties for the selector
   */
  getPropertiesForSelector(selector) {
    const rule = this.rules.find(r => r.selector === selector);
    return rule ? rule.properties : {};
  }

  /**
   * Find responsive breakpoints
   * @returns {Array} Array of media queries
   */
  getMediaQueries() {
    const mediaQueries = [];
    
    for (const rule of this.rules) {
      if (rule.media) {
        mediaQueries.push({
          media: rule.media,
          rules: rule.rules
        });
      }
    }

    return mediaQueries;
  }

  /**
   * Find color values in CSS
   * @returns {Array} Array of color values
   */
  getColors() {
    const colors = new Set();
    const colorProperties = ['color', 'background-color', 'border-color', 'outline-color'];

    for (const rule of this.rules) {
      for (const [property, value] of Object.entries(rule.properties)) {
        if (colorProperties.includes(property)) {
          colors.add(value);
        }
      }
    }

    return Array.from(colors);
  }

  /**
   * Find layout properties
   * @returns {Array} Array of layout properties
   */
  getLayoutProperties() {
    const layoutProps = new Set();
    const layoutProperties = [
      'display', 'position', 'float', 'clear', 'overflow',
      'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
      'margin', 'padding', 'border', 'top', 'right', 'bottom', 'left',
      'flex', 'grid', 'align-items', 'justify-content'
    ];

    for (const rule of this.rules) {
      for (const property of Object.keys(rule.properties)) {
        if (layoutProperties.includes(property)) {
          layoutProps.add(property);
        }
      }
    }

    return Array.from(layoutProps);
  }
}
