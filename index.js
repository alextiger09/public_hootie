const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// CORS handling
const io = new Server(server, {
    cors: {
        origin: '*', // Allow all origins
        methods: ['GET', 'POST']
    }
});

app.use(cors());
app.use(express.json());

// Simple route
app.get('/', (req, res) => {
    res.send('Socket.io server is running');
});

let userCount = 0;
let users = {};
let ActiveUser = {};
let pendingMessages = {};


// Handle socket connection
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    socket.on('new-user-joined', data =>{
        data.socketID = socket.id;
        ActiveUser[socket.id] = data;
        users[data.uid] = data;
        userCount++;
        console.log(userCount, users)
        
    });
    socket.on('pendingIntent', (data) => {
    let { receiver, sender, chatId } = data;

    // Initialize receiver object if not already present
    if (!pendingMessages[receiver]) {
        pendingMessages[receiver] = {};
    }

    // Initialize chatId object if not already present
    if (!pendingMessages[receiver][chatId]) {
        pendingMessages[receiver][chatId] = { PendingMsg: 0 };
    }

    // Increment the PendingMsg counter
    pendingMessages[receiver][chatId].PendingMsg += 1;
    console.log(pendingMessages)

    console.log(`Pending message count for ${receiver} in chat ${chatId}: ${pendingMessages[receiver][chatId].PendingMsg}`);
});
       socket.on('getPendingData', (data) => {
        let requestedSocketId = socket.id;
        let uid = data.uid;
        if (ActiveUser[requestedSocketId]) {
            if (ActiveUser[requestedSocketId].uid === uid) {
                let userPendingMessages = pendingMessages[uid] || [];
                socket.emit('pendingDataResponse', { pendingMessages: userPendingMessages });
            } else {
                console.log('Socket ID does not match the requested UID.');
                socket.emit('pendingDataResponse', { pendingMessages: [] });
            }
        } else {
            console.log('No user found for the socket ID.');
            socket.emit('pendingDataResponse', { pendingMessages: [] });
        }
    });
      socket.on('clearPendingData', (data) => {
    let requestedSocketId = socket.id;
    let uid = data.uid;
    let chatId = data.chatId;

    if (ActiveUser[requestedSocketId]) {
        if (ActiveUser[requestedSocketId].uid === uid) {
            // Check if pendingMessages[uid] exists before attempting to modify
            if (pendingMessages[uid] && pendingMessages[uid][chatId]) {
                pendingMessages[uid][chatId] = { PendingMsg: 0 };
                console.log(`Pending messages cleared for UID: ${uid}, ChatID: ${chatId}`);
            } else {
                console.log(`No pending messages found for UID: ${uid}, ChatID: ${chatId}`);
            }
        } else {
            console.log('Unauthorized attempt to clear pending messages.');
        }
    } else {
        console.log('Socket ID not found, unauthorized action.');
    }
});

    socket.on('getOnlineState', (data) => {
    let uid = data.uid;

    // Check if the user exists in the users object
    if (users[uid]) {
        let socketId = users[uid].socketID;

        // Check if the user is online
        if (ActiveUser[socketId]) {
            // Emit the online state as true
            socket.emit('onlineStateResponse', { online: true, uid: uid });
        } else {
            // Emit the online state as false
            socket.emit('onlineStateResponse', { online: false, uid: uid, offlineTime: users[uid].offlineTime});
        }
    } else {
        // Emit the online state as false if user is not found
        socket.emit('onlineStateResponse', { online: false, uid: uid, offlineTime: 'Offline'});
    }
});

   socket.on('typing-state', (data) => {
    let userid = data.uid;
    let client = data.to;
    let action = data.action;
  if (users[client]?.socketID) {
        let clientSocketId = users[client].socketID;

        // Check if the client is active (online)
        if (ActiveUser[clientSocketId]) {
            console.log(`User ${client} is online, sending typing state...`);
        socket.to(clientSocketId).emit('typing-state', { uid: userid, action: action });
        console.log(`Typing state sent to ${client} (Socket ID: ${clientSocketId})`);
        }

        // Emit the event only to the intended client
    } else {
        console.log(`User ${client} not found or offline.`);
    }
});


    socket.on('message', (data) => {
        console.log('Received message:', data);
        io.emit('message', data); // Broadcast message to all clients
    });

    socket.on('disconnect', () => {
    let socketId = socket.id;

    // Check if the socket ID exists in ActiveUser
    if (ActiveUser[socketId]) {
        let uid = ActiveUser[socketId].uid;
        
        if (users[uid]) {
            users[uid].offlineTime = Date.now(); // Stores the timestamp in milliseconds
        }
        // Decrement user count
        userCount--;
        console.log(`User disconnected: ${socketId}, UID: ${uid}`);
        
        // Remove the user from ActiveUser and users
        delete ActiveUser[socketId];
        // Log the remaining user count
        console.log('Current user count:', userCount);
    } else {
        console.log('Socket ID not found in ActiveUser:', socketId);
    }
});

});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
