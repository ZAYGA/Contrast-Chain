import { expect } from 'chai';
import sinon from 'sinon';
import { NodeManager } from '../../core/node-manager.mjs';

describe('VRFNode Network', function() {
    let nodeManager, nodes;

    beforeEach(async function() {
        this.timeout(10000); // Increase timeout for node creation and network setup

        nodeManager = new NodeManager();
        nodes = {};

        // Create multiple VRF nodes
        for (let i = 1; i <= 3; i++) {
            const node = await nodeManager.createNode(`validator${i}`, {
                role: 'VRF_validator',
                listenAddress: `/ip4/127.0.0.1/tcp/${10000 + i}`,
                epochInterval: 300000,
                roundInterval: 60000,
                maxValidators: 10
            });
            nodes[`validator${i}`] = node;
        }

        await nodeManager.connectAllNodes();

        // Subscribe all nodes to necessary topics
        await nodeManager.subscribeAll('validator-announce', () => {});
        await nodeManager.subscribeAll('vrf-proof', () => {});
        await nodeManager.subscribeAll('block_candidate', () => {});

        // Wait for connections and subscriptions to stabilize
        await new Promise(resolve => setTimeout(resolve, 2000));
    });

    afterEach(async function() {
        await nodeManager.shutdownAllNodes();
        sinon.restore();
    });

    describe('Network Setup', function() {
        it('should create multiple VRFNodes and connect them', async function() {
            expect(Object.keys(nodes)).to.have.lengthOf(3);
            for (const node of Object.values(nodes)) {
                expect(node.role).to.equal('validator');
                expect(node.vrf).to.exist;
            }
        });
    });

    describe('Validator Announcement', function() {
        it('should broadcast validator announcements', async function() {
            const broadcastSpy = sinon.spy(nodes.validator1.getPubSubManager(), 'broadcast');
            await nodes.validator1.announcePresence();
            expect(broadcastSpy.calledWith('validator-announce')).to.be.true;
        });
    });
    
    describe('Validator Set Determination', function() {
        it('should determine validator set', async function() {
            const node = nodes.validator1;
            node.activeValidators.set('validator1', {});
            node.activeValidators.set('validator2', {});
        
            await node.determineValidatorSet();
            expect(node.currentValidatorSet).to.have.lengthOf(2);
            expect(node.currentValidatorSet).to.include('validator1');
            expect(node.currentValidatorSet).to.include('validator2');
        });
    });

    describe('Leader Election', function() {
        it('should elect a leader or not based on VRF proof', function() {
            const node = nodes.validator1;
            
            node.validatorIndex = 0;
            node.currentValidatorSet = ['validator1', 'validator2'];
            node.currentEpoch = 1;
            node.currentRound = 1;

            const result = node.isLeader();
            expect(typeof result).to.equal('boolean');
        });

        it('should not be leader if not in validator set', function() {
            const node = nodes.validator1;
            node.validatorIndex = -1;
            expect(node.isLeader()).to.be.false;
        });
    });

    describe('VRF Proof Handling', function() {
        it('should process VRF proofs', async function() {
            const node = nodes.validator1;
            const proofMessage = {
                peerId: node.node.peerId.toString(),
                publicKey: node.publicKey,
                epoch: node.currentEpoch,
                round: node.currentRound,
                proof: node.vrf.prove(node.privateKey, 'test')
            };

            const emitSpy = sinon.spy(node.eventBus, 'emit');

            await node.handleVRFProof(proofMessage);

            expect(emitSpy.called).to.be.true;
        });

        it('should ignore outdated VRF proofs', async function() {
            const node = nodes.validator1;
            const proofMessage = {
                peerId: node.node.peerId.toString(),
                publicKey: node.publicKey,
                epoch: node.currentEpoch - 1,
                round: node.currentRound,
                proof: node.vrf.prove(node.privateKey, 'test')
            };

            const emitSpy = sinon.spy(node.eventBus, 'emit');

            await node.handleVRFProof(proofMessage);

            expect(emitSpy.called).to.be.false;
        });
    });


});