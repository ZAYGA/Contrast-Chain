'use strict';
import { test } from './ContrastTests.mjs';

// Simple express server to serve test-front.html
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.static(__dirname));
//app.use(express.static('public'));

app.get('/', (req, res) => { res.sendFile(__dirname + '/test-front.html'); });

const server = app.listen(3000, () => { console.log('Server running on http://localhost:3000'); });

const wss = new WebSocketServer({ server });

wss.on('connection', function connection(ws) {
    console.log('Client connected');

    const intervalId = setInterval(() => {
        //ws.send('Message sent at ' + new Date());
        ws.send(JSON.stringify({ type: 'message', data: 'Message sent at ' + new Date() }));
    }, 1000);

    ws.on('close', function close() {
        console.log('Connection closed');
        clearInterval(intervalId);
    });

    ws.on('message', function incoming(message) {
        console.log('received: %s', message);
    });
});

test(wss);