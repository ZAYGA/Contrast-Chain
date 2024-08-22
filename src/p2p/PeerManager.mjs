import { EventEmitter } from 'events';
import dns from 'dns/promises';

export class PeerManager extends EventEmitter {
    constructor(maxPeers, banThreshold) {
        super();
        this.peers = new Map();
        this.maxPeers = maxPeers;
        this.banThreshold = banThreshold;
        this.bannedPeers = new Map();
    }

    addPeer(peer) {
        if (this.peers.size < this.maxPeers && !this.bannedPeers.has(peer.id)) {
            peer.score = 0;
            this.peers.set(peer.id, peer);
            this.emit('peerAdded', peer);
            console.log(`Peer ${peer.id} added. Total peers: ${this.peers.size}`);
            return true;
        }
        return false;
    }

    removePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            this.peers.delete(peerId);
            this.emit('peerRemoved', peer);
            console.log(`Peer ${peerId} removed. Total peers: ${this.peers.size}`);
        }
    }

    getPeer(peerId) {
        return this.peers.get(peerId);
    }

    getAllPeers() {
        return Array.from(this.peers.values());
    }

    getRandomPeers(count) {
        const peerArray = Array.from(this.peers.values());
        return peerArray.sort(() => 0.5 - Math.random()).slice(0, count);
    }

    updatePeerScore(peerId, score) {
        console.log(`Updating score for peer ${peerId}: ${score}`);
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.score = (peer.score || 0) + score;
            console.log(`Updated score for peer ${peerId}: ${peer.score}, Ban threshold: ${this.banThreshold}`);
            if (peer.score <= -this.banThreshold) {
                this.banPeer(peerId);
            }
        } else {
            console.warn(`Attempted to update score for non-existent peer: ${peerId}`);
        }
    }


    banPeer(peerId, duration = 60000) { // Default ban for 1 minute
        const peer = this.peers.get(peerId);
        if (peer) {
            this.peers.delete(peerId);
            this.bannedPeers.set(peerId, Date.now() + duration);
            if (typeof peer.disconnect === 'function') {
                peer.disconnect('Banned due to repeated failures');
            }
            this.emit('peerBanned', peer);
            console.log(`Banned peer ${peerId} for ${duration}ms. Total peers: ${this.peers.size}, Banned peers: ${this.bannedPeers.size}`);
        } else {
            console.warn(`Attempted to ban non-existent peer: ${peerId}`);
        }
    }


    unbanPeer(peerId) {
        if (this.bannedPeers.has(peerId)) {
            this.bannedPeers.delete(peerId);
            console.log(`Unbanned peer ${peerId}. Banned peers: ${this.bannedPeers.size}`);
        } else {
            console.warn(`Attempted to unban not-banned peer: ${peerId}`);
        }
    }

    async resolveDNSSeeds(seeds) {
        const resolvedAddresses = [];
        for (const seed of seeds) {
            try {
                const addresses = await dns.resolve4(seed.host);
                addresses.forEach(address => resolvedAddresses.push({ address, port: seed.port }));
            } catch (error) {
                console.error(`Failed to resolve seed ${seed.host}:`, error);
            }
        }
        return resolvedAddresses;
    }

    cleanupBannedPeers() {
        const now = Date.now();
        for (const [peerId, banExpiry] of this.bannedPeers.entries()) {
            if (now > banExpiry) {
                this.bannedPeers.delete(peerId);
                console.log(`Ban expired for peer ${peerId}. Banned peers: ${this.bannedPeers.size}`);
            }
        }
    }

    cleanupUnresponsivePeers() {
        const now = Date.now();
        for (const [peerId, peer] of this.peers.entries()) {
            if (now - peer.lastSeen > 30000) {
                this.removePeer(peerId);
            }
        }
    }
    

    isBanned(peerId) {
        return this.bannedPeers.has(peerId);
    }
}

export default PeerManager;