import { BlockchainNode } from '../blockchain-node.mjs';
import { VRF } from './vrf.mjs';
import crypto from 'crypto';
import BN from 'bn.js';

class VRFNode extends BlockchainNode {
    constructor(options, pubSubManager, blockManager, eventBus) {
        super(options, pubSubManager, blockManager, eventBus);

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

        console.log(`ValidatorNode constructed with public key: ${this.publicKey}`);
    }

    async start() {
        await super.start();
        console.log(`ValidatorNode starting: ${this.node.peerId.toString()}`);
        this.setupAdditionalEventListeners();
        await this.announcePresence();
        this.startEpochLoop();
        this.startRoundLoop();
    }

    setupAdditionalEventListeners() {
        this.pubSubManager.subscribe('validator-announce', this.handleValidatorAnnouncement.bind(this));
        this.pubSubManager.subscribe('vrf-proof', this.handleVRFProof.bind(this));
        this.eventBus.on('newBlock', this.handleNewBlock.bind(this));
    }

    async announcePresence() {
        const announcement = {
            peerId: this.node.peerId.toString(),
            publicKey: this.publicKey,
            timestamp: Date.now()
        };
        await this.pubSubManager.broadcast('validator-announce', announcement);
    }

    startEpochLoop() {
        setInterval(() => this.startNewEpoch(), this.epochInterval);
    }

    startRoundLoop() {
        setInterval(() => this.startNewRound(), this.roundInterval);
    }

    async startNewEpoch() {
        this.currentEpoch++;
        console.log(`Starting new epoch: ${this.currentEpoch}`);
        await this.determineValidatorSet();
        this.determineValidatorIndex();
        this.eventBus.emit('newEpoch', this.currentEpoch);
    }

    async startNewRound() {
        this.currentRound++;
        console.log(`Starting new round: ${this.currentRound}`);
        if (this.isLeader()) {
            await this.broadcastLeaderProof();
            await this.createBlockCandidate();
        }
    }

    async determineValidatorSet() {
        const allValidators = Array.from(this.activeValidators.keys());
        const epochSeed = `epoch-${this.currentEpoch}`;
        
        const sortedValidators = allValidators.sort((a, b) => {
            const proofA = this.vrf.prove(this.privateKey, epochSeed + a);
            const proofB = this.vrf.prove(this.privateKey, epochSeed + b);
            const hashA = this.vrf.proofToHash(proofA);
            const hashB = this.vrf.proofToHash(proofB);
            return Buffer.from(hashA, 'hex').compare(Buffer.from(hashB, 'hex'));
        });
    
        this.currentValidatorSet = sortedValidators.slice(0, this.maxValidators);
        console.log(`New validator set determined: ${JSON.stringify(this.currentValidatorSet)}`);
    }

    determineValidatorIndex() {
        this.validatorIndex = this.currentValidatorSet.indexOf(this.publicKey);
        console.log(`This node's validator index: ${this.validatorIndex}`);
    }

    isLeader() {
        if (this.validatorIndex === -1) return false;
        
        const leaderSeed = `leader-${this.currentEpoch}-${this.currentRound}`;
        const proof = this.vrf.prove(this.privateKey, leaderSeed);
        const hash = this.vrf.proofToHash(proof);
        const hashNum = new BN(hash, 16);
        const threshold = new BN(2).pow(new BN(256)).divn(this.currentValidatorSet.length);
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
        console.log(`Broadcasted leader proof for round ${this.currentRound}`);
    }

    async handleValidatorAnnouncement(announcement) {
        if (announcement.peerId !== this.node.peerId.toString()) {
            this.activeValidators.set(announcement.publicKey, {
                peerId: announcement.peerId,
                lastSeen: Date.now()
            });
            console.log(`Validator announced: ${announcement.peerId}`);
        }
    }

    async handleVRFProof(proofMessage) {
        const { peerId, publicKey, epoch, round, proof } = proofMessage;
        if (epoch !== this.currentEpoch || round !== this.currentRound) {
            console.log(`Received outdated VRF proof from ${peerId}`);
            return;
        }

        const isValid = this.vrf.verify(publicKey, `leader-${epoch}-${round}`, proof);
        if (!isValid) {
            console.log(`Received invalid VRF proof from ${peerId}`);
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
            console.log('No pending transactions, skipping block candidate creation');
            return;
        }

        const transactions = this.pendingTransactions.slice(0, 10); // Take up to 10 transactions
        const blockCandidate = this.blockManager.createBlock(
            this.blockManager.getLatestBlockNumber() + 1,
            this.blockManager.getLatestBlockHash(),
            JSON.stringify(transactions)
        );

        console.log(`Created block candidate: ${blockCandidate.hash}`);
        await this.pubSubManager.broadcast('block_candidate', blockCandidate);
    }

    async handleNewBlock(block) {
        console.log(`ValidatorNode: Received new block: ${block.hash}`);
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

    async stop() {
        // Implement cleanup logic
        await super.stop();
        console.log(`ValidatorNode stopped: ${this.node.peerId.toString()}`);
    }
}

export { VRFNode };
