import { CompressionManager } from '../compression-manager.mjs';
import FlexibleSerializer from '../flexible-serializer.mjs';

class BlockSerializer {
  constructor(compressionThreshold = 1024, useMessagePack = false) {
    this.compressionManager = new CompressionManager(compressionThreshold);
    this.serializer = new FlexibleSerializer('../protos/block.proto', useMessagePack);
    this.serializer.registerType('Block', 'contrast.Block');
  }

  async serializeAndCompress(block) {
    const serializedData = this.serializer.serialize(block, 'Block');
    return this.compressionManager.compress(serializedData);
  }

  async decompressAndDeserialize(data) {
    const decompressedData = await this.compressionManager.decompress(data);
    return this.serializer.deserialize(decompressedData, 'Block');
  }

  setSerializationMethod(useMessagePack) {
    this.serializer.setSerializationMethod(useMessagePack);
  }
}

export { BlockSerializer };
export default BlockSerializer;