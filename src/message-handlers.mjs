
class BaseMessageHandler {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  getMessageId(message) {
    throw new Error('getMessageId method must be implemented by subclasses');
  }

  handle(message, from) {
    throw new Error('handle method must be implemented by subclasses');
  }
}

class BlockMessageHandler extends BaseMessageHandler {
  getMessageId(block) {
    return block.hash;
  }

  handle(block, from) {
    this.eventBus.emit('newBlock', { block, from });
  }
}

class TransactionMessageHandler extends BaseMessageHandler {
  getMessageId(transaction) {
    return transaction.id;
  }

  handle(transaction, from) {
    this.eventBus.emit('newTransaction', { transaction, from });
  }
}

class BlockCandidateMessageHandler extends BaseMessageHandler {
  getMessageId(blockCandidate) {
    return blockCandidate.hash;
  }

  handle(blockCandidate, from) {
    this.eventBus.emit('newBlockCandidate', { blockCandidate, from });
  }
}

class MinedBlockMessageHandler extends BaseMessageHandler {
  getMessageId(minedBlock) {
    return minedBlock.hash;
  }

  handle(minedBlock, from) {
    this.eventBus.emit('newMinedBlock', { minedBlock, from });
  }
}

class VSSShareMessageHandler extends BaseMessageHandler {
    getMessageId(vssShare) {
      return `${vssShare.round}-${vssShare.fromIndex}-${vssShare.toIndex}`;
    }
  
    handle(vssShare, from) {
      this.eventBus.emit('vssShare', { vssShare, from });
    }
  }
  

class AnnouncementMessageHandler extends BaseMessageHandler {
    getMessageId(announcement) {
        return announcement.hash;
    }
    
    handle(announcement, from) {
        this.eventBus.emit('newAnnouncement', { announcement, from });
    }
    }

    class VRFProofMessageHandler extends BaseMessageHandler {
        constructor(eventBus) {
          super(eventBus);
        }
      
        getMessageId(vrfProof) {
          return `${vrfProof.peerId}-${vrfProof.epoch}-${vrfProof.round}`;
        }
      
        async handle(vrfProof, from) {
          console.log(`Received VRF proof from ${from}: ${JSON.stringify(vrfProof)}`);
        }
      
        async verifyVRFProof(vrfProof) {
          // Implement VRF proof verification logic here
          // This might involve using the VRF library to verify the proof
          // For now, we'll just return true as a placeholder
          return true;
        }
      }
      
export {
  BlockMessageHandler,
  TransactionMessageHandler,
  BlockCandidateMessageHandler,
  MinedBlockMessageHandler,
  VSSShareMessageHandler,
  AnnouncementMessageHandler,
  VRFProofMessageHandler
};