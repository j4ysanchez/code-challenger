const net = require('net');

const socket = net.connect(53, '8.8.8.8');
socket.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
