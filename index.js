const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();
const http = require('http');
const path = require('path');

const prodformrouter = require('./services/formulaire');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: 'https://machinery-system.azurewebsites.net' }));
app.use(express.json());

// Routes
app.use('/ajouter', prodformrouter);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// If tasks and inbox routers no longer depend on sockets, just import normally
const tasksRouter = require('./services/tasks')(null, null);
app.use('/api/tasks', tasksRouter);

const inboxRouter = require('./services/inbox')(null, null);
app.use('/api/inbox', inboxRouter);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
