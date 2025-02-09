const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require('./hootie-serverstate-firebase-adminsdk-fbsvc-925308cb6c.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://hootie-serverstate-default-rtdb.asia-southeast1.firebasedatabase.app' // Replace with your Firebase DB URL
});

const db = admin.database();

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

// backup Retrival

async function loadUserCountFromFirebase() {
    try {
        const snapshot = await db.ref('backups/userCount').once('value');
        userCount = snapshot.val() || 0;
        console.log('✅ User count restored from Firebase.');
    } catch (error) {
        console.error('❌ Error loading user count from Firebase:', error);
    }
}

async function loadUsersFromFirebase() {
    try {
        const snapshot = await db.ref('backups/users').once('value');
        users = snapshot.val() || {};
        console.log('✅ Users restored from Firebase.');
    } catch (error) {
        console.error('❌ Error loading users from Firebase:', error);
    }
}

async function loadPendingMessagesFromFirebase() {
    try {
        const snapshot = await db.ref('backups/pendingMessages').once('value');
        pendingMessages = snapshot.val() || {};
        console.log('✅ Pending messages restored from Firebase.');
    } catch (error) {
        console.error('❌ Error loading pending messages from Firebase:', error);
    }
}


async function loadAllBackups() {
    await loadUserCountFromFirebase();
    await loadUsersFromFirebase();
    await loadPendingMessagesFromFirebase();
}

loadAllBackups();



// firebase backup 

async function saveUserCountToFirebase() {
    try {
        await db.ref('backups/userCount').set(userCount);
        console.log('✅ User count backup saved to Firebase.');
    } catch (error) {
        console.error('❌ Error saving user count to Firebase:', error);
    }
}

async function saveUsersToFirebase() {
    try {
        await db.ref('backups/users').set(users);
        console.log('✅ Users backup saved to Firebase.');
    } catch (error) {
        console.error('❌ Error saving users to Firebase:', error);
    }
}

async function savePendingMessagesToFirebase() {
    try {
        await db.ref('backups/pendingMessages').set(pendingMessages);
        console.log('✅ Pending messages backup saved to Firebase.');
    } catch (error) {
        console.error('❌ Error saving pending messages to Firebase:', error);
    }
}



// Handle socket connection
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    socket.on('new-user-joined', data =>{
        data.socketID = socket.id;
        ActiveUser[socket.id] = data;
        users[data.uid] = data;
        userCount++;

        Promise.all([
        saveUserCountToFirebase(),
        saveUsersToFirebase()
        ])
        .then(() => {
        console.log('connection backup completed.');
    })
    .catch((error) => {
        console.error('Error during connection backup:', error);
    });
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
    Promise.all([
        savePendingMessagesToFirebase()
        ])
        .then(() => {
        console.log('pendingIntent backup completed.');
    })
    .catch((error) => {
        console.error('Error during pendingIntent backup:', error);
    });

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
                Promise.all([
                    savePendingMessagesToFirebase()
                ])
                .then(() => {
                    console.log('pending Cleaner backup completed.');
                })
                .catch((error) => {
                    console.error('Error during pending Cleaner backup:', error);
                });
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

         Promise.all([
         saveUserCountToFirebase(),
         saveUsersToFirebase()
        ])
        .then(() => {
           console.log('disconnect backup completed.');
           delete ActiveUser[socketId];
        })
        .catch((error) => {
            console.error('Error during disconnect backup:', error);
         });
        // Remove the user from ActiveUser and users
        // Log the remaining user count
        console.log('Current user count:', userCount);
    } else {
        console.log('Socket ID not found in ActiveUser:', socketId);
    }
});

});

app.get('/backup', (req, res) => {
    Promise.all([
        saveUserCountToFirebase(),
        saveUsersToFirebase(),
        savePendingMessagesToFirebase()
    ])
    .then(() => {
        console.log('✅ Manual backup completed.');
        res.status(200).json({ message: 'Backup successful' });
    })
    .catch((error) => {
        console.error('❌ Error during manual backup:', error);
        res.status(500).json({ message: 'Backup failed', error: error.message });
    });
});



const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
