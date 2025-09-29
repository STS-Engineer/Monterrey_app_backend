const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();
const http = require('http');
const path = require('path');

const prodformrouter = require('./services/formulaire');

const app = express();
const server = http.createServer(app);

// ✅ CORS config FIRST
app.use(cors({
  origin: 'https://machinery-system.azurewebsites.net',  // frontend domain
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// ✅ Handle preflight requests explicitly
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', 'https://machinery-system.azurewebsites.net');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.json());

// Routes
app.use('/ajouter', prodformrouter);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const tasksRouter = require('./services/tasks')(null, null);
app.use('/api/tasks', tasksRouter);

const inboxRouter = require('./services/inbox')(null, null);
app.use('/api/inbox', inboxRouter);

const PORT = 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
