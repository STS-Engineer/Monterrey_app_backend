// socketManager.js
let io = null;
const connectedUsers = {};

function setIo(socketIoInstance) {
  io = socketIoInstance;
}

function getIo() {
  return io;
}

function getConnectedUsers() {
  return connectedUsers;
}

module.exports = {
  setIo,
  getIo,
  connectedUsers,
  getConnectedUsers,
};
