import { JSDOM } from "jsdom";
import * as htmlparser2 from "htmlparser2";

export class HTMLParser {
  constructor() {
    this.elements = [];
    this.selectors = new Set();
  }

  /**
   * Parse HTML string and extract structural information
   * @param {string} html - HTML content to parse
   * @returns {Object} Parsed HTML structure
   */
  parse(html) {
    this.elements = [];
    this.selectors = new Set();

    // Use jsdom for better DOM simulation
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    const document = dom.window.document;

    // Extract all elements
    const allElements = document.querySelectorAll("*");
    
    for (const element of allElements) {
      const elementInfo = this.extractElementInfo(element);
      this.elements.push(elementInfo);
      
      // Generate selectors
      this.generateSelectors(element);
    }

    return {
      elements: this.elements,
      selectors: Array.from(this.selectors),
      structure: this.generateStructureTests(),
      dom: dom // Return DOM for further processing
    };
  }

  /**
   * Extract information from a single element
   * @param {Element} element - DOM element
   * @returns {Object} Element information
   */
  extractElementInfo(element) {
    const info = {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: Array.from(element.classList),
      attributes: {},
      textContent: element.textContent?.trim() || null,
      parent: element.parentElement?.tagName?.toLowerCase() || null,
      children: Array.from(element.children).map(child => child.tagName.toLowerCase())
    };

    // Extract all attributes
    for (const attr of element.attributes) {
      info.attributes[attr.name] = attr.value;
    }

    return info;
  }

  /**
   * Generate CSS selectors for an element
   * @param {Element} element - DOM element
   */
  generateSelectors(element) {
    // ID selector
    if (element.id) {
      this.selectors.add(`#${element.id}`);
    }

    // Class selectors
    if (element.classList.length > 0) {
      for (const className of element.classList) {
        this.selectors.add(`.${className}`);
      }
    }

    // Tag selector
    this.selectors.add(element.tagName.toLowerCase());

    // Combined selectors
    if (element.id && element.classList.length > 0) {
      const classes = Array.from(element.classList).join('.');
      this.selectors.add(`#${element.id}.${classes}`);
    }
  }

  /**
   * Generate structure test cases
   * @returns {Array} Array of structure test cases
   */
  generateStructureTests() {
    const tests = [];

    for (const element of this.elements) {
      // Skip body and html elements
      if (['body', 'html', 'head'].includes(element.tag)) {
        continue;
      }

      const test = {
        type: "structure",
        description: `Element ${element.tag} should exist`,
        selector: this.getElementSelector(element),
        expected: {
          exists: true,
          tag: element.tag
        }
      };

      // Add ID expectation if present
      if (element.id) {
        test.expected.id = element.id;
      }

      // Add class expectations if present
      if (element.classes.length > 0) {
        test.expected.classes = element.classes;
      }

      // Add attribute expectations
      if (Object.keys(element.attributes).length > 0) {
        test.expected.attributes = element.attributes;
      }

      // Add text content expectation if present
      if (element.textContent) {
        test.expected.textContent = element.textContent;
      }

      tests.push(test);
    }

    return tests;
  }

  /**
   * Get the best selector for an element
   * @param {Object} element - Element info
   * @returns {string} CSS selector
   */
  getElementSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }
    
    if (element.classes.length > 0) {
      return `.${element.classes[0]}`;
    }
    
    return element.tag;
  }

  /**
   * Find elements that might be targets for JavaScript events
   * @returns {Array} Interactive elements
   */
  getInteractiveElements() {
    const interactiveTags = ['button', 'input', 'form', 'a', 'select', 'textarea'];
    
    return this.elements.filter(element => 
      interactiveTags.includes(element.tag) || 
      element.attributes.onclick ||
      element.attributes.onmouseover ||
      element.attributes.onsubmit
    );
  }

  /**
   * Get form elements for validation
   * @returns {Array} Form elements
   */
  getFormElements() {
    return this.elements.filter(element => 
      element.tag === 'form' || 
      ['input', 'select', 'textarea'].includes(element.tag)
    );
  }
}
