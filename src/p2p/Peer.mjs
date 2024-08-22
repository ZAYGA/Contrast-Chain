export class Peer {
    constructor(socket, address, port) {
        this.socket = socket;
        this.address = address;
        this.port = port;
        this.id = `${address}:${port}`;
        this.lastSeen = Date.now();
        this.score = 0;
        this.handshakeCompleted = false;
        this.version = null;
        this.nodeId = null;
        this.bestHeight = 0;
    }

    send(message) {
        if (this.socket.writable) {
            const data = JSON.stringify(message) + '\n';
            this.socket.write(data);
        } else {
            throw new Error('Peer socket is not writable');
        }
    }

    disconnect(reason) {
        console.log(`Disconnecting peer ${this.id}: ${reason}`);
        this.socket.destroy();
    }
}