import { BlockchainNode } from '../blockchain-node.mjs';
import { VRF } from './vrf.mjs';
import crypto from 'crypto';
import BN from 'bn.js';

class VRFNode extends BlockchainNode {
    constructor(options, pubSubManager, blockManager, eventBus, networkManager) {
      super(options, pubSubManager, blockManager, eventBus, networkManager);
        
        this.role = 'validator';
        this.vrf = new VRF();
        this.vrfKeyPair = this.vrf.generateKeypair();
        this.publicKey = this.vrfKeyPair.publicKey;
        this.privateKey = this.vrfKeyPair.privateKey;

        this.activeValidators = new Map();
        this.currentValidatorSet = [];
        this.validatorIndex = -1;

        this.currentEpoch = 0;
        this.currentRound = 0;
        this.epochInterval = options.epochInterval || 300000; // 5 minutes
        this.roundInterval = options.roundInterval || 60000; // 1 minute
        this.maxValidators = options.maxValidators || 100;
        this.pendingTransactions = [];

        this.epochLoopInterval = null;
        this.roundLoopInterval = null;

    }

    async start() {
        await super.start();
        await this.setupAdditionalEventListeners();
        await this.announcePresence();
        this.startEpochLoop();
        this.startRoundLoop();
    }

    async stop() {
        
        // Clear intervals
        if (this.epochLoopInterval) clearInterval(this.epochLoopInterval);
        if (this.roundLoopInterval) clearInterval(this.roundLoopInterval);

        // Unsubscribe from topics
        await this.pubSubManager.unsubscribe('validator-announce');
        await this.pubSubManager.unsubscribe('vrf-proof');

        // Remove event listeners
        this.eventBus.removeAllListeners('newBlock');

        // Stop the underlying blockchain node
        await super.stop();

        console.log(`VRFNode stopped: ${this.node.peerId.toString()}`);
    }

    async setupAdditionalEventListeners() {
        await this.pubSubManager.subscribe('validator-announce', this.handleValidatorAnnouncement.bind(this));
        await this.pubSubManager.subscribe('vrf-proof', this.handleVRFProof.bind(this));
        this.eventBus.on('newBlock', this.handleNewBlock.bind(this));
    }

    async announcePresence() {
        const announcement = {
            peerId: this.node.peerId.toString(),
            publicKey: this.publicKey,
            timestamp: Date.now()
        };
        try {
            await this.pubSubManager.broadcast('validator-announce', announcement);
            console.log('Validator presence announced successfully');
        } catch (error) {
            console.warn('Failed to announce validator presence:', error.message);
            // You might want to implement a retry mechanism here
        }
    }

    startEpochLoop() {
        this.epochLoopInterval = setInterval(() => this.startNewEpoch(), this.epochInterval);
    }

    startRoundLoop() {
        this.roundLoopInterval = setInterval(() => this.startNewRound(), this.roundInterval);
    }

    async startNewEpoch() {
        this.currentEpoch++;
        await this.determineValidatorSet();
        this.determineValidatorIndex();
        this.eventBus.emit('newEpoch', this.currentEpoch);
    }

    async startNewRound() {
        this.currentRound++;
        if (this.isLeader()) {
            await this.broadcastLeaderProof();
            await this.createBlockCandidate();
        }
    }

    async determineValidatorSet() {
        const allValidators = Array.from(this.activeValidators.keys());
        const epochSeed = `epoch-${this.currentEpoch}`;
        
        const validatorsWithProofs = allValidators.map(validator => {
            const proof = this.vrf.prove(this.privateKey, epochSeed + validator);
            const hash = this.vrf.proofToHash(proof);
            return { validator, hash };
        });
    
        const sortedValidators = validatorsWithProofs.sort((a, b) => 
            Buffer.from(a.hash, 'hex').compare(Buffer.from(b.hash, 'hex'))
        ).map(v => v.validator);
    
        this.currentValidatorSet = sortedValidators.slice(0, this.maxValidators);
    }

    determineValidatorIndex() {
        this.validatorIndex = this.currentValidatorSet.indexOf(this.publicKey);
    }

    isLeader() {
        if (this.validatorIndex === -1 || this.currentValidatorSet.length === 0) {
            return false;
        }
        
        const leaderSeed = `leader-${this.currentEpoch}-${this.currentRound}`;
        const proof = this.vrf.prove(this.privateKey, leaderSeed);
        const hash = this.vrf.proofToHash(proof);
        const hashNum = new BN(hash, 16);
        const maxValue = new BN(2).pow(new BN(256));
        const threshold = maxValue.div(new BN(this.currentValidatorSet.length));
        
        const isLeader = hashNum.lt(threshold);
        console.log(`Is leader this round: ${isLeader}`);
        return isLeader;
    }

    async broadcastLeaderProof() {
        const leaderSeed = `leader-${this.currentEpoch}-${this.currentRound}`;
        const proof = this.vrf.prove(this.privateKey, leaderSeed);
        const leaderProof = {
            peerId: this.node.peerId.toString(),
            publicKey: this.publicKey,
            epoch: this.currentEpoch,
            round: this.currentRound,
            proof: proof
        };
        await this.pubSubManager.broadcast('vrf-proof', leaderProof);
    }

    async handleValidatorAnnouncement(announcement) {
        if (announcement.peerId !== this.node.peerId.toString()) {
            this.activeValidators.set(announcement.publicKey, {
                peerId: announcement.peerId,
                lastSeen: Date.now()
            });
        }
    }

    async handleVRFProof(proofMessage) {
        
        const { peerId, publicKey, epoch, round, proof } = proofMessage;
        if (epoch !== this.currentEpoch || round !== this.currentRound) {
            console.warn(`Received outdated VRF proof from ${peerId}`);
            return;
        }
        this.eventBus.emit('newVRFProof', proofMessage);

        const isValid = this.vrf.verify(publicKey, `leader-${epoch}-${round}`, proof);
        if (!isValid) {
            console.warn(`Received invalid VRF proof from ${peerId}`);
            return;
        }
        
        const hash = this.vrf.proofToHash(proof);
        const hashNum = new BN(hash, 16);
        const threshold = new BN(2).pow(new BN(256)).divn(this.currentValidatorSet.length);
        const isLeader = hashNum.lt(threshold);

        if (isLeader) {
            console.log(`Verified leader for round ${round}: ${peerId}`);
            this.eventBus.emit('leaderElected', { peerId, epoch, round });
        } else {
            console.log(`Received valid proof from ${peerId}, but not elected as leader`);
        }
    }

    async createBlockCandidate() {
        if (this.pendingTransactions.length === 0) {
            return;
        }

        const transactions = this.pendingTransactions.slice(0, 10); // Take up to 10 transactions
        const blockCandidate = this.blockManager.createBlock(
            this.blockManager.getLatestBlockNumber() + 1,
            this.blockManager.getLatestBlockHash(),
            JSON.stringify(transactions)
        );

        await this.pubSubManager.broadcast('block_candidate', blockCandidate);
    }

    async handleNewBlock(block) {
        if (this.blockManager.isValidBlock(block)) {
            this.blockManager.addBlock(block);
            // Remove transactions in this block from the pending pool
            this.removePendingTransactions(JSON.parse(block.data));
        } else {
            console.error('ValidatorNode: Received invalid block');
        }
    }

    removePendingTransactions(confirmedTransactions) {
        const confirmedIds = new Set(confirmedTransactions.map(tx => tx.id));
        this.pendingTransactions = this.pendingTransactions.filter(tx => !confirmedIds.has(tx.id));
    }
}

export { VRFNode };