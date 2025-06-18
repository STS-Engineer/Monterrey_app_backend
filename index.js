const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();
const http = require('http');
const prodformrouter = require('./services/formulaire');
const socketIO = require('socket.io');
const path = require('path');
const socketManager = require('./socketManager');
const app = express();
const server = http.createServer(app);
const initTaskAlertScheduler = require('./startup/initTaskAlertScheduler');
const io = socketIO(server, {
  cors: {
    origin: '*',
  },
});


socketManager.setIo(io);
const connectedUsers = socketManager.connectedUsers; // <-- use shared object

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join', ({ role, userId }) => {
    socket.join(`${role}_${userId}`);
    console.log(`Client ${userId} joined room ${role}_${userId}`);
  });

  socket.on('taskSubmitted', (data) => {
    console.log('[Server] taskSubmitted received:', data);
    io.emit('notifyManager', data); // or io.to('MANAGER_123').emit(...)
  });

  socket.on('taskValidated', (data) => {
    console.log('[Server] taskValidated received:', data);
    io.emit('notifyExecutor', data);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Pass the shared connectedUsers and io to routers
const tasksRouter = require('./services/tasks')(io, connectedUsers);
app.use('/api/tasks', tasksRouter);
const inboxRouter = require('./services/inbox')(io, connectedUsers);
app.use('/api/inbox', inboxRouter);

app.use('/ajouter', prodformrouter);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
initTaskAlertScheduler();

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
