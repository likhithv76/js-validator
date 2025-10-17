# Testcase Generator

Auto-generate and edit test cases from HTML, CSS, and JavaScript code.

## Usage

```bash
# CLI
node src/index.js generate ./code

npm run server
```

## API

```javascript
import { TestcaseGenerator } from './src/testcaseGenerator.js';
import { TestcaseEditor } from './src/testcaseEditor.js';

// Generate testcases
const generator = new TestcaseGenerator();
const result = await generator.generateFromFiles(files);

// Edit testcases
const editor = new TestcaseEditor();
await editor.loadCode(files);
editor.addTestcase('script.js', { type: 'event', ... });
```
