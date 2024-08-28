import { expect } from 'chai';
import sinon from 'sinon';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { mplex } from '@libp2p/mplex';
import { noise } from '@chainsafe/libp2p-noise';
import { multiaddr } from 'multiaddr';
import { NodeManager } from '../core/node-manager.mjs';
import { BlockchainNode } from '../core/blockchain-node.mjs';

describe('Node Bootstrapping', function() {
  this.timeout(10000); // Increase timeout for network operations

  let nodeManager;
  let bootstrapNodes;
  let sandbox;

  before(async function() {
    // Create actual libp2p nodes to serve as bootstrap nodes
    bootstrapNodes = await Promise.all([
      createBootstrapNode('/ip4/127.0.0.1/tcp/63785'),
      createBootstrapNode('/ip4/127.0.0.1/tcp/63786')
    ]);

    bootstrapNodes = bootstrapNodes.map(node => node.getMultiaddrs()[0].toString());
  });

  beforeEach(function() {
    sandbox = sinon.createSandbox();
    nodeManager = new NodeManager(bootstrapNodes);
  });

  afterEach(function() {
    sandbox.restore();
  });

  after(async function() {

  });

  it('should connect to bootstrap nodes on start', async function() {
    const node = await nodeManager.createNode('testNode', { role: 'validator' });
    
    // Wait a bit for connections to establish
    await new Promise(resolve => setTimeout(resolve, 1000));

    const connectedPeers = node.node.getConnections().map(conn => conn.remoteAddr.toString());
    
    expect(connectedPeers).to.have.lengthOf(bootstrapNodes.length);
    for (const bootstrapNode of bootstrapNodes) {
      expect(connectedPeers).to.include(bootstrapNode);
    }
  });

  it('should attempt to reconnect to bootstrap nodes if connection fails', async function() {
    const dialSpy = sandbox.spy(BlockchainNode.prototype, 'start');
    
    // Simulate one bootstrap node being down
    const downNodeIndex = 0;
    const originalCreateLibp2p = BlockchainNode.prototype.createLibp2p;
    sandbox.stub(BlockchainNode.prototype, 'createLibp2p').callsFake(async function() {
      const node = await originalCreateLibp2p.call(this);
      const originalDial = node.dial.bind(node);
      node.dial = async function(addr) {
        if (addr.toString() === bootstrapNodes[downNodeIndex]) {
          throw new Error('Connection refused');
        }
        return originalDial(addr);
      };
      return node;
    });

    const node = await nodeManager.createNode('testNode', { role: 'full' });
    
    // Wait a bit for connections to establish
    await new Promise(resolve => setTimeout(resolve, 1000));

    const connectedPeers = node.node.getConnections().map(conn => conn.remoteAddr.toString());
    
    expect(connectedPeers).to.have.lengthOf(bootstrapNodes.length - 1);
    expect(connectedPeers).to.not.include(bootstrapNodes[downNodeIndex]);
    expect(connectedPeers).to.include(bootstrapNodes[1]);

    // Verify that we attempted to connect to all bootstrap nodes
    expect(dialSpy.calledOnce).to.be.true;
    const dialCalls = dialSpy.getCall(0).returnValue;
    expect(dialCalls).to.have.lengthOf(bootstrapNodes.length);
  });
});

async function createBootstrapNode(addr) {
  const node = await createLibp2p({
    addresses: { listen: [addr] },
    transports: [tcp()],
    streamMuxers: [mplex()],
    connectionEncryption: [noise()],
  });
  await node.start();
  return node;
}