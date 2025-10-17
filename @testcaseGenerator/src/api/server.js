import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { TestcaseGenerator } from '../testcaseGenerator.js';
import { TestcaseEditor } from '../testcaseEditor.js';
import path from 'path';

class TestcaseGeneratorAPI {
  constructor() {
    this.app = express();
    this.generator = new TestcaseGenerator();
    this.editor = new TestcaseEditor();
    this.port = process.env.PORT || 3000;
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['.html', '.css', '.js'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
          cb(null, true);
        } else {
          cb(new Error('Only HTML, CSS, and JS files are allowed'), false);
        }
      }
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Generate testcases from files
    this.app.post('/api/generate', async (req, res) => {
      try {
        const { files, options = {} } = req.body;
        
        if (!files || Object.keys(files).length === 0) {
          return res.status(400).json({ error: 'No files provided' });
        }

        const result = await this.generator.generateFromFiles(files, options);
        res.json(result);
      } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Generate testcases from single code string
    this.app.post('/api/generate/code', async (req, res) => {
      try {
        const { code, language, options = {} } = req.body;
        
        if (!code || !language) {
          return res.status(400).json({ error: 'Code and language are required' });
        }

        const result = await this.generator.generateFromCode(code, language, options);
        res.json(result);
      } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Upload files and generate testcases
    this.app.post('/api/upload', this.upload.array('files'), async (req, res) => {
      try {
        if (!req.files || req.files.length === 0) {
          return res.status(400).json({ error: 'No files uploaded' });
        }

        const files = {};
        for (const file of req.files) {
          files[file.originalname] = file.buffer.toString('utf-8');
        }

        const options = req.body.options ? JSON.parse(req.body.options) : {};
        const result = await this.generator.generateFromFiles(files, options);
        
        res.json(result);
      } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Editor endpoints
    this.app.post('/api/editor/load', async (req, res) => {
      try {
        const { files, options = {} } = req.body;
        const result = await this.editor.loadCode(files, options);
        res.json(result);
      } catch (error) {
        console.error('Editor load error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/editor/testcase', async (req, res) => {
      try {
        const { filename, testcase } = req.body;
        const testcaseId = this.editor.addTestcase(filename, testcase);
        res.json({ testcaseId });
      } catch (error) {
        console.error('Add testcase error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.put('/api/editor/testcase/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const { updates } = req.body;
        const success = this.editor.updateTestcase(id, updates);
        res.json({ success });
      } catch (error) {
        console.error('Update testcase error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.delete('/api/editor/testcase/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const success = this.editor.deleteTestcase(id);
        res.json({ success });
      } catch (error) {
        console.error('Delete testcase error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/editor/duplicate/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const newId = this.editor.duplicateTestcase(id);
        res.json({ testcaseId: newId });
      } catch (error) {
        console.error('Duplicate testcase error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/editor/reorder', async (req, res) => {
      try {
        const { filename, fromIndex, toIndex } = req.body;
        const success = this.editor.reorderTestcases(filename, fromIndex, toIndex);
        res.json({ success });
      } catch (error) {
        console.error('Reorder testcases error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/editor/suggest', async (req, res) => {
      try {
        const { filename } = req.body;
        const suggestions = await this.editor.suggestTestcases(filename);
        res.json({ suggestions });
      } catch (error) {
        console.error('Suggest testcases error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/editor/export', (req, res) => {
      try {
        const { includeMetadata = false } = req.query;
        const exported = this.editor.exportTestcases({ includeMetadata: includeMetadata === 'true' });
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="testcases.json"');
        res.json(exported);
      } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/editor/stats', (req, res) => {
      try {
        const stats = this.editor.getStatistics();
        res.json(stats);
      } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Analysis endpoints
    this.app.post('/api/analyze', async (req, res) => {
      try {
        const { code, language } = req.body;
        
        if (!code || !language) {
          return res.status(400).json({ error: 'Code and language are required' });
        }

        let analysis = {};
        
        if (language === 'html') {
          const result = this.generator.htmlParser.parse(code);
          analysis = {
            elements: result.elements.length,
            selectors: result.selectors.length,
            interactiveElements: result.interactiveElements?.length || 0,
            structure: result.structure.length
          };
        } else if (language === 'css') {
          const result = await this.generator.cssParser.parse(code);
          analysis = {
            rules: result.rules.length,
            selectors: result.selectors.length,
            properties: Object.keys(result.properties).length,
            colors: result.colors?.length || 0,
            mediaQueries: result.mediaQueries?.length || 0
          };
        } else if (language === 'js') {
          const result = this.generator.jsParser.parse(code);
          analysis = {
            events: result.events.length,
            functions: result.functions.length,
            variables: result.variables.length,
            conditions: result.conditions.length,
            objects: result.objects.length,
            domManipulations: result.domManipulations.length
          };
        }

        res.json({ analysis });
      } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Serve static files
    this.app.use('/ui', express.static(path.join(process.cwd(), 'src', 'admin-ui')));
    
    // Serve the main UI
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'src', 'admin-ui', 'index.html'));
    });

    // Error handling middleware
    this.app.use((error, req, res, next) => {
      console.error('API Error:', error);
      res.status(500).json({ error: error.message });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`🚀 Testcase Generator API running on port ${this.port}`);
      console.log(`📱 Admin UI: http://localhost:${this.port}`);
      console.log(`📚 API Docs: http://localhost:${this.port}/api/health`);
    });
  }
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new TestcaseGeneratorAPI();
  server.start();
}

export { TestcaseGeneratorAPI };
