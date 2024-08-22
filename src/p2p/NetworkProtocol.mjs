import net from 'node:net';
import crypto from 'node:crypto';
import EventEmitter from 'node:events';

class NetworkProtocol extends EventEmitter {
    constructor(peerManager, messageHandler, port, fullNode, p2pNode) {
        super();
        this.peerManager = peerManager;
        this.messageHandler = messageHandler;
        this.port = port;
        this.fullNode = fullNode;
        this.server = null;
        this.nodeId = this.generateNodeId();
        this.version = '0.3.1';
        this.p2pNode = p2pNode;
        this.seenMessages = new Set();  
    }

    generateNodeId() {
        return crypto.randomBytes(32).toString('hex');
    }

    monitorPeers() {
        setInterval(() => {
            const now = Date.now();
            this.peerManager.getAllPeers().forEach(peer => {
                if (now - peer.lastSeen > 60000) { // If more than 60 seconds since last seen
                    console.warn(`Peer ${peer.id} is unresponsive, disconnecting`);
                    this.disconnectPeer(peer.id, 'Unresponsive');
                }
            });
        }, 30000); // Run every 30 seconds
    }
    
    start() {
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => this.handleConnection(socket));
            this.server.listen(this.port, () => {
                console.log(`P2P node listening on port ${this.port}`);
                this.monitorPeers(); // Start peer health monitoring
                resolve();
            });
            this.server.on('error', (error) => {
                console.error(`Server error on port ${this.port}:`, error);
                reject(error);
            });
        });
    }
    

    connect(host, port, retries = 5) {
        return new Promise((resolve, reject) => {
            const socket = new net.Socket();
    
            const attemptConnection = (attempt) => {
                if (attempt > retries) {
                    return reject(new Error(`Failed to connect to ${host}:${port} after ${retries} attempts`));
                }
    
                socket.connect(port, host, () => {
                    console.log(`Connected to peer ${host}:${port} on attempt ${attempt}`);
                    this.handleConnection(socket);
                    resolve(socket);
                });
    
                socket.on('error', (error) => {
                    console.error(`Connection error to ${host}:${port} on attempt ${attempt}:`, error);
                    // Retry after a delay
                    setTimeout(() => attemptConnection(attempt + 1), 5000); // 5 seconds delay
                });
            };
    
            attemptConnection(1); // Start with the first attempt
        });
    }

    broadcast(message, exceptPeerId = null) {
        //console.log(`Broadcasting message: ${message.type}`);
        this.peerManager.getAllPeers().forEach(peer => {
            if (peer.id !== exceptPeerId) {
                try {
                    //console.log(`Sending ${message.type} to peer ${peer.id}`);
                    peer.send(message);
                } catch (error) {
                    console.error(`Error broadcasting to peer ${peer.id}:`, error);
                    //this.peerManager.updatePeerScore(peer.id, -1);
                }
            }
        });
    }
    handleMessage(peerId, data) {
        // console.log(`Received data from ${peerId}: ${data}`);
        try {
            const messages = this.parseMessages(data);
            for (const message of messages) {
                const messageHash = this.hashMessage(message);  // Generate a hash of the message
                
                if (this.seenMessages.has(messageHash)) {
                    //console.log(`Ignoring duplicate message from peer ${peerId}`);
                    continue;
                }
                //console.log(`Received message of type ${message.type} from ${peerId}`);
                this.seenMessages.add(messageHash);
                this.messageHandler.handle(peerId, message);
            }
        } catch (error) {
            console.error(`Error parsing message from ${peerId}:`, error);
        }
    }
    
    handleConnection(socket) {
        const peerId = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`Handling connection from ${peerId}`);
    
        const peer = {
            id: peerId,
            socket: socket,
            send: (message) => {
                socket.write(JSON.stringify(message) + '\n');
            },
            lastSeen: Date.now(),
            version: null,
            bestHeight: 0
        };
    
        if (this.peerManager.addPeer(peer)) {
            console.log(`Added peer ${peerId}`);
    
            socket.on('data', (data) => {
                peer.lastSeen = Date.now();
                this.handleMessage(peerId, data);
            });
    
            socket.on('close', () => {
                console.log(`Connection closed for peer ${peerId}`);
                this.peerManager.removePeer(peerId);
                this.emit('peerDisconnected', peerId);
                // Try to reconnect
                this.attemptReconnect(peerId, socket.remoteAddress, socket.remotePort);
            });
    
            socket.on('error', (error) => {
                console.error(`Error with peer ${peerId}:`, error);
                this.peerManager.removePeer(peerId);
                // Try to reconnect
                this.attemptReconnect(peerId, socket.remoteAddress, socket.remotePort);
            });
    
            this.sendHandshake(peer);
        } else {
            console.log(`Failed to add peer ${peerId}, closing connection`);
            socket.destroy();
        }
    }

    attemptReconnect(peerId, host, port, attempt = 1) {
        const maxAttempts = 5;
        const baseDelay = 5000; // Start with 5 seconds
        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff

        if (attempt > maxAttempts) {
            console.log(`Failed to reconnect to peer ${peerId} after ${maxAttempts} attempts. Giving up.`);
            // Optionally, ban or mark the peer as unreachable
            this.peerManager.banPeer(peerId, 60000); // Temporary ban for 1 minute
            return;
        }

        console.log(`Attempting to reconnect to peer ${peerId} (Attempt ${attempt}) after ${delay}ms...`);

        setTimeout(() => {
            this.connect(host, port)
                .then(() => {
                    console.log(`Successfully reconnected to peer ${peerId}`);
                })
                .catch((error) => {
                    console.error(`Connection error to ${host}:${port} on attempt ${attempt}:`, error);
                    this.attemptReconnect(peerId, host, port, attempt + 1);
                });
        }, delay);
    }

    hashMessage(message) {
        const messageString = JSON.stringify(message);
        return crypto.createHash('sha256').update(messageString).digest('hex');
    }

    parseMessages(data) {
        //console.log(`Parsing messages from data: ${data}`);
        return data.toString().split('\n').filter(Boolean).map(JSON.parse);
    }

    sendHandshake(peer) {
        const handshake = {
            type: 'HANDSHAKE',
            nodeId: this.nodeId,
            version: this.version,
            port: this.port,
            bestHeight: this.fullNode.getBlockchainHeight()
        };
        peer.send(handshake);
        this.synchronizeChain(peer.id);
    }


    sendToPeer(peerId, message) {
        // console.log(`Sending message of type ${message.type} to peer ${peerId}`);
        const peer = this.peerManager.getPeer(peerId);
        if (peer) {
            try {
                peer.send(message);
            } catch (error) {
                console.error(`Error sending message to peer ${peerId}:`, error);
                //this.peerManager.updatePeerScore(peerId, -1);
            }
        } else {
            console.warn(`Attempted to send message to non-existent peer ${peerId}`);
        }
    }

    requestBlocks(peerId, startHeight) {
        this.sendToPeer(peerId, { type: 'GET_BLOCKS', startHeight });
    }
    // Request missing transactions from a peer
    requestMissingTransactions(peerId, compactBlock) {
        const missingTxIds = compactBlock.txShortIds.filter(id => !this.fullNode.getTransactionByShortId(id));

        if (missingTxIds.length > 0) {
            this.networkProtocol.sendToPeer(peerId, {
                type: 'GET_TRANSACTIONS',
                txIds: missingTxIds
            });
        }
    }
    disconnectPeer(peerId, reason) {
        const peer = this.peerManager.getPeer(peerId);
        if (peer && peer.socket) {
            console.log(`Disconnecting peer ${peerId}: ${reason}`);
            peer.socket.destroy();
            this.peerManager.removePeer(peerId);
        }
    }

    shutdown() {
        if (this.server) {
            this.server.close(() => {
                console.log('P2P server closed');
            });
        }
        this.peerManager.getAllPeers().forEach(peer => {
            if (peer.socket) {
                peer.socket.destroy();
            }
        });
    }
    requestMissingBlocks(peerId) {
        const currentHeight = this.fullNode.getBlockchainHeight();
        const peer = this.peerManager.getPeer(peerId);
        if (peer && peer.bestHeight > currentHeight) {
            const missingBlocks = Array.from(
                { length: peer.bestHeight - currentHeight },
                (_, i) => ({ type: 'block', index: currentHeight + i + 1 })
            );
            console.log(`Requesting missing blocks from ${currentHeight + 1} to ${peer.bestHeight}`);
            this.sendToPeer(peerId, { type: 'GETDATA', items: missingBlocks });
        }
    }
    requestBlockRange(peerId, startHeight, endHeight) {
        console.log(`Requesting block range from ${startHeight} to ${endHeight} from peer ${peerId}`);
        this.sendToPeer(peerId, { 
            type: 'GET_BLOCKS', 
            startHeight,
            endHeight
        });
    }
    
    async synchronizeChain(peerId) {
        const peer = this.peerManager.getPeer(peerId);
        if (!peer) return;
    
        const localHeight = this.fullNode.getBlockchainHeight();
        if (peer.bestHeight > localHeight) {
            console.log(`Synchronizing with peer ${peerId}. Local height: ${localHeight}, Peer height: ${peer.bestHeight}`);
            const batchSize = 10;
            for (let start = localHeight + 1; start <= peer.bestHeight; start += batchSize) {
                const end = Math.min(start + batchSize - 1, peer.bestHeight);
                this.requestBlockRange(peerId, start, end);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second between batches
            }
        }
    
        // If the peer is synchronized, start the consensus process to propose a block
        if (peer.bestHeight >= localHeight) {
            
        }
    }

    gossipMessage(message, excludePeerId = null) {
        const peers = this.peerManager.getAllPeers();
        
        // Select a random subset of peers to send the message to
        const peerSubset = peers
            .filter(peer => peer.id !== excludePeerId)  // Exclude the sender
            .sort(() => 0.5 - Math.random())             // Randomize the list
            .slice(0, Math.ceil(peers.length * 0.3));    // Select 30% of peers
    
        peerSubset.forEach(peer => {
            try {
                peer.send(message);
            } catch (error) {
                console.error(`Error gossiping message to peer ${peer.id}:`, error);
            }
        });
    }
    
    
}

export default NetworkProtocol;