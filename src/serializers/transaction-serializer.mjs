import { CompressionManager } from '../compression-manager.mjs';
import FlexibleSerializer from '../flexible-serializer.mjs';

class TransactionSerializer {
  constructor(compressionThreshold = 1024, useMessagePack = true) {
    this.compressionManager = new CompressionManager(compressionThreshold);
    this.serializer = new FlexibleSerializer('../protos/block.proto', useMessagePack);
    this.serializer.registerType('Transaction', 'contrast.Transaction');
  }

  async serializeAndCompress(transaction) {
    try {
      const serializedData = this.serializer.serialize(transaction, 'Transaction');
      return this.compressionManager.compress(serializedData);
    } catch (error) {
      throw new Error(`Serialization error: ${error.message}`);
    }
  }

  async decompressAndDeserialize(data) {
    try {
      const decompressedData = await this.compressionManager.decompress(data);
      return this.serializer.deserialize(decompressedData, 'Transaction');
    } catch (error) {
      throw new Error(`Deserialization error: ${error.message}`);
    }
  }

  setSerializationMethod(useMessagePack) {
    this.serializer.setSerializationMethod(useMessagePack);
  }
}

export { TransactionSerializer };